import { getRouterParam } from "h3";
import {
  defineGatewayEventHandler,
  hostLogContext,
  setGatewayRequestLogContext,
} from "../../../../../../utils/gateway/http/errors";
import { requireWorkspaceHost } from "../../../../../../utils/gateway/runtime-manager/local-workspace";
import { tmuxMonitorService } from "../../../../../../utils/gateway/tmux-monitor/monitor-service";

export default defineGatewayEventHandler(async (event) => {
  const hostId = Number(getRouterParam(event, "id"));
  const monitorId = Number(getRouterParam(event, "monitorId"));
  const host = await requireWorkspaceHost(hostId);
  setGatewayRequestLogContext(event, "tmux.monitors.promote", {
    ...hostLogContext(host),
    monitorId,
  });
  return await tmuxMonitorService.promote(event.context.auth!.user.id, host, monitorId);
});
