import type { H3Event } from "h3";
import { requireAuthenticatedUser } from "../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { providerStore } from "../../utils/gateway/providers/provider-store";

export async function listUserProviderModelsForEvent(event: H3Event, store = providerStore) {
  const user = requireAuthenticatedUser(event);
  return { data: await store.listForUser(user.id) };
}

export default defineGatewayEventHandler(
  async (event) => await listUserProviderModelsForEvent(event),
);
