import { describe, expect, it } from "vitest";

import { ConfigurationError, createProvider, ProviderError, readProviderSettings, type LlmRequest } from "../src/assistant";
import { AnthropicProvider } from "../src/assistant/llm/anthropic";
import type { FetchLike } from "../src/assistant/llm/http";
import { OpenAiProvider } from "../src/assistant/llm/openai";

function fakeFetch(status: number, payload: unknown) {
  const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof payload === "string" ? payload : JSON.stringify(payload)),
    };
  };
  return { fetchImpl, calls };
}

const REQUEST: LlmRequest = {
  system: "SYSTEM",
  maxTokens: 800,
  tools: [
    {
      name: "find_available_slots",
      description: "List open times",
      parameters: { type: "object", properties: { date: { type: "string", description: "Date" } }, required: [] },
    },
  ],
  messages: [
    { role: "user", content: "Any times Tuesday?" },
    {
      role: "assistant",
      content: "",
      toolCalls: [
        { id: "c1", name: "find_available_slots", arguments: { date: "2026-11-24" } },
        { id: "c2", name: "search_practice_info", arguments: { query: "hours" } },
      ],
    },
    { role: "tool", toolCallId: "c1", name: "find_available_slots", content: '{"open_times":[]}' },
    { role: "tool", toolCallId: "c2", name: "search_practice_info", content: '{"error":"x"}', isError: true },
  ],
};

describe("OpenAiProvider", () => {
  it("builds a Chat Completions request with tools and tool results", async () => {
    const { fetchImpl, calls } = fakeFetch(200, { choices: [{ message: { content: "Hello" } }] });
    await new OpenAiProvider("sk-test", "model-x", fetchImpl).complete(REQUEST);

    const { url, headers, body } = calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(headers.authorization).toBe("Bearer sk-test");
    expect(body.model).toBe("model-x");
    expect(body.max_completion_tokens).toBe(800);
    expect(body).not.toHaveProperty("temperature");
    expect(body.tools[0]).toEqual({
      type: "function",
      function: { name: "find_available_slots", description: "List open times", parameters: REQUEST.tools[0].parameters },
    });
    expect(body.messages).toEqual([
      { role: "system", content: "SYSTEM" },
      { role: "user", content: "Any times Tuesday?" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "c1", type: "function", function: { name: "find_available_slots", arguments: '{"date":"2026-11-24"}' } },
          { id: "c2", type: "function", function: { name: "search_practice_info", arguments: '{"query":"hours"}' } },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: '{"open_times":[]}' },
      { role: "tool", tool_call_id: "c2", content: '{"error":"x"}' },
    ]);
  });

  it("parses text and tool calls from the response", async () => {
    const { fetchImpl } = fakeFetch(200, {
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: "call_9", type: "function", function: { name: "book_appointment", arguments: '{"start":"2026-11-24T10:00"}' } },
              { id: "call_10", type: "function", function: { name: "search_practice_info", arguments: "not json" } },
            ],
          },
        },
      ],
    });
    const response = await new OpenAiProvider("k", "m", fetchImpl).complete({ ...REQUEST, tools: [] });

    expect(response.text).toBe("");
    expect(response.toolCalls).toEqual([
      { id: "call_9", name: "book_appointment", arguments: { start: "2026-11-24T10:00" } },
      { id: "call_10", name: "search_practice_info", arguments: {} },
    ]);
  });

  it("omits the tools field when there are no tools", async () => {
    const { fetchImpl, calls } = fakeFetch(200, { choices: [{ message: { content: "Hi" } }] });
    await new OpenAiProvider("k", "m", fetchImpl).complete({ ...REQUEST, tools: [] });
    expect(calls[0].body).not.toHaveProperty("tools");
  });

  it("raises ProviderError for an HTTP error, bad JSON and an empty response", async () => {
    const provider = (status: number, payload: unknown) =>
      new OpenAiProvider("k", "m", fakeFetch(status, payload).fetchImpl).complete(REQUEST);

    await expect(provider(401, { error: { message: "bad key" } })).rejects.toMatchObject({
      name: "ProviderError",
      status: 401,
    });
    await expect(provider(200, "<html>oops</html>")).rejects.toThrow(ProviderError);
    await expect(provider(200, { choices: [] })).rejects.toThrow("no choices");
  });

  it("raises ProviderError when the request cannot be sent", async () => {
    const failing: FetchLike = async () => {
      throw new Error("network down");
    };
    await expect(new OpenAiProvider("k", "m", failing).complete(REQUEST)).rejects.toThrow(/could not be sent.*network down/);
  });
});

