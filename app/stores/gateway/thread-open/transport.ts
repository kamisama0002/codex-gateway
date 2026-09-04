import type { ComposerTurnOptions } from "~~/shared/types";
import { INITIAL_TURN_PAGE_LIMIT } from "~~/shared/config";
import { isManagedRuntimeHostId } from "~~/shared/runtime/managed-runtime";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { projectById } from "@/stores/gateway-catalog/selectors";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayRealtimeStore } from "@/stores/gateway-realtime";
import {
  expectThreadSnapshot,
  expectThreadStarted,
} from "@/stores/gateway-realtime/response-parsers";

export type ThreadSnapshotMessage = Extract<
  import("~~/shared/types").RealtimeServerMessage,
  { type: "thread.snapshot" }
>;

export type ThreadStartedMessage = Extract<
  import("~~/shared/types").RealtimeServerMessage,
  { type: "thread.started" }
>;

const MANAGED_RUNTIME_BROWSER_REQUEST_TIMEOUT_MS = 130_000;

export function realtimeRequestOptionsForHost(hostId: number, signal?: AbortSignal) {
  const timeoutMs = isManagedRuntimeHostId(hostId)
    ? MANAGED_RUNTIME_BROWSER_REQUEST_TIMEOUT_MS
    : undefined;
  if (timeoutMs === undefined && signal === undefined) return undefined;
  return { timeoutMs, signal };
}

export function requestActivateThreadSnapshot(input: {
  hostId: number;
  projectId: number | null;
  threadId: string;
  limit?: number;
}) {
  return useGatewayRealtimeStore().request(
    (requestId) => ({
      type: "thread.activate",
      requestId,
      hostId: input.hostId,
      projectId: input.projectId,
      threadId: input.threadId,
      limit: input.limit ?? INITIAL_TURN_PAGE_LIMIT,
    }),
    expectThreadSnapshot,
    realtimeRequestOptionsForHost(input.hostId),
    // Managed runtime RPCs have a bounded backend deadline, so the browser waits just beyond it.
    // SSH hosts omit this override and retain the broker's 31-minute upgrade/reconnect allowance.
  );
}

export function requestStartThread(
  options: ComposerTurnOptions,
  context?: { projectId?: number | null; signal?: AbortSignal },
) {
  const gateway = useGatewayCatalogStore();
  const navigation = useGatewayNavigationStore();
  const hostId = navigation.selectedHostId;
  if (hostId === null) throw new Error("Host is required to start a thread");
  const projectId =
    context && "projectId" in context ? context.projectId : navigation.selectedProjectId;
  const cwd = projectById(gateway.projects, projectId ?? null)?.remotePath;
  if (projectId !== null && projectId !== undefined && (cwd === undefined || cwd === "")) {
    throw new Error("Project workspace path is required to start a thread");
  }
  return useGatewayRealtimeStore().request(
    (requestId) => ({
      type: "thread.start",
      requestId,
      hostId,
      projectId,
      cwd,
      model: options.model === "" ? undefined : options.model,
      effort: options.effort === "" ? undefined : options.effort,
      approvalPolicy: options.approvalPolicy ?? undefined,
    }),
    expectThreadStarted,
    realtimeRequestOptionsForHost(hostId, context?.signal),
    // Managed runtime RPCs have a bounded backend deadline, so the browser waits just beyond it.
    // SSH hosts omit this override and retain the broker's 31-minute upgrade/reconnect allowance.
  );
}
