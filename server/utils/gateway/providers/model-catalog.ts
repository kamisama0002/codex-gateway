import type { ModelListResult } from "~~/shared/types";

interface ProviderModelAccess {
  providerId: string;
  modelId: string;
}

export function filterManagedModelCatalog(
  catalog: ModelListResult,
  accessibleModels: ProviderModelAccess[],
): ModelListResult {
  const runtimeProviderId = accessibleModels[0]?.providerId;
  if (runtimeProviderId === undefined) return { ...catalog, data: [] };

  const allowedModelIds = new Set(
    accessibleModels
      .filter((model) => model.providerId === runtimeProviderId)
      .map((model) => model.modelId),
  );
  const data = catalog.data.filter(
    (model) => allowedModelIds.has(model.model) || allowedModelIds.has(model.id),
  );
  if (data.length === 0 || data.some((model) => model.isDefault === true)) {
    return { ...catalog, data };
  }
  return { ...catalog, data: [{ ...data[0]!, isDefault: true }, ...data.slice(1)] };
}
