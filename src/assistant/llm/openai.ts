import { ProviderError } from "../core/errors";
import type { LlmMessage, LlmProvider, LlmRequest, LlmResponse, ToolCall } from "../core/types";
import { asRecord, postJson, type FetchLike } from "./http";

const DEFAULT_BASE_URL = "https://api.openai.com";

function toOpenAiMessages(system: string, messages: LlmMessage[]): unknown[] {
  const out: unknown[] = [{ role: "system", content: system }];
  for (const message of messages) {
    if (message.role === "user") {
      out.push({ role: "user", content: message.content });
    } else if (message.role === "assistant") {
      out.push({
        role: "assistant",
        content: message.content || null,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
              })),
            }
          : {}),
      });
    } else {
      out.push({ role: "tool", tool_call_id: message.toolCallId, content: message.content });
    }
  }
  return out;
}

function parseToolCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, index) => {
    const call = asRecord(item);
    const fn = asRecord(call.function);
    let args: Record<string, unknown> = {};
    try {
      args = asRecord(JSON.parse(typeof fn.arguments === "string" ? fn.arguments : "{}"));
    } catch {
      // Malformed arguments are passed on as empty; the tool executor reports what is missing.
    }
    return {
      id: typeof call.id === "string" ? call.id : `call_${index}`,
      name: typeof fn.name === "string" ? fn.name : "",
      arguments: args,
    };
  });
}

/** OpenAI Chat Completions with function tools, called over plain HTTPS. */
export class OpenAiProvider implements LlmProvider {
  readonly name = "openai";

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
  ) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const body = {
      model: this.model,
      max_completion_tokens: request.maxTokens,
      messages: toOpenAiMessages(request.system, request.messages),
      ...(request.tools.length
        ? {
            tools: request.tools.map((tool) => ({
              type: "function",
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              },
            })),
          }
        : {}),
    };

    const data = asRecord(
      await postJson(
        this.fetchImpl,
        "OpenAI",
        `${this.baseUrl}/v1/chat/completions`,
        { authorization: `Bearer ${this.apiKey}` },
        body,
      ),
    );
    const choices = Array.isArray(data.choices) ? data.choices : [];
    if (choices.length === 0) {
      throw new ProviderError("OpenAI returned no choices.");
    }
    const message = asRecord(asRecord(choices[0]).message);
    return {
      text: typeof message.content === "string" ? message.content : "",
      toolCalls: parseToolCalls(message.tool_calls),
    };
  }
}
