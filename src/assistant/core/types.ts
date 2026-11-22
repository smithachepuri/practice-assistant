/** Shared types for the assistant module. Nothing here depends on Next.js. */

/** A message as the browser sees it. Tool traffic never leaves the server. */
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Provider-neutral message format used inside one turn. */
export type LlmMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string; isError?: boolean };

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  tools: ToolDefinition[];
  maxTokens: number;
}

export interface LlmResponse {
  text: string;
  toolCalls: ToolCall[];
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

/** A knowledge-base passage shown to the user as the basis for an answer. */
export interface Source {
  id: string;
  title: string;
  document: string;
}

export type SafetyFlag =
  | "emergency"
  | "injection_blocked"
  | "input_too_long"
  | "medical_advice_blocked"
  | "unverified_booking_blocked"
  | "step_limit";

export interface ToolEvent {
  name: string;
  arguments: Record<string, unknown>;
  ok: boolean;
  result: unknown;
}

export interface TurnResult {
  reply: string;
  sources: Source[];
  toolEvents: ToolEvent[];
  flags: SafetyFlag[];
}

/** Returns the practice's local time as "YYYY-MM-DDTHH:mm". */
export type Clock = () => string;
