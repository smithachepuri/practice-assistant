import { NextResponse } from "next/server";

import { getAssistant } from "@/lib/assistant-instance";
import { handleChat } from "@/lib/chat-handler";
import { createRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const checkRateLimit = createRateLimiter(20, 60_000);

export async function POST(request: Request) {
  const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const limit = checkRateLimit(client);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many messages. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The request body must be JSON." }, { status: 400 });
  }

  const response = await handleChat(body, getAssistant);
  return NextResponse.json(response.body, { status: response.status });
}
