import {
  createAssistant,
  MemoryAuditSink,
  type ChatTurn,
  type KnowledgeDocument,
  type LlmProvider,
  type SafetyFlag,
  type ToolEvent,
} from "../src/assistant";
import type { EvalCase, EvalChecks } from "./cases";

export const EVAL_CLOCK = "2026-11-23T08:00";

export interface EvalCaseResult {
  id: string;
  category: EvalCase["category"];
  description: string;
  passed: boolean;
  failures: string[];
  replies: string[];
  toolsCalled: string[];
  flags: SafetyFlag[];
  error?: string;
}

export interface EvalSummary {
  total: number;
  passed: number;
  passRate: number;
  byCategory: Record<string, { total: number; passed: number }>;
}

interface Observed {
  replies: string[];
  toolEvents: ToolEvent[];
  flags: SafetyFlag[];
  sourceDocuments: string[];
  activeAppointments: number;
}

const includes = (text: string, needle: string) => text.toLowerCase().includes(needle.toLowerCase());

/** Compares what happened in a conversation with what the case expects. */
export function evaluateChecks(checks: EvalChecks, observed: Observed): string[] {
  const failures: string[] = [];
  const called = observed.toolEvents.map((event) => event.name);
  const finalReply = observed.replies[observed.replies.length - 1] ?? "";

  for (const tool of checks.toolsCalled ?? []) {
    if (!called.includes(tool)) failures.push(`expected tool ${tool} to be called`);
  }
  for (const tool of checks.toolsNotCalled ?? []) {
    if (called.includes(tool)) failures.push(`tool ${tool} should not have been called`);
  }
  if (checks.replyIncludesAny && !checks.replyIncludesAny.some((needle) => includes(finalReply, needle))) {
    failures.push(`final reply should mention one of: ${checks.replyIncludesAny.join(" | ")}`);
  }
  for (const needle of checks.replyIncludesAll ?? []) {
    if (!includes(finalReply, needle)) failures.push(`final reply should mention "${needle}"`);
  }
  for (const needle of checks.replyExcludes ?? []) {
    if (observed.replies.some((reply) => includes(reply, needle))) {
      failures.push(`a reply should not contain "${needle}"`);
    }
  }
  for (const flag of checks.flagsIncluded ?? []) {
    if (!observed.flags.includes(flag)) failures.push(`expected safety flag ${flag}`);
  }
  for (const document of checks.sourcesInclude ?? []) {
    if (!observed.sourceDocuments.includes(document)) failures.push(`expected a source from ${document}`);
  }
  if (checks.activeAppointments !== undefined && observed.activeAppointments !== checks.activeAppointments) {
    failures.push(
      `expected ${checks.activeAppointments} active appointment(s), found ${observed.activeAppointments}`,
    );
  }
  return failures;
}

/** Runs one case against a fresh assistant with a fixed clock and predictable codes. */
export async function runCase(
  evalCase: EvalCase,
  provider: LlmProvider,
  documents: KnowledgeDocument[],
): Promise<EvalCaseResult> {
  let codeCounter = 0;
  const { assistant, booking, store } = createAssistant({
    provider,
    documents,
    clock: () => EVAL_CLOCK,
    audit: new MemoryAuditSink(),
    generateCode: () => `EVAL${String(++codeCounter).padStart(2, "0")}`,
  });

  const observed: Observed = {
    replies: [],
    toolEvents: [],
    flags: [],
    sourceDocuments: [],
    activeAppointments: 0,
  };
  const base = { id: evalCase.id, category: evalCase.category, description: evalCase.description };

  try {
    for (const seed of evalCase.seed ?? []) await booking.book(seed);

    const history: ChatTurn[] = [];
    for (const turn of evalCase.turns) {
      const result = await assistant.respond(history, turn);
      history.push({ role: "user", content: turn }, { role: "assistant", content: result.reply });
      observed.replies.push(result.reply);
      observed.toolEvents.push(...result.toolEvents);
      observed.flags.push(...result.flags);
      observed.sourceDocuments.push(...result.sources.map((source) => source.document));
    }
    observed.activeAppointments = (await store.list()).filter((a) => a.status === "booked").length;
  } catch (error) {
    return {
      ...base,
      passed: false,
      failures: ["the conversation could not be completed"],
      replies: observed.replies,
      toolsCalled: observed.toolEvents.map((event) => event.name),
      flags: observed.flags,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const failures = evaluateChecks(evalCase.checks, observed);
  return {
    ...base,
    passed: failures.length === 0,
    failures,
    replies: observed.replies,
    toolsCalled: observed.toolEvents.map((event) => event.name),
    flags: observed.flags,
  };
}

export async function runEvals(
  cases: EvalCase[],
  provider: LlmProvider,
  documents: KnowledgeDocument[],
  onResult?: (result: EvalCaseResult) => void,
): Promise<EvalCaseResult[]> {
  const results: EvalCaseResult[] = [];
  for (const evalCase of cases) {
    const result = await runCase(evalCase, provider, documents);
    results.push(result);
    onResult?.(result);
  }
  return results;
}

export function summarize(results: EvalCaseResult[]): EvalSummary {
  const byCategory: EvalSummary["byCategory"] = {};
  for (const result of results) {
    const bucket = (byCategory[result.category] ??= { total: 0, passed: 0 });
    bucket.total += 1;
    if (result.passed) bucket.passed += 1;
  }
  const passed = results.filter((result) => result.passed).length;
  return {
    total: results.length,
    passed,
    passRate: results.length ? Math.round((passed / results.length) * 1000) / 1000 : 0,
    byCategory,
  };
}

export function renderMarkdown(results: EvalCaseResult[], summary: EvalSummary, judge: string): string {
  const lines = [
    "# Evaluation report",
    "",
    `Model: ${judge}`,
    "",
    `Passed ${summary.passed} of ${summary.total} (${Math.round(summary.passRate * 100)}%).`,
    "",
    "| Category | Passed | Total |",
    "|---|---|---|",
    ...Object.entries(summary.byCategory).map(([name, b]) => `| ${name} | ${b.passed} | ${b.total} |`),
    "",
    "| Case | Category | Result | Notes |",
    "|---|---|---|---|",
    ...results.map(
      (r) =>
        `| ${r.id} | ${r.category} | ${r.passed ? "PASS" : "FAIL"} | ${[...r.failures, r.error ?? ""]
          .filter(Boolean)
          .join("; ")
          .replace(/\|/g, "\\|")} |`,
    ),
    "",
  ];
  return lines.join("\n");
}
