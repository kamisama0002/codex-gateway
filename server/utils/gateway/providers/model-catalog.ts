import type { ModelListResult } from "~~/shared/types";

interface ProviderModelAccess {
  providerId: string;
  modelId: string;
}

export function filterManagedModelCatalog(
  catalog: ModelListResult,
  availableModels: ProviderModelAccess[],
): ModelListResult {
  const runtimeProviderId = availableModels[0]?.providerId;
  if (runtimeProviderId === undefined) return { ...catalog, data: [] };

  const allowedModelIds = new Set(
    availableModels
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
