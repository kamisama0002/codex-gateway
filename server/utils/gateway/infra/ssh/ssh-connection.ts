import { readFileSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { Client, type ClientChannel, type SFTPWrapper } from "ssh2";
import type {
  CommandResult,
  DirectTcpChannelOptions,
  HostWithSecret,
  ShellOptions,
} from "./ssh-types";
import { createProxySocket, expandHome, resolveSshConfig, sshConnectionKey } from "./ssh-config";
import { SSH_CONNECTION_CLOSED_BEFORE_READY, withSshConnectRetries } from "./ssh-connect-retry";
import { isConnectionLevelSshError, isRetryableSshChannelOpenError } from "./ssh-errors";
import { SftpChannelPool } from "./ssh-sftp";
import { uploadFile, uploadFileResumable } from "./ssh-transfer";
import { currentGatewayUserId } from "../../state/memory";
import { EventEmitter } from "@posva/event-emitter";
import { SshBackgroundTaskScheduler } from "./ssh-background-tasks";
import { KeyedLeaseLimiter } from "../concurrency/keyed-lease-limiter";

const SSH_READY_TIMEOUT_MS = 30_000;
const SSH_KEEPALIVE_INTERVAL_MS = 30_000;
const SSH_KEEPALIVE_COUNT_MAX = 10;
const SSH_EXEC_CHANNEL_OPEN_ATTEMPTS = 3;
const SSH_EXEC_CHANNEL_RETRY_BASE_DELAY_MS = 150;
// OpenSSH defaults MaxSessions to 10. SFTP uses one uncounted pooled subsystem channel, and the
// remaining spare slot lets a just-closed server session drain before Gateway admits more work.
const SSH_SESSION_CHANNEL_LIMIT = 8;

interface ExecOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  maxOutputBytes?: number;
}

function abortReason(signal: AbortSignal | undefined) {
  return signal?.reason instanceof Error
    ? signal.reason
    : new Error("Remote command was aborted", { cause: signal?.reason });
}

function outputLimitExceeded(outputBytes: number, maxOutputBytes: number | undefined) {
  return maxOutputBytes !== undefined && outputBytes > maxOutputBytes;
}

function outputLimitError(maxOutputBytes: number | undefined) {
  return new Error(`Remote command output exceeded the ${maxOutputBytes ?? 0} byte limit`);
}

type SshConnectionPoolEvents = {
  ready: { userId: number; host: HostWithSecret };
};

export class SshConnectionPool extends EventEmitter<SshConnectionPoolEvents> {
  private clients = new Map<string, Promise<Client>>();
  private clientTokens = new Map<string, symbol>();
  private sftpChannels = new SftpChannelPool();
  private hostKeysByUser = new Map<string, Map<number, string>>();
  private backgroundTasks = new SshBackgroundTaskScheduler();
  private sessionChannels = new KeyedLeaseLimiter(SSH_SESSION_CHANNEL_LIMIT);

  constructor() {
    super();
  }

  connect(host: HostWithSecret): Promise<Client> {
    const resolved = resolveSshConfig(host);
    const key = sshConnectionKey(host, resolved);
    this.scopedHostKeys().set(host.id, key);

    const existing = this.clients.get(key);
    if (existing) return this.notifyReady(existing, host);

    const token = Symbol(key);
    this.clientTokens.set(key, token);
    const promise = withSshConnectRetries(host, () =>
      this.connectOnce(host, resolved, key, token),
    ).catch((error) => {
      this.deleteClientIfCurrent(key, token);
      throw error;
    });

    this.clients.set(key, promise);
    return this.notifyReady(promise, host);
  }

  async execChannelIfConnected(host: HostWithSecret, command: string) {
    const key = sshConnectionKey(host, resolveSshConfig(host));
    const connection = this.clients.get(key);
    if (connection === undefined) return null;
    const client = await connection;
    return await this.openExecChannelWithRetries(host, key, client, command);
  }

