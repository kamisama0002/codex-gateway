import { setResponseStatus } from "h3";
import { requireAdminUser } from "../../../../../../server/utils/gateway/auth/context";
import { gatewayBootId } from "../../utils/gateway-process";

export default defineEventHandler((event) => {
  requireAdminUser(event);
  setResponseStatus(event, 202);
  setTimeout(() => process.kill(process.pid, "SIGTERM"), 100).unref();
  return { bootId: gatewayBootId };
});
