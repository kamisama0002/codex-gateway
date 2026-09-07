import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { tmuxMonitorService } from "../../utils/gateway/tmux-monitor/monitor-service";

export default defineGatewayEventHandler(async (event) => {
  return await tmuxMonitorService.list(event.context.auth!.user.id);
});
