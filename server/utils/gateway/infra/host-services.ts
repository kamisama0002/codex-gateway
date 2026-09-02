import { CodexRuntimeService } from "./codex/codex-runtime";
import { RemoteFileService } from "./files/remote-files";
import { SshConnectionPool } from "./ssh/ssh-connection";
import { HostMetricsManager } from "../host-metrics/manager";
import { RemoteGitFileService } from "./git/remote-git-files";

export const sshConnections = new SshConnectionPool();
export const remoteFiles = new RemoteFileService(sshConnections);
export const remoteGitFiles = new RemoteGitFileService(sshConnections);
export const codexRuntime = new CodexRuntimeService(sshConnections);
export const hostMetricsManager = new HostMetricsManager(async (userId) => {
  const { runtimeService } = await import("../runtime-manager/runtime-service");
  return runtimeService.sampleAgentStats(userId);
});
