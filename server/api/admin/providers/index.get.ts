import type { H3Event } from "h3";
import { requireAdminUser } from "../../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";
import { providerStore } from "../../../utils/gateway/providers/provider-store";

export async function listProvidersForEvent(event: H3Event, store = providerStore) {
  requireAdminUser(event);
  const providers = await store.listPublic();
  return await Promise.all(
    providers.map(async (provider) => ({
      ...provider,
      models: await store.listModels(provider.id),
    })),
  );
}

export default defineGatewayEventHandler(async (event) => await listProvidersForEvent(event));
