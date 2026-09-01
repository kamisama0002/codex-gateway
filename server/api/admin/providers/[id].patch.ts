import { getRouterParam, readValidatedBody, type H3Event } from "h3";
import { requireAdminUser } from "../../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";
import { providerIdSchema, providerUpdateSchema } from "../../../utils/gateway/http/validation/providers";
import { providerStore } from "../../../utils/gateway/providers/provider-store";
import { auditStore } from "../../../utils/gateway/audit/audit-store";
import { requireRecord } from "../../../utils/gateway/http/validation/common";

export async function updateProviderForEvent(event: H3Event, store = providerStore) {
  const admin = requireAdminUser(event);
  const id = providerIdSchema.parse(getRouterParam(event, "id"));
  const input = await readValidatedBody(event, (body) => providerUpdateSchema.parse(body));
  requireRecord(store.getPublic(id), "Provider not found");
  const provider = store.update(id, input);
  auditStore.record({
    actorUserId: admin.id,
    action: "provider.update",
    outcome: "success",
    metadata: { providerId: provider.id },
  });
  return provider;
}

export default defineGatewayEventHandler((event) => updateProviderForEvent(event));
