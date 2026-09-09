import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { runtimeIdleTimeoutMinutes } from "../../utils/gateway/runtime-manager/runtime-idle-timeout";

/** Non-sensitive platform defaults used to explain Runtime lifecycle behavior in the UI. */
export default defineGatewayEventHandler(() => ({
  idleTimeoutMinutes: runtimeIdleTimeoutMinutes(),
}));
