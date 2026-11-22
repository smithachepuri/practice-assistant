import path from "node:path";

import {
  createAssistant,
  MemoryAuditSink,
  type AssistantBundle,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
  type ToolCall,
} from "../src/assistant";
import { loadKnowledgeDirectory } from "../src/lib/knowledge-files";

/** Monday morning, before the practice opens. */
export const NOW = "2026-11-23T08:00";

export const DOCUMENTS = loadKnowledgeDirectory(path.join(__dirname, "..", "data", "knowledge"));

type Step = LlmResponse | ((request: LlmRequest) => LlmResponse);

/** Stands in for a model: returns queued responses in order and records every request. */
export class ScriptedProvider implements LlmProvider {
  readonly name = "scripted";
  readonly model = "scripted-1";
  readonly requests: LlmRequest[] = [];

  constructor(private readonly steps: Step[]) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    // Copy the messages: the orchestrator keeps appending to the same array.
    this.requests.push({ ...request, messages: [...request.messages] });
    const step = this.steps.shift();
    if (!step) throw new Error("ScriptedProvider ran out of responses");
    return typeof step === "function" ? step(request) : step;
  }
}

let callCounter = 0;

export function say(text: string): LlmResponse {
  return { text, toolCalls: [] };
}

export function call(name: string, args: Record<string, unknown>, text = ""): LlmResponse {
  const toolCall: ToolCall = { id: `call_${++callCounter}`, name, arguments: args };
  return { text, toolCalls: [toolCall] };
}

export interface TestBundle extends AssistantBundle {
  provider: ScriptedProvider;
  audit: MemoryAuditSink;
}

export function makeBundle(steps: Step[] = [], now: string = NOW): TestBundle {
  const provider = new ScriptedProvider(steps);
  const audit = new MemoryAuditSink();
  let codeCounter = 0;
  const bundle = createAssistant({
    provider,
    documents: DOCUMENTS,
    clock: () => now,
    audit,
    generateCode: () => `TEST${String(++codeCounter).padStart(2, "0")}`,
  });
  return { ...bundle, provider, audit };
}

export const JORDAN = {
  patientName: "Jordan Rivera",
  phone: "555-010-0111",
  reason: "Cleaning",
  start: "2026-11-24T10:00",
};
