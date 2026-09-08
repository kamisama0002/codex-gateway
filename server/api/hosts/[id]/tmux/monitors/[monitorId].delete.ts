import { getRouterParam } from "h3";
import { defineGatewayEventHandler } from "../../../../../utils/gateway/http/errors";
import { requireWorkspaceHost } from "../../../../../utils/gateway/runtime-manager/local-workspace";
import { tmuxMonitorService } from "../../../../../utils/gateway/tmux-monitor/monitor-service";

export default defineGatewayEventHandler(async (event) => {
  const hostId = Number(getRouterParam(event, "id"));
  const monitorId = Number(getRouterParam(event, "monitorId"));
  await requireWorkspaceHost(hostId);
  return await tmuxMonitorService.cancelForHost(event.context.auth!.user.id, hostId, monitorId);
});