describe("AnthropicProvider", () => {
  it("builds a Messages request, merging consecutive tool results into one user message", async () => {
    const { fetchImpl, calls } = fakeFetch(200, { content: [{ type: "text", text: "Hello" }] });
    await new AnthropicProvider("sk-ant-test", "claude-x", fetchImpl).complete(REQUEST);

    const { url, headers, body } = calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(headers["x-api-key"]).toBe("sk-ant-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(body.model).toBe("claude-x");
    expect(body.max_tokens).toBe(800);
    expect(body.system).toBe("SYSTEM");
    expect(body).not.toHaveProperty("temperature");
    expect(body.tools[0]).toEqual({
      name: "find_available_slots",
      description: "List open times",
      input_schema: REQUEST.tools[0].parameters,
    });
    expect(body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "Any times Tuesday?" }] },
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "c1", name: "find_available_slots", input: { date: "2026-11-24" } },
          { type: "tool_use", id: "c2", name: "search_practice_info", input: { query: "hours" } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "c1", content: '{"open_times":[]}' },
          { type: "tool_result", tool_use_id: "c2", content: '{"error":"x"}', is_error: true },
        ],
      },
    ]);
  });

  it("parses text and tool_use blocks from the response", async () => {
    const { fetchImpl } = fakeFetch(200, {
      content: [
        { type: "text", text: "Let me check. " },
        { type: "tool_use", id: "toolu_1", name: "find_available_slots", input: { date: "2026-11-24" } },
        { type: "thinking", thinking: "ignored" },
      ],
    });
    const response = await new AnthropicProvider("k", "m", fetchImpl).complete(REQUEST);

    expect(response).toEqual({
      text: "Let me check. ",
      toolCalls: [{ id: "toolu_1", name: "find_available_slots", arguments: { date: "2026-11-24" } }],
    });
  });

  it("raises ProviderError for an HTTP error and a response without content", async () => {
    const provider = (status: number, payload: unknown) =>
      new AnthropicProvider("k", "m", fakeFetch(status, payload).fetchImpl).complete(REQUEST);

    await expect(provider(529, { error: { type: "overloaded_error" } })).rejects.toMatchObject({ status: 529 });
    await expect(provider(200, { type: "message" })).rejects.toThrow("no content");
  });
});

describe("provider settings", () => {
  it("defaults to OpenAI with its default model", () => {
    expect(readProviderSettings({ OPENAI_API_KEY: " sk-1 " })).toEqual({
      provider: "openai",
      apiKey: "sk-1",
      model: "gpt-5.4-mini",
    });
  });

  it("reads the Anthropic provider and a model override", () => {
    expect(
      readProviderSettings({ ASSISTANT_PROVIDER: "Anthropic", ANTHROPIC_API_KEY: "sk-ant", ANTHROPIC_MODEL: "claude-custom" }),
    ).toEqual({ provider: "anthropic", apiKey: "sk-ant", model: "claude-custom" });
  });

  it("explains what is missing", () => {
    expect(() => readProviderSettings({})).toThrow(ConfigurationError);
    expect(() => readProviderSettings({})).toThrow("OPENAI_API_KEY is not set");
    expect(() => readProviderSettings({ ASSISTANT_PROVIDER: "anthropic" })).toThrow("ANTHROPIC_API_KEY is not set");
    expect(() => readProviderSettings({ ASSISTANT_PROVIDER: "gemini" })).toThrow('must be "openai" or "anthropic"');
  });

  it("reads an optional base URL and uses it for requests", async () => {
    const settings = readProviderSettings({ OPENAI_API_KEY: "k", OPENAI_BASE_URL: "https://gateway.example/openai/" });
    expect(settings.baseUrl).toBe("https://gateway.example/openai");

    const { fetchImpl, calls } = fakeFetch(200, { choices: [{ message: { content: "Hi" } }] });
    await createProvider(settings, fetchImpl).complete(REQUEST);
    expect(calls[0].url).toBe("https://gateway.example/openai/v1/chat/completions");

    const anthropic = fakeFetch(200, { content: [{ type: "text", text: "Hi" }] });
    await createProvider(
      { provider: "anthropic", apiKey: "k", model: "m", baseUrl: "http://localhost:9999" },
      anthropic.fetchImpl,
    ).complete(REQUEST);
    expect(anthropic.calls[0].url).toBe("http://localhost:9999/v1/messages");
  });

  it("creates the matching provider", () => {
    expect(createProvider({ provider: "openai", apiKey: "k", model: "m" })).toMatchObject({ name: "openai", model: "m" });
    expect(createProvider({ provider: "anthropic", apiKey: "k", model: "m" })).toMatchObject({ name: "anthropic", model: "m" });
  });
});
