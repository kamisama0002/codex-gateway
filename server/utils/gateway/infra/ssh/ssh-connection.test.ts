import { Client, type ClientChannel } from "ssh2";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { SshConnectionPool } from "./ssh-connection";
import type { HostWithSecret } from "./ssh-types";

const host: HostWithSecret = {
  id: 1,
  name: "SSH retry test",
  sshHost: "ssh.example.invalid",
  username: "codex",
  port: 22,
  authMode: "password",
  privateKeyPath: null,
  privateKey: null,
  password: "test-only",
  proxyUrl: null,
  hasPassword: true,
  createdAt: "2026-09-03T00:00:00.000Z",
  updatedAt: "2026-09-03T00:00:00.000Z",
};

function testChannel() {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ssh2 exposes ClientChannel as a callback-only type with no public constructor.
  return new EventEmitter() as ClientChannel;
}

describe("SshConnectionPool exec channel admission", () => {
  it("retries a transient channel rejection on the existing SSH client", async () => {
    const pool = new SshConnectionPool();
    const client = new Client();
    const channel = testChannel();
    const exec = vi.spyOn(client, "exec").mockImplementation((_command, callback) => {
      if (exec.mock.calls.length === 1) {
        callback(new Error("Channel open failure: open failed"), channel);
        return client;
      }
      callback(undefined, channel);
      return client;
    });
    const connect = vi.spyOn(pool, "connect").mockResolvedValue(client);
    const log = vi.spyOn(console, "info").mockImplementation(() => {});

    await expect(pool.execChannel(host, "true")).resolves.toBe(channel);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(
      "[gateway-ssh] retrying transient exec channel open",
      expect.objectContaining({ attempt: 1, nextAttempt: 2 }),
    );
  });

  it("does not retry a permanent channel rejection", async () => {
    const pool = new SshConnectionPool();
    const client = new Client();
    const channel = testChannel();
    const exec = vi.spyOn(client, "exec").mockImplementation((_command, callback) => {
      callback(new Error("Channel open failure: Administratively prohibited"), channel);
      return client;
    });
    vi.spyOn(pool, "connect").mockResolvedValue(client);

    await expect(pool.execChannel(host, "true")).rejects.toThrow(
      "Channel open failure: Administratively prohibited",
    );
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("holds the ninth session channel until one of the first eight closes", async () => {
    const pool = new SshConnectionPool();
    const client = new Client();
    const channels = Array.from({ length: 9 }, testChannel);
    const exec = vi.spyOn(client, "exec").mockImplementation((_command, callback) => {
      callback(undefined, channels[exec.mock.calls.length - 1]!);
      return client;
    });
    vi.spyOn(pool, "connect").mockResolvedValue(client);

    const active = await Promise.all(
      Array.from({ length: 8 }, (_, index) => pool.execChannel(host, `command-${index}`)),
    );
    let ninthAdmitted = false;
    const ninthPending = pool.execChannel(host, "command-9").then((channel) => {
      ninthAdmitted = true;
      return channel;
    });
    await Promise.resolve();
    expect(ninthAdmitted).toBe(false);
    expect(exec).toHaveBeenCalledTimes(8);

    active[0]!.emit("close");
    const ninth = await ninthPending;
    expect(ninth).toBe(channels[8]);
    expect(exec).toHaveBeenCalledTimes(9);

    for (const channel of active.slice(1)) channel.emit("close");
    ninth.emit("close");
  });
});