  runBackground<Result>(host: HostWithSecret, task: () => Promise<Result>) {
    const connectionKey = this.connectionKeyFor(host);
    // The Client pool itself is keyed by the resolved remote identity and credentials. Use that
    // same key here: two Gateway users with identical credentials share one physical SSH transport,
    // so their best-effort collectors must share its background bulkhead as well.
    return this.backgroundTasks.run(connectionKey, task);
  }

  connectionKeyFor(host: HostWithSecret) {
    return sshConnectionKey(host, resolveSshConfig(host));
  }

  async exec(
    host: HostWithSecret,
    command: string,
    options: ExecOptions = {},
  ): Promise<CommandResult> {
    const startedAt = Date.now();
    const channel = await this.openExecChannelWithin(
      host,
      command,
      options.timeoutMs,
      options.signal,
    );
    const remainingMs =
      options.timeoutMs === undefined
        ? undefined
        : Math.max(0, options.timeoutMs - (Date.now() - startedAt));

    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let outputBytes = 0;
      const stdoutDecoder = new StringDecoder("utf8");
      const stderrDecoder = new StringDecoder("utf8");
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
        callback();
      };
      const abort = () => {
        finish(() => reject(abortReason(options.signal)));
        channel.close();
      };
      const timer =
        remainingMs === undefined
          ? undefined
          : setTimeout(() => {
              finish(() =>
                reject(new Error(`Remote command timed out after ${options.timeoutMs}ms`)),
              );
              channel.close();
            }, remainingMs);
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted === true) {
        abort();
        return;
      }
      channel.on("data", (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputLimitExceeded(outputBytes, options.maxOutputBytes)) {
          finish(() => reject(outputLimitError(options.maxOutputBytes)));
          channel.close();
          return;
        }
        stdout += stdoutDecoder.write(chunk);
      });
      channel.stderr.on("data", (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputLimitExceeded(outputBytes, options.maxOutputBytes)) {
          finish(() => reject(outputLimitError(options.maxOutputBytes)));
          channel.close();
          return;
        }
        stderr += stderrDecoder.write(chunk);
      });
      channel.on("error", (error: Error) => finish(() => reject(error)));
      channel.on("close", (code: number | null) => {
        finish(() => {
          stdout += stdoutDecoder.end();
          stderr += stderrDecoder.end();
          resolve({ code, stdout, stderr });
        });
      });
    });
  }

  private async openExecChannelWithin(
    host: HostWithSecret,
    command: string,
    timeoutMs: number | undefined,
    signal: AbortSignal | undefined,
  ) {
    if (timeoutMs === undefined && signal === undefined)
      return await this.execChannel(host, command, false, signal);
    return await new Promise<ClientChannel>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        if (timer !== undefined) clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const abort = () => fail(abortReason(signal));
      const timer =
        timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              fail(new Error(`Remote command timed out after ${timeoutMs}ms`));
            }, timeoutMs);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted === true) {
        abort();
        return;
      }
      void this.execChannel(host, command, false, signal).then(
        (channel) => {
          if (settled) {
            // A timed-out channel request can still be admitted later by ssh2. Close that late
            // channel so it cannot consume a slot on the shared transport indefinitely.
            channel.close();
            return;
          }
          settled = true;
          cleanup();
          resolve(channel);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(
            error instanceof Error
              ? error
              : new Error("Failed to open remote command channel", { cause: error }),
          );
        },
      );
    });
  }

  async execChannel(
    host: HostWithSecret,
    command: string,
    retried = false,
    signal?: AbortSignal,
  ): Promise<ClientChannel> {
    const client = await this.connect(host);
    const key = this.connectionKeyFor(host);

    try {
      return await this.openExecChannelWithRetries(host, key, client, command, signal);
    } catch (error) {
      if (!retried && isConnectionLevelSshError(error)) {
        this.disconnectHost(host);
        return await this.execChannel(host, command, true, signal);
      }
      throw error;
    }
  }

  private async openExecChannelWithRetries(
    host: HostWithSecret,
    key: string,
    client: Client,
    command: string,
    signal?: AbortSignal,
  ) {
    for (let attempt = 1; attempt <= SSH_EXEC_CHANNEL_OPEN_ATTEMPTS; attempt += 1) {
      try {
        return await this.openSessionChannel(
          key,
          () =>
            new Promise<ClientChannel>((resolve, reject) => {
              client.exec(command, (error, channel) => (error ? reject(error) : resolve(channel)));
            }),
          signal,
        );
      } catch (error) {
        // MaxSessions rejects only this logical channel. Give closing channels time to release
        // their slots without replacing the shared transport used by App Server and SFTP.
        if (attempt >= SSH_EXEC_CHANNEL_OPEN_ATTEMPTS || !isRetryableSshChannelOpenError(error)) {
          throw error;
        }
        console.info("[gateway-ssh] retrying transient exec channel open", {
          hostId: host.id,
          hostName: host.name,
          attempt,
          nextAttempt: attempt + 1,
          maxAttempts: SSH_EXEC_CHANNEL_OPEN_ATTEMPTS,
          message: error instanceof Error ? error.message : String(error),
        });
        await new Promise((resolve) =>
          setTimeout(resolve, SSH_EXEC_CHANNEL_RETRY_BASE_DELAY_MS * attempt),
        );
      }
    }
    throw new Error("Failed to open remote command channel");
  }

  async openShell(
    host: HostWithSecret,
    options: ShellOptions,
    retried = false,
  ): Promise<ClientChannel> {
    const client = await this.connect(host);
    const key = this.connectionKeyFor(host);

    try {
      return await this.openSessionChannel(
        key,
        () =>
          new Promise<ClientChannel>((resolve, reject) => {
            client.shell(
              {
                term: options.term,
                cols: options.cols,
                rows: options.rows,
              },
              (error, channel) => (error ? reject(error) : resolve(channel)),
            );
          }),
      );
    } catch (error) {
      // Keep the shared connection for channel-local failures; only transport errors justify
      // reconnecting every service that shares this Client.
      if (!retried && isConnectionLevelSshError(error)) {
        this.disconnectHost(host);
        return await this.openShell(host, options, true);
      }
      throw error;
    }
  }

  async openTcpChannel(
    host: HostWithSecret,
    target: DirectTcpChannelOptions,
    retried = false,
  ): Promise<ClientChannel> {
    const client = await this.connect(host);
    return new Promise((resolve, reject) => {
      client.forwardOut("127.0.0.1", 0, target.host, target.port, (error, channel) => {
        if (!error) {
          resolve(channel);
          return;
        }
        if (!retried && isConnectionLevelSshError(error)) {
          this.disconnectHost(host);
          void this.openTcpChannel(host, target, true).then(resolve, reject);
          return;
        }
        reject(error);
      });
    });
  }

  sftp(host: HostWithSecret): Promise<SFTPWrapper> {
    const resolved = resolveSshConfig(host);
    const key = sshConnectionKey(host, resolved);
    this.scopedHostKeys().set(host.id, key);
    return this.sftpChannels.get(host, key, () => this.connect(host));
  }

  async uploadFile(host: HostWithSecret, localPath: string, remotePath: string) {
    return await uploadFile(this, host, localPath, remotePath);
  }

  async uploadFileResumable(host: HostWithSecret, localPath: string, remotePath: string) {
    return await uploadFileResumable(this, host, localPath, remotePath);
  }

  syncHosts(hosts: HostWithSecret[]) {
    const scopedHostKeys = this.scopedHostKeys();
    const previousKeys = new Set(scopedHostKeys.values());
    const activeKeys = new Set<string>();
    scopedHostKeys.clear();
    for (const host of hosts) {
      const key = sshConnectionKey(host, resolveSshConfig(host));
      activeKeys.add(key);
      scopedHostKeys.set(host.id, key);
    }

    for (const key of previousKeys) {
      if (!activeKeys.has(key) && !this.isReferenced(key)) {
        this.disconnectKey(key);
      }
    }
  }

  disconnectHost(host: HostWithSecret) {
    const key =
      this.scopedHostKeys().get(host.id) ?? sshConnectionKey(host, resolveSshConfig(host));
    this.disconnectKey(key);
  }

  disconnect(hostId: number) {
    const scopedHostKeys = this.scopedHostKeys();
    const key = scopedHostKeys.get(hostId);
    if (key !== undefined) {
      scopedHostKeys.delete(hostId);
      if (!this.isReferenced(key)) {
        this.disconnectKey(key);
      }
    }
  }

  private disconnectKey(key: string) {
    this.sftpChannels.close(key);
    this.sessionChannels.reset(key, new Error("SSH connection was closed"));
    const client = this.clients.get(key);
    this.clients.delete(key);
    this.clientTokens.delete(key);
    void client?.then((connection) => connection.end()).catch(() => {});
  }

  private scopedHostKeys() {
    const scope = this.userScopeKey();
    let hostKeys = this.hostKeysByUser.get(scope);
    if (!hostKeys) {
      hostKeys = new Map();
      this.hostKeysByUser.set(scope, hostKeys);
    }
    return hostKeys;
  }

  private userScopeKey() {
    return String(currentGatewayUserId() ?? "anonymous");
  }

  private isReferenced(key: string) {
    for (const hostKeys of this.hostKeysByUser.values()) {
      for (const referencedKey of hostKeys.values()) {
        if (referencedKey === key) {
          return true;
        }
      }
    }
    return false;
  }

  private async connectOnce(
    host: HostWithSecret,
    resolved: ReturnType<typeof resolveSshConfig>,
    key: string,
    token: symbol,
  ) {
    const sock = resolved.proxy
      ? await createProxySocket({
          proxy: resolved.proxy,
          targetHost: resolved.hostName,
          targetPort: host.port ?? resolved.port,
        })
      : undefined;
    const client = new Client();
    return await new Promise<Client>((resolve, reject) => {
      let settled = false;
      const fail = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        this.deleteClientIfCurrent(key, token);
        sock?.destroy();
        client.end();
        reject(error);
      };
      client
        .on("ready", () => {
          if (this.clientTokens.get(key) !== token) {
            fail(new Error("SSH connection attempt was superseded by Host reconfiguration"));
            return;
          }
          settled = true;
          resolve(client);
        })
        .on("error", fail)
        .on("end", () => this.deleteClientIfCurrent(key, token))
        .on("close", () => {
          this.deleteClientIfCurrent(key, token);
          fail(new Error(SSH_CONNECTION_CLOSED_BEFORE_READY));
        })
        .connect({
          host: sock ? undefined : resolved.hostName,
          sock,
          username: host.username ?? resolved.username,
          port: sock ? undefined : (host.port ?? resolved.port),
          agent: host.authMode === "agent" ? process.env.SSH_AUTH_SOCK : undefined,
          password: host.authMode === "password" ? (host.password ?? undefined) : undefined,
          privateKey:
            host.privateKey !== null && host.privateKey !== undefined && host.privateKey !== ""
              ? Buffer.from(host.privateKey)
              : resolved.privateKeyPath !== null &&
                  resolved.privateKeyPath !== undefined &&
                  resolved.privateKeyPath !== ""
                ? readFileSync(expandHome(resolved.privateKeyPath))
                : undefined,
          readyTimeout: SSH_READY_TIMEOUT_MS,
          keepaliveInterval: SSH_KEEPALIVE_INTERVAL_MS,
          keepaliveCountMax: SSH_KEEPALIVE_COUNT_MAX,
        });
    });
  }

  private async notifyReady(connection: Promise<Client>, host: HostWithSecret) {
    const client = await connection;
    const userId = currentGatewayUserId();
    if (userId !== null) this.emit("ready", { userId, host });
    return client;
  }

  private deleteClientIfCurrent(key: string, token: symbol) {
    if (this.clientTokens.get(key) !== token) return;
    this.clientTokens.delete(key);
    this.clients.delete(key);
    this.sftpChannels.close(key);
    this.sessionChannels.reset(key, new Error("SSH connection was closed"));
  }

  private async openSessionChannel(
    key: string,
    open: () => Promise<ClientChannel>,
    signal?: AbortSignal,
  ) {
    const release = await this.sessionChannels.acquire(key, { signal });
    try {
      signal?.throwIfAborted();
      const channel = await open();
      channel.once("close", release);
      return channel;
    } catch (error) {
      release();
      throw error;
    }
  }
}
