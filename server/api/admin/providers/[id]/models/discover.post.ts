import { getRouterParam, type H3Event } from "h3";
import { requireAdminUser } from "../../../../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../../../../utils/gateway/http/errors";
import { providerIdSchema } from "../../../../../utils/gateway/http/validation/providers";
import { auditStore } from "../../../../../utils/gateway/audit/audit-store";
import { discoverProviderModels } from "../../../../../utils/gateway/providers/model-discovery";
import { providerStore } from "../../../../../utils/gateway/providers/provider-store";

export async function discoverProviderModelsForEvent(event: H3Event) {
  const admin = requireAdminUser(event);
  const providerId = providerIdSchema.parse(getRouterParam(event, "id"));
  const provider = await providerStore.getWithSecret(providerId);
  if (provider === null) throw new Error("Provider not found");
  const discovered = await discoverProviderModels(provider);
  const models = await providerStore.syncDiscoveredModels(providerId, discovered);
  await auditStore.record({
    actorUserId: admin.id,
    action: "provider.models.discover",
    outcome: "success",
    metadata: { providerId, modelCount: models.length },
  });
  return { providerId, models, discoveredCount: discovered.length };
}

export default defineGatewayEventHandler((event) => discoverProviderModelsForEvent(event));
