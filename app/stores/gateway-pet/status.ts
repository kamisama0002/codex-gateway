import type { GatewayPetStatus, ThreadRuntimeStatus, ThreadTimelineItem } from "~~/shared/types";

const SERVER_REQUEST_TYPES = new Set([
  "attestationRequest",
  "chatgptAuthTokensRefreshRequest",
  "dynamicToolClientRequest",
  "mcpElicitationRequest",
  "permissionsRequest",
  "requestUserInput",
  "serverRequest",
]);

export function gatewayPetStatus(input: {
  hasThread: boolean;
  runtimeStatus: ThreadRuntimeStatus;
  items: ThreadTimelineItem[];
}): GatewayPetStatus {
  if (!input.hasThread) return "idle";
  if (input.items.some(isPendingUserRequest)) return "waiting";
  switch (input.runtimeStatus) {
    case "running":
      return "running";
    case "failed":
      return "failed";
    case "completed":
    case "interrupted":
      return "ready";
    case "idle":
      return "idle";
  }
}

export function isPendingUserRequest(item: ThreadTimelineItem) {
  if (item.pendingApproval?.requestId !== null && item.pendingApproval?.requestId !== undefined) {
    return true;
  }
  return (
    SERVER_REQUEST_TYPES.has(item.type) &&
    item.status !== "completed" &&
    item.requestId !== null &&
    item.requestId !== undefined &&
    item.requestId !== ""
  );
}
