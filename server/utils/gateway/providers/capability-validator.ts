import type { ModelCapabilities } from "~~/shared/types";
import type { ResponsesRequestInput } from "./protocol/types";

export class ProviderCapabilityError extends Error {
  readonly code = "provider_capability_unsupported";

  constructor(message: string) {
    super(message);
    this.name = "ProviderCapabilityError";
  }
}

export function assertProviderSupportsRequest(
  input: ResponsesRequestInput,
  capabilities: ModelCapabilities,
): void {
  if (input.tools !== undefined && input.tools.length > 0) {
    if (!capabilities.tools) throw new ProviderCapabilityError(`Model ${input.model} does not support tools`);
    for (const tool of input.tools) {
      if (tool.type !== "function") {
        throw new ProviderCapabilityError(`Model ${input.model} does not support ${tool.type} tools`);
      }
    }
    if (input.stream === true && !capabilities.streamingTools) {
      throw new ProviderCapabilityError(`Model ${input.model} does not support streaming tools`);
    }
  }
  if (containsVisionInput(input) && !capabilities.vision) {
    throw new ProviderCapabilityError(`Model ${input.model} does not support vision input`);
  }
  if (input.reasoning !== undefined && input.reasoning !== false && !capabilities.reasoning) {
    throw new ProviderCapabilityError(`Model ${input.model} does not support reasoning`);
  }
}

function containsVisionInput(input: ResponsesRequestInput): boolean {
  if (!Array.isArray(input.input)) return false;
  return input.input.some((item) => JSON.stringify(item).includes('"input_image"'));
}
