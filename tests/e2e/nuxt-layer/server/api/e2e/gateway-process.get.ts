import { requireAuthenticatedUser } from "../../../../../../server/utils/gateway/auth/context";
import { gatewayBootId } from "../../utils/gateway-process";

export default defineEventHandler((event) => {
  requireAuthenticatedUser(event);
  return { bootId: gatewayBootId };
});
