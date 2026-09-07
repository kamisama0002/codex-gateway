import { createError, getRouterParam, type H3Event } from "h3";
import { requireAdminUser } from "../../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";
import { providerIdSchema } from "../../../utils/gateway/http/validation/providers";
import { providerStore } from "../../../utils/gateway/providers/provider-store";
import { auditStore } from "../../../utils/gateway/audit/audit-store";

export async function deleteProviderForEvent(event: H3Event, store = providerStore) {
  const admin = requireAdminUser(event);
  const id = providerIdSchema.parse(getRouterParam(event, "id"));
  if (!(await store.delete(id))) {
    throw createError({ statusCode: 404, statusMessage: "Provider not found" });
  }
  await auditStore.record({
    actorUserId: admin.id,
    action: "provider.delete",
    outcome: "success",
    metadata: { providerId: id },
  });
  return { deleted: true };
}

export default defineGatewayEventHandler(async (event) => await deleteProviderForEvent(event));
