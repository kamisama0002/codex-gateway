import type { ModelCapabilities, ModelListResult, ModelRecord } from "~~/shared/types";

interface ProviderModelAccess {
  providerId: string;
  modelId: string;
  displayName?: string;
  capabilities?: ModelCapabilities;
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
  const data = catalog.data
    .filter((model) => allowedModelIds.has(model.model) || allowedModelIds.has(model.id))
    .map((model) => mergeProviderModelMetadata(model, availableModels, runtimeProviderId));

  // Codex App Server only knows the models in its own built-in catalog. Provider-backed
  // models can be added by an administrator after a runtime is provisioned, so append any
  // enabled model that the App Server did not advertise instead of dropping it at the
  // intersection step above.
  const missingModels: ModelRecord[] = availableModels
    .filter((model) => model.providerId === runtimeProviderId)
    .filter(
      (model) =>
        !catalog.data.some(
          (catalogModel) =>
            catalogModel.model === model.modelId || catalogModel.id === model.modelId,
        ),
    )
    .map((model) => ({
      id: model.modelId,
      model: model.modelId,
      displayName:
        model.displayName !== undefined && model.displayName.trim() !== ""
          ? model.displayName.trim()
          : model.modelId,
      ...reasoningMetadata(model.capabilities),
    }));
  const mergedData = [...data, ...missingModels];
  if (mergedData.length === 0 || mergedData.some((model) => model.isDefault === true)) {
    return { ...catalog, data: mergedData };
  }
  return { ...catalog, data: [{ ...mergedData[0]!, isDefault: true }, ...mergedData.slice(1)] };
}

function mergeProviderModelMetadata(
  model: ModelListResult["data"][number],
  availableModels: ProviderModelAccess[],
  providerId: string,
) {
  const providerModel = availableModels.find(
    (candidate) =>
      candidate.providerId === providerId &&
      (candidate.modelId === model.model || candidate.modelId === model.id),
  );
  if (providerModel === undefined) return model;
  const displayName = providerModel.displayName?.trim();
  return {
    ...model,
    ...(displayName !== undefined && displayName !== "" ? { displayName } : {}),
    ...reasoningMetadata(providerModel.capabilities),
  };
}

function reasoningMetadata(capabilities?: ModelCapabilities) {
  if (capabilities === undefined) return {};
  const defaultReasoningEffort = capabilities.defaultReasoningEffort;
  const supportedReasoningEfforts = capabilities.supportedReasoningEfforts;
  return {
    ...(defaultReasoningEffort !== undefined &&
    defaultReasoningEffort !== null &&
    defaultReasoningEffort !== ""
      ? { defaultReasoningEffort }
      : {}),
    ...(supportedReasoningEfforts !== undefined && supportedReasoningEfforts.length > 0
      ? { supportedReasoningEfforts }
      : {}),
  };
}
