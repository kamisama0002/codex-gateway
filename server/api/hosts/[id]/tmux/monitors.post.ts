import { getRouterParam, readValidatedBody } from "h3";
import {
  defineGatewayEventHandler,
  hostLogContext,
  setGatewayRequestLogContext,
} from "../../../../utils/gateway/http/errors";
import { createTmuxMonitorSchema } from "../../../../utils/gateway/http/validation/tmux";
import { requireWorkspaceHost } from "../../../../utils/gateway/runtime-manager/local-workspace";
import { hostStore } from "../../../../utils/gateway/state/hosts";
import { tmuxMonitorService } from "../../../../utils/gateway/tmux-monitor/monitor-service";
import { hostRuntimeFingerprint } from "../../../../utils/gateway/runtime/host-runtime-fingerprint";
import { isManagedRuntimeHostId } from "~~/shared/runtime/managed-runtime";

export default defineGatewayEventHandler(async (event) => {
  const hostId = Number(getRouterParam(event, "id"));
  const host = await requireWorkspaceHost(hostId);
  const fingerprint = hostRuntimeFingerprint(host);
  const body = await readValidatedBody(event, (value) => createTmuxMonitorSchema.parse(value));
  setGatewayRequestLogContext(event, "tmux.monitors.create", {
    ...hostLogContext(host),
    sessionId: body.sessionId,
    paneId: body.paneId,
  });
  return await tmuxMonitorService.create(event.context.auth!.user.id, host, body, () => {
    if (isManagedRuntimeHostId(hostId)) return true;
    const current = hostStore.getWithSecret(hostId);
    return current !== null && hostRuntimeFingerprint(current) === fingerprint;
  });
});
