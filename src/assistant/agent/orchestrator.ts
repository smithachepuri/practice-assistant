import type { AuditSink } from "../audit/logger";
import type { AppointmentStore } from "../booking/store";
import type { AssistantConfig } from "../core/config";
import type {
  ChatTurn,
  Clock,
  LlmMessage,
  LlmProvider,
  SafetyFlag,
  Source,
  ToolEvent,
  TurnResult,
} from "../core/types";
import { checkInput } from "../safety/input-guard";
import { checkOutput } from "../safety/output-guard";
import { redactArguments, redactText } from "../safety/redact";
import { TOOL_DEFINITIONS } from "../tools/definitions";
import type { ToolExecutor } from "../tools/executor";
import { buildSystemPrompt } from "./prompts";

export interface AssistantDeps {
  provider: LlmProvider;
  tools: ToolExecutor;
  store: AppointmentStore;
  config: AssistantConfig;
  clock: Clock;
  audit: AuditSink;
}

/**
 * Keeps only plain user/assistant text from client-supplied history. The browser can
 * send anything, so tool messages and unknown roles are dropped, long entries are cut,
 * and the history is trimmed so it starts with a user message.
 */
export function sanitizeHistory(history: unknown, config: AssistantConfig): LlmMessage[] {
  if (!Array.isArray(history)) return [];
  const clean: LlmMessage[] = [];
  for (const item of history) {
    if (item === null || typeof item !== "object") continue;
    const { role, content } = item as { role?: unknown; content?: unknown };
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;
    const text = content.trim().slice(0, config.maxInputChars * 2);
    if (text) clean.push({ role, content: text });
  }
  const recent = clean.slice(-config.maxHistoryTurns);
  const firstUser = recent.findIndex((message) => message.role === "user");
  return firstUser === -1 ? [] : recent.slice(firstUser);
}

export class Assistant {
  constructor(private readonly deps: AssistantDeps) {}

  /** Handles one user message and returns the reply with its sources and safety flags. */
  async respond(history: ChatTurn[] | unknown, userMessage: string): Promise<TurnResult> {
    const { provider, tools, store, config, clock, audit } = this.deps;
    const text = userMessage.trim();
    const flags: SafetyFlag[] = [];
    const toolEvents: ToolEvent[] = [];
    const sources = new Map<string, Source>();
    let modelCalls = 0;

    const finish = (reply: string): TurnResult => {
      audit.write({
        type: "turn",
        at: clock(),
        provider: provider.name,
        model: provider.model,
        userMessage: redactText(text),
        reply: redactText(reply),
        tools: toolEvents.map((event) => ({
          name: event.name,
          ok: event.ok,
          arguments: redactArguments(event.arguments),
        })),
        flags,
        modelCalls,
      });
      return { reply, sources: [...sources.values()], toolEvents, flags };
    };

    if (!text) {
      return finish("How can I help you today?");
    }

    const decision = checkInput(text, config.practice, config.maxInputChars);
    if (decision.action === "block") {
      flags.push(decision.flag);
      return finish(decision.reply);
    }

    const messages: LlmMessage[] = [...sanitizeHistory(history, config), { role: "user", content: text }];
    const system = buildSystemPrompt(config.practice, clock());
    let finalText: string | undefined;

    while (modelCalls < config.maxSteps) {
      modelCalls += 1;
      const response = await provider.complete({
        system,
        messages,
        tools: TOOL_DEFINITIONS,
        maxTokens: config.maxTokens,
      });

      if (response.toolCalls.length === 0) {
        finalText = response.text.trim();
        break;
      }

      messages.push({ role: "assistant", content: response.text, toolCalls: response.toolCalls });
      for (const call of response.toolCalls) {
        const outcome = await tools.execute(call);
        toolEvents.push(outcome.event);
        for (const source of outcome.sources) sources.set(source.id, source);
        messages.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: outcome.content,
          isError: !outcome.event.ok,
        });
      }
    }

    if (finalText === undefined) {
      flags.push("step_limit");
      return finish(
        `I'm having trouble completing that request. Please try again, or call us at ${config.practice.phone}.`,
      );
    }
    if (!finalText) {
      return finish(`Sorry, I didn't catch that. Could you rephrase, or call us at ${config.practice.phone}?`);
    }

    const checked = await checkOutput(finalText, toolEvents, store, config.practice);
    if (checked.flag) flags.push(checked.flag);
    return finish(checked.reply);
  }
}
