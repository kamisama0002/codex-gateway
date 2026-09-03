import type {
  ThreadRuntimePhase,
  ThreadRuntimeStatus,
  ThreadTokenUsageState,
} from "~~/shared/types";
import { useGatewayThreadRuntimeStore } from "@/stores/gateway-thread-runtime";
import type { ThreadStatusUpdateOptions } from "@/stores/gateway/types";
import {
  applyThreadRuntimeStatus,
  projectThreadRuntime,
} from "@/stores/gateway/thread-runtime/projector";
import { pinnedKey } from "@/stores/gateway/thread-utils/identity";

export function createThreadRuntimeActions() {
  return {
    setThreadRunning(hostId: number, threadId: string, running: boolean) {
      applyThreadRuntimeStatus(hostId, threadId, {
        status: running ? "running" : "completed",
        phase: running ? "running" : "completed",
      });
    },
    setThreadStatus(
      hostId: number,
      threadId: string,
      status: ThreadRuntimeStatus,
      options: ThreadStatusUpdateOptions = {},
    ) {
      applyThreadRuntimeStatus(hostId, threadId, {
        status,
        phase: options.phase,
        turnId: options.turnId,
      });
    },
    setThreadPhase(hostId: number, threadId: string, phase: ThreadRuntimePhase) {
      const runtime = useGatewayThreadRuntimeStore();
      applyThreadRuntimeStatus(hostId, threadId, {
        status: runtime.statusFor(hostId, threadId),
        phase,
      });
    },
    setThreadTokenUsage(hostId: number, threadId: string, tokenUsage: ThreadTokenUsageState) {
      const runtime = useGatewayThreadRuntimeStore();
      runtime.threadTokenUsageByKey = {
        ...runtime.threadTokenUsageByKey,
        [pinnedKey(hostId, threadId)]: tokenUsage,
      };
    },
    threadRuntimeProjection(hostId: number, threadId: string) {
      return projectThreadRuntime(hostId, threadId);
    },
  };
}
