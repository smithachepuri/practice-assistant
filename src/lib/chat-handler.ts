import { ConfigurationError, ProviderError, type ChatTurn, type TurnResult } from "@/assistant";

export interface ChatResponse {
  status: number;
  body: Record<string, unknown>;
}

interface Responder {
  respond(history: ChatTurn[], userMessage: string): Promise<TurnResult>;
}

const MAX_MESSAGES = 60;

/**
 * Validates a chat request and runs one assistant turn. Kept free of Next.js types
 * so it can be unit tested and reused by another host application.
 */
export async function handleChat(
  body: unknown,
  getAssistant: () => Responder,
  logError: (message: string) => void = console.error,
): Promise<ChatResponse> {
  const messages = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return { status: 400, body: { error: "Send between 1 and 60 messages." } };
  }
  const last = messages[messages.length - 1] as { role?: unknown; content?: unknown } | null;
  if (!last || last.role !== "user" || typeof last.content !== "string" || !last.content.trim()) {
    return { status: 400, body: { error: "The last message must be a non-empty user message." } };
  }

  try {
    const result = await getAssistant().respond(messages.slice(0, -1) as ChatTurn[], last.content);
    // Tool events stay on the server: they hold arguments such as phone numbers.
    return { status: 200, body: { reply: result.reply, sources: result.sources, flags: result.flags } };
  } catch (error) {
    if (error instanceof ConfigurationError) {
      logError(`Assistant is not configured: ${error.message}`);
      return {
        status: 503,
        body: { error: "The assistant is not set up yet. Add an API key to .env.local and restart." },
      };
    }
    if (error instanceof ProviderError) {
      logError(`Model provider error: ${error.message}`);
      return { status: 502, body: { error: "The assistant is temporarily unavailable. Please try again." } };
    }
    logError(`Unexpected chat error: ${String(error)}`);
    return { status: 500, body: { error: "Something went wrong. Please try again." } };
  }
}
