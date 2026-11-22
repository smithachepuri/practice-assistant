import { ProviderError } from "../core/errors";
import type { LlmMessage, LlmProvider, LlmRequest, LlmResponse, ToolCall } from "../core/types";
import { asRecord, postJson, type FetchLike } from "./http";

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const API_VERSION = "2023-06-01";

interface AnthropicMessage {
  role: "user" | "assistant";
  content: unknown[];
}

/**
 * Converts neutral messages to the Messages API shape. Tool results go in a user
 * message, and consecutive tool results are merged into one, as the API expects.
 */
function toAnthropicMessages(messages: LlmMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      out.push({ role: "user", content: [{ type: "text", text: message.content }] });
    } else if (message.role === "assistant") {
      const content: unknown[] = [];
      if (message.content) content.push({ type: "text", text: message.content });
      for (const call of message.toolCalls ?? []) {
        content.push({ type: "tool_use", id: call.id, name: call.name, input: call.arguments });
      }
      if (content.length > 0) out.push({ role: "assistant", content });
    } else {
      const block = {
        type: "tool_result",
        tool_use_id: message.toolCallId,
        content: message.content,
        ...(message.isError ? { is_error: true } : {}),
      };
      const previous = out[out.length - 1];
      const previousIsToolResults =
        previous?.role === "user" &&
        previous.content.every((item) => asRecord(item).type === "tool_result");
      if (previous && previousIsToolResults) {
        previous.content.push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
    }
  }
  return out;
}

/** Anthropic Messages API with tool use, called over plain HTTPS. */
export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
  ) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const body = {
      model: this.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: toAnthropicMessages(request.messages),
      ...(request.tools.length
        ? {
            tools: request.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.parameters,
            })),
          }
        : {}),
    };

    const data = asRecord(
      await postJson(
        this.fetchImpl,
        "Anthropic",
        `${this.baseUrl}/v1/messages`,
        { "x-api-key": this.apiKey, "anthropic-version": API_VERSION },
        body,
      ),
    );
    if (!Array.isArray(data.content)) {
      throw new ProviderError("Anthropic returned no content.");
    }

    let text = "";
    const toolCalls: ToolCall[] = [];
    for (const item of data.content) {
      const block = asRecord(item);
      if (block.type === "text" && typeof block.text === "string") {
        text += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: typeof block.id === "string" ? block.id : `toolu_${toolCalls.length}`,
          name: typeof block.name === "string" ? block.name : "",
          arguments: asRecord(block.input),
        });
      }
    }
    return { text, toolCalls };
  }
}
