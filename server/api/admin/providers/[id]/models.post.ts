import { getRouterParam, readValidatedBody, type H3Event } from "h3";
import { requireAdminUser } from "../../../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../../../utils/gateway/http/errors";
import { providerIdSchema, providerModelSchema } from "../../../../utils/gateway/http/validation/providers";
import { providerStore } from "../../../../utils/gateway/providers/provider-store";
import { auditStore } from "../../../../utils/gateway/audit/audit-store";

export async function upsertProviderModelForEvent(event: H3Event, store = providerStore) {
  const admin = requireAdminUser(event);
  const providerId = providerIdSchema.parse(getRouterParam(event, "id"));
  const input = await readValidatedBody(event, (body) => providerModelSchema.parse(body));
  const model = store.upsertModel(providerId, input);
  auditStore.record({
    actorUserId: admin.id,
    action: "provider.model.upsert",
    outcome: "success",
    metadata: { providerId, modelId: model.modelId },
  });
  return model;
}

export default defineGatewayEventHandler((event) => upsertProviderModelForEvent(event));
