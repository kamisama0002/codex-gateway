import type { HostRecord } from "~~/shared/types";
import { isManagedRuntimeHost } from "~~/shared/runtime/managed-runtime";
import { sshConnections } from "../infra/host-services";
import { remoteLoginShellCommand } from "../infra/ssh/remote-command";
import type { CommandResult, HostWithSecret } from "../infra/ssh/ssh-types";
import { runtimeService } from "../runtime-manager/runtime-service";
import { currentGatewayUserId } from "../state/memory";

interface TmuxCommandOptions {
  timeoutMs: number;
  maxOutputBytes: number;
}

interface TmuxCommandExecutorDependencies {
  currentUserId(): number | null;
  execManaged(userId: number, command: string, options: TmuxCommandOptions): Promise<CommandResult>;
  execSsh(
    host: HostWithSecret,
    command: string,
    options: TmuxCommandOptions,
  ): Promise<CommandResult>;
  runSshBackground<T>(host: HostWithSecret, task: () => Promise<T>): Promise<T>;
}

const defaultDependencies: TmuxCommandExecutorDependencies = {
  currentUserId: currentGatewayUserId,
  execManaged: (userId, command, options) =>
    runtimeService.execAgentCommand(userId, command, options),
  execSsh: (host, command, options) =>
    sshConnections.exec(host, command, { timeoutMs: options.timeoutMs }),
  runSshBackground: (host, task) => sshConnections.runBackground(host, task),
};

export class TmuxCommandExecutor {
  constructor(private readonly dependencies = defaultDependencies) {}

  async exec(
    host: HostRecord,
    command: string,
    options: TmuxCommandOptions,
  ): Promise<CommandResult> {
    if (isManagedRuntimeHost(host)) {
      const userId = this.dependencies.currentUserId();
      if (userId === null) {
        throw new Error("Gateway user context is required for managed tmux");
      }
      return await this.dependencies.execManaged(userId, command, options);
    }
    return await this.dependencies.execSsh(host, remoteLoginShellCommand(command), options);
  }

  runBackground<T>(host: HostRecord, task: () => Promise<T>): Promise<T> {
    return isManagedRuntimeHost(host) ? task() : this.dependencies.runSshBackground(host, task);
  }
}

export const tmuxCommandExecutor = new TmuxCommandExecutor();
