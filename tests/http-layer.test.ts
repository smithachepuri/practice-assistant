import { describe, expect, it } from "vitest";

import { ConfigurationError, practiceClock, ProviderError, type TurnResult } from "../src/assistant";
import { handleChat } from "../src/lib/chat-handler";
import { createRateLimiter } from "../src/lib/rate-limit";

const RESULT: TurnResult = {
  reply: "We open at 9:00 AM.",
  sources: [{ id: "hours-and-location#office-hours", title: "Hours and Location: Office hours", document: "hours-and-location" }],
  toolEvents: [{ name: "book_appointment", arguments: { phone: "555-010-0111" }, ok: true, result: {} }],
  flags: [],
};

function responder(result: TurnResult = RESULT) {
  const calls: { history: unknown; message: string }[] = [];
  return {
    calls,
    get: () => ({
      respond: async (history: unknown, message: string) => {
        calls.push({ history, message });
        return result;
      },
    }),
  };
}

const quiet = () => {};

describe("handleChat", () => {
  it("passes the last message and prior history to the assistant", async () => {
    const { calls, get } = responder();
    const response = await handleChat(
      {
        messages: [
          { role: "user", content: "Hi" },
          { role: "assistant", content: "Hello!" },
          { role: "user", content: "What time do you open?" },
        ],
      },
      get,
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        history: [
          { role: "user", content: "Hi" },
          { role: "assistant", content: "Hello!" },
        ],
        message: "What time do you open?",
      },
    ]);
  });

  it("returns the reply, sources and flags but never tool events", async () => {
    const response = await handleChat({ messages: [{ role: "user", content: "Hi" }] }, responder().get);
    expect(response.body).toEqual({ reply: RESULT.reply, sources: RESULT.sources, flags: [] });
    expect(JSON.stringify(response.body)).not.toContain("0111");
  });

  it.each([
    ["null body", null],
    ["missing messages", {}],
    ["empty messages", { messages: [] }],
    ["messages not an array", { messages: "hi" }],
    ["last message from assistant", { messages: [{ role: "assistant", content: "Hi" }] }],
    ["blank last message", { messages: [{ role: "user", content: "   " }] }],
    ["non-text content", { messages: [{ role: "user", content: { text: "hi" } }] }],
    ["too many messages", { messages: Array.from({ length: 61 }, () => ({ role: "user", content: "hi" })) }],
  ])("rejects %s with 400", async (_label, body) => {
    const { calls, get } = responder();
    const response = await handleChat(body, get);
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("maps errors to safe responses without leaking details", async () => {
    const failing = (error: Error) => () => {
      throw error;
    };
    const body = { messages: [{ role: "user", content: "Hi" }] };
    const logged: string[] = [];
    const log = (message: string) => logged.push(message);

    const notConfigured = await handleChat(body, failing(new ConfigurationError("OPENAI_API_KEY is not set")), log);
    expect(notConfigured.status).toBe(503);

    const providerDown = await handleChat(body, failing(new ProviderError("OpenAI returned HTTP 401: sk-secret", 401)), log);
    expect(providerDown.status).toBe(502);
    expect(JSON.stringify(providerDown.body)).not.toContain("sk-secret");

    const unexpected = await handleChat(body, failing(new Error("boom")), quiet);
    expect(unexpected.status).toBe(500);
    expect(JSON.stringify(unexpected.body)).not.toContain("boom");

    expect(logged).toHaveLength(2);
    expect(logged[1]).toContain("401");
  });
});

describe("rate limiter", () => {
  it("allows requests up to the limit, then blocks until the window ends", () => {
    let time = 1_000_000;
    const check = createRateLimiter(3, 60_000, () => time);

    expect([check("a"), check("a"), check("a")].every((r) => r.allowed)).toBe(true);
    expect(check("a")).toEqual({ allowed: false, retryAfterSeconds: 60 });

    time += 45_000;
    expect(check("a")).toEqual({ allowed: false, retryAfterSeconds: 15 });

    time += 15_000;
    expect(check("a").allowed).toBe(true);
  });

  it("tracks each client separately", () => {
    const check = createRateLimiter(1, 60_000, () => 0);
    expect(check("a").allowed).toBe(true);
    expect(check("b").allowed).toBe(true);
    expect(check("a").allowed).toBe(false);
  });
});

describe("practiceClock", () => {
  it("reports local time in the practice's time zone", () => {
    const fixed = () => new Date("2026-11-24T02:05:00Z");
    expect(practiceClock("America/Los_Angeles", fixed)()).toBe("2026-11-23T18:05");
    expect(practiceClock("Asia/Kolkata", fixed)()).toBe("2026-11-24T07:35");
  });

  it("writes midnight as 00, not 24", () => {
    const midnight = () => new Date("2026-11-24T08:00:00Z");
    expect(practiceClock("America/Los_Angeles", midnight)()).toBe("2026-11-24T00:00");
  });
});
