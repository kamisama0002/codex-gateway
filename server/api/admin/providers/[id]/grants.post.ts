import { getRouterParam, readValidatedBody, type H3Event } from "h3";
import { requireAdminUser } from "../../../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../../../utils/gateway/http/errors";
import { providerGrantSchema, providerIdSchema } from "../../../../utils/gateway/http/validation/providers";
import { providerStore } from "../../../../utils/gateway/providers/provider-store";
import { auditStore } from "../../../../utils/gateway/audit/audit-store";

export async function setProviderGrantForEvent(event: H3Event, store = providerStore) {
  const admin = requireAdminUser(event);
  const providerId = providerIdSchema.parse(getRouterParam(event, "id"));
  const input = await readValidatedBody(event, (body) => providerGrantSchema.parse(body));
  const grantInput = { userId: input.userId, providerId, modelId: input.modelId };
  const result = input.granted ? store.grant(grantInput) : store.revoke(grantInput);
  auditStore.record({
    actorUserId: admin.id,
    userId: input.userId,
    action: input.granted ? "provider.grant" : "provider.revoke",
    outcome: "success",
    metadata: { providerId, modelId: input.modelId },
  });
  return input.granted ? result : { revoked: Boolean(result) };
}

export default defineGatewayEventHandler((event) => setProviderGrantForEvent(event));
