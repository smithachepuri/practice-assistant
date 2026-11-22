import type { ProviderSettings } from "../core/config";
import type { LlmProvider } from "../core/types";
import { AnthropicProvider } from "./anthropic";
import type { FetchLike } from "./http";
import { OpenAiProvider } from "./openai";

export function createProvider(settings: ProviderSettings, fetchImpl?: FetchLike): LlmProvider {
  return settings.provider === "anthropic"
    ? new AnthropicProvider(settings.apiKey, settings.model, fetchImpl, settings.baseUrl)
    : new OpenAiProvider(settings.apiKey, settings.model, fetchImpl, settings.baseUrl);
}
