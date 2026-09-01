import { readValidatedBody, type H3Event } from "h3";
import { requireAdminUser } from "../../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";
import { providerCreateSchema } from "../../../utils/gateway/http/validation/providers";
import { providerStore } from "../../../utils/gateway/providers/provider-store";
import { auditStore } from "../../../utils/gateway/audit/audit-store";

export async function createProviderForEvent(event: H3Event, store = providerStore) {
  const admin = requireAdminUser(event);
  const input = await readValidatedBody(event, (body) => providerCreateSchema.parse(body));
  const provider = store.create(input);
  auditStore.record({
    actorUserId: admin.id,
    action: "provider.create",
    outcome: "success",
    metadata: { providerId: provider.id },
  });
  return provider;
}

export default defineGatewayEventHandler((event) => createProviderForEvent(event));
