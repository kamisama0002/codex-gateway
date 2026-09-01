import type { H3Event } from "h3";
import { requireAdminUser } from "../../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";
import { providerStore } from "../../../utils/gateway/providers/provider-store";

export function listProvidersForEvent(
  event: H3Event,
  store = providerStore,
) {
  requireAdminUser(event);
  return store.listPublic().map((provider) => ({
    ...provider,
    models: store.listModels(provider.id),
  }));
}

export default defineGatewayEventHandler((event) => listProvidersForEvent(event));
