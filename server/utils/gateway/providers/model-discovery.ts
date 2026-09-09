import type {
  ModelCapabilities,
  ModelReasoningEffort,
  ProviderModelInput,
  UpstreamWireApi,
} from "~~/shared/types";
import { modelCapabilitiesSchema, providerBaseUrlSchema } from "../http/validation/providers";

type ProviderWithSecret = {
  baseUrl: string;
  wireApi: UpstreamWireApi;
  apiKey: string;
  requestTimeoutMs: number;
};

export class ModelDiscoveryError extends Error {
  readonly code = "provider_model_discovery_failed";
  readonly statusCode = 502;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ModelDiscoveryError";
  }
}

export async function discoverProviderModels(
  provider: ProviderWithSecret,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<ProviderModelInput[]> {
  const baseUrl = providerBaseUrlSchema.parse(provider.baseUrl).replace(/\/+$/, "");
  const url = `${baseUrl}/models`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), provider.requestTimeoutMs);

  try {
    const response = await fetcher(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${provider.apiKey}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new ModelDiscoveryError(`Upstream model listing failed with HTTP ${response.status}`);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new ModelDiscoveryError("Upstream model listing returned invalid JSON", {
        cause: error,
      });
    }
    return normalizeModelList(payload);
  } catch (error) {
    if (error instanceof ModelDiscoveryError) throw error;
    if (controller.signal.aborted) {
      throw new ModelDiscoveryError("Upstream model listing timed out", { cause: error });
    }
    throw new ModelDiscoveryError("Unable to reach upstream model listing", { cause: error });
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizeModelList(payload: unknown): ProviderModelInput[] {
  const records = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.data)
      ? payload.data
      : null;
  if (records === null) {
    throw new ModelDiscoveryError("Upstream model listing did not contain a data array");
  }

  const models: ProviderModelInput[] = [];
  const seen = new Set<string>();
  for (const value of records.slice(0, 500)) {
    const model = normalizeModel(value);
    if (model === null || seen.has(model.modelId)) continue;
    seen.add(model.modelId);
    models.push(model);
  }
  if (models.length === 0) {
    throw new ModelDiscoveryError("Upstream model listing contained no usable models");
  }
  return models;
}

function normalizeModel(value: unknown): ProviderModelInput | null {
  if (!isRecord(value)) return null;
  const modelId = firstString(value, ["id", "model", "model_id", "name"]);
  if (modelId === null || modelId.length > 256) return null;
  const displayName =
    firstString(value, ["display_name", "displayName", "name", "model", "id"]) ?? modelId;
  const capabilities = capabilitiesFromModel(value);
  return {
    modelId,
    displayName: displayName.slice(0, 256),
    enabled: true,
    capabilities,
  };
}

function capabilitiesFromModel(model: Record<string, unknown>): ModelCapabilities {
  const nested = [
    recordValue(model, "capabilities"),
    recordValue(model, "metadata"),
    recordValue(model, "architecture"),
  ].filter((value): value is Record<string, unknown> => value !== null);
  const sources = [model, ...nested];
  const reasoningEfforts = parseReasoningEfforts(sources);
  const defaultReasoningEffort = firstStringFromSources(sources, [
    "default_reasoning_effort",
    "defaultReasoningEffort",
    "default_effort",
  ]);
  const reasoning = firstBooleanFromSources(sources, [
    "reasoning",
    "supports_reasoning",
    "supportsReasoning",
    "reasoning_support",
  ]);
  const supportedParameters = sources.flatMap((source) =>
    Array.isArray(source.supported_parameters)
      ? source.supported_parameters.filter((value): value is string => typeof value === "string")
      : [],
  );
  const inputModalities = sources.flatMap((source) =>
    Array.isArray(source.input_modalities)
      ? source.input_modalities.filter((value): value is string => typeof value === "string")
      : [],
  );
  if (
    defaultReasoningEffort &&
    !reasoningEfforts.some((item) => item.reasoningEffort === defaultReasoningEffort)
  ) {
    reasoningEfforts.unshift({ reasoningEffort: defaultReasoningEffort, description: null });
  }
  const capabilities = {
    tools:
      firstBooleanFromSources(sources, [
        "tools",
        "supports_tools",
        "supportsTools",
        "tool_calling",
        "function_calling",
      ]) ??
      (supportedParameters.length === 0 ||
        supportedParameters.some((value) => value === "tools" || value === "tool_choice")),
    streamingTools:
      firstBooleanFromSources(sources, [
        "streaming_tools",
        "streamingTools",
        "supports_streaming_tools",
        "supportsStreamingTools",
      ]) ?? true,
    vision:
      firstBooleanFromSources(sources, [
        "vision",
        "supports_vision",
        "supportsVision",
        "image_input",
        "supports_image_input",
        "supportsImageInput",
      ]) ?? inputModalities.some((value) => value.toLowerCase() === "image"),
    reasoning: reasoning ?? true,
    maxContextTokens: firstPositiveIntegerFromSources(sources, [
      "max_context_tokens",
      "maxContextTokens",
      "context_length",
      "contextLength",
      "context_window",
      "contextWindow",
    ]),
    defaultReasoningEffort,
    supportedReasoningEfforts: reasoningEfforts,
  } satisfies ModelCapabilities;
  return modelCapabilitiesSchema.parse(capabilities);
}

function parseReasoningEfforts(sources: Record<string, unknown>[]): ModelReasoningEffort[] {
  const values = sources.flatMap((source) =>
    [
      source.supported_reasoning_efforts,
      source.supportedReasoningEfforts,
      source.reasoning_efforts,
      source.reasoningEfforts,
      recordValue(source, "reasoning")?.supported_efforts,
      recordValue(source, "reasoning")?.supportedEfforts,
    ].flatMap((value) => (Array.isArray(value) ? value : [])),
  );
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const effort =
      typeof value === "string"
        ? value.trim()
        : isRecord(value)
          ? firstString(value, ["reasoning_effort", "reasoningEffort", "effort", "name", "id"])
          : null;
    if (effort === null || effort.length > 64 || seen.has(effort)) return [];
    seen.add(effort);
    const description = isRecord(value)
      ? firstString(value, ["description", "label", "display_name"])
      : null;
    return [{ reasoningEffort: effort, description }];
  });
}

function firstStringFromSources(sources: Record<string, unknown>[], keys: string[]): string | null {
  for (const source of sources) {
    const value = firstString(source, keys);
    if (value !== null) return value;
  }
  return null;
}

function firstBooleanFromSources(
  sources: Record<string, unknown>[],
  keys: string[],
): boolean | null {
  for (const source of sources) {
    for (const key of keys) {
      if (typeof source[key] === "boolean") return source[key];
    }
  }
  return null;
}

function firstPositiveIntegerFromSources(
  sources: Record<string, unknown>[],
  keys: string[],
): number | null {
  for (const source of sources) {
    for (const key of keys) {
      const value = source[key];
      const number =
        typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
      if (Number.isSafeInteger(number) && number > 0) return number;
    }
  }
  return null;
}

function firstString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

function recordValue(source: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = source[key];
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
