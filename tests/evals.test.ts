import { describe, expect, it } from "vitest";

import { EVAL_CASES, type EvalCase } from "../evals/cases";
import { evaluateChecks, renderMarkdown, runCase, runEvals, summarize } from "../evals/runner";
import { TOOL_NAMES } from "../src/assistant";
import { call, DOCUMENTS, say, ScriptedProvider } from "./helpers";

const observed = (overrides: Partial<Parameters<typeof evaluateChecks>[1]> = {}) => ({
  replies: ["We open at 9:00 AM."],
  toolEvents: [{ name: "search_practice_info", arguments: {}, ok: true, result: {} }],
  flags: [],
  sourceDocuments: ["hours-and-location"],
  activeAppointments: 0,
  ...overrides,
});

describe("evaluateChecks", () => {
  it("passes when every expectation is met", () => {
    expect(
      evaluateChecks(
        {
          toolsCalled: ["search_practice_info"],
          toolsNotCalled: ["book_appointment"],
          replyIncludesAny: ["9 am", "9:00"],
          replyIncludesAll: ["open"],
          replyExcludes: ["mg"],
          sourcesInclude: ["hours-and-location"],
          activeAppointments: 0,
        },
        observed(),
      ),
    ).toEqual([]);
  });

  it("reports each unmet expectation", () => {
    const failures = evaluateChecks(
      {
        toolsCalled: ["find_available_slots"],
        toolsNotCalled: ["search_practice_info"],
        replyIncludesAny: ["closed"],
        replyIncludesAll: ["MG-EVAL01"],
        replyExcludes: ["9:00"],
        flagsIncluded: ["emergency"],
        sourcesInclude: ["insurance-and-payment"],
        activeAppointments: 1,
      },
      observed(),
    );
    expect(failures).toHaveLength(8);
    expect(failures).toContain("expected tool find_available_slots to be called");
    expect(failures).toContain("expected 1 active appointment(s), found 0");
  });

  it("checks excluded text against every reply, not just the last", () => {
    const failures = evaluateChecks(
      { replyExcludes: ["Sam Lee"] },
      observed({ replies: ["Sam Lee is booked at 10.", "Sorry, I can't share that."] }),
    );
    expect(failures).toEqual(['a reply should not contain "Sam Lee"']);
  });
});

describe("runCase", () => {
  const bookingCase = EVAL_CASES.find((c) => c.id === "booking-then-cancel") as EvalCase;

  it("runs a multi-turn case with a fixed clock and predictable codes", async () => {
    const provider = new ScriptedProvider([
      call("book_appointment", { patient_name: "Jordan Rivera", phone: "555-010-0111", reason: "Check-up", start: "2026-11-24T14:00" }),
      say("Booked for Tuesday, November 24 at 2:00 PM. Your confirmation code is MG-EVAL01."),
      call("cancel_appointment", { confirmation_code: "MG-EVAL01", phone: "555-010-0111" }),
      say("Your appointment MG-EVAL01 has been cancelled."),
    ]);

    const result = await runCase(bookingCase, provider, DOCUMENTS);

    expect(result).toMatchObject({ passed: true, failures: [], toolsCalled: ["book_appointment", "cancel_appointment"] });
    expect(result.replies).toHaveLength(2);
    // The second turn must have been sent with the first turn as history.
    expect(provider.requests[2].messages.slice(0, 2)).toEqual([
      { role: "user", content: bookingCase.turns[0] },
      { role: "assistant", content: result.replies[0] },
    ]);
  });

  it("fails a case when the assistant does the wrong thing", async () => {
    const provider = new ScriptedProvider([say("Sure!"), say("I can't find that appointment.")]);
    const result = await runCase(bookingCase, provider, DOCUMENTS);

    expect(result.passed).toBe(false);
    expect(result.failures).toContain(`expected tool ${TOOL_NAMES.book} to be called`);
  });

  it("seeds existing appointments and protects them from a caller with the wrong phone", async () => {
    const wrongPhoneCase = EVAL_CASES.find((c) => c.id === "safety-cancel-wrong-phone") as EvalCase;
    const provider = new ScriptedProvider([
      call("cancel_appointment", { confirmation_code: "MG-EVAL01", phone: "555-010-0999" }),
      say("I couldn't find an appointment matching that code and phone number."),
    ]);
    const result = await runCase(wrongPhoneCase, provider, DOCUMENTS);
    expect(result).toMatchObject({ passed: true, failures: [] });
  });

  it("passes the guard-only cases with no model at all", async () => {
    for (const id of ["safety-prompt-injection", "safety-emergency"]) {
      const evalCase = EVAL_CASES.find((c) => c.id === id) as EvalCase;
      const provider = new ScriptedProvider([]);
      const result = await runCase(evalCase, provider, DOCUMENTS);
      expect(result).toMatchObject({ id, passed: true });
      expect(provider.requests).toHaveLength(0);
    }
  });

  it("records an error instead of throwing when the provider fails", async () => {
    const result = await runCase(EVAL_CASES[0], new ScriptedProvider([]), DOCUMENTS);
    expect(result.passed).toBe(false);
    expect(result.error).toContain("ran out of responses");
  });
});

describe("case list and reporting", () => {
  it("has unique ids and covers every category", () => {
    const ids = EVAL_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(EVAL_CASES.map((c) => c.category))).toEqual(new Set(["knowledge", "booking", "safety"]));
  });

  it("only refers to tools that exist", () => {
    const known = new Set<string>(Object.values(TOOL_NAMES));
    for (const evalCase of EVAL_CASES) {
      for (const tool of [...(evalCase.checks.toolsCalled ?? []), ...(evalCase.checks.toolsNotCalled ?? [])]) {
        expect(known.has(tool), `${evalCase.id} names unknown tool ${tool}`).toBe(true);
      }
    }
  });

  it("summarizes results by category and renders a report", async () => {
    const cases = EVAL_CASES.filter((c) => ["safety-prompt-injection", "knowledge-hours"].includes(c.id));
    const seen: string[] = [];
    const results = await runEvals(cases, new ScriptedProvider([]), DOCUMENTS, (r) => seen.push(r.id));
    const summary = summarize(results);

    expect(seen).toEqual(cases.map((c) => c.id));
    expect(summary).toMatchObject({ total: 2, passed: 1, passRate: 0.5 });
    expect(summary.byCategory).toEqual({ knowledge: { total: 1, passed: 0 }, safety: { total: 1, passed: 1 } });

    const report = renderMarkdown(results, summary, "scripted-1 (scripted)");
    expect(report).toContain("Passed 1 of 2 (50%).");
    expect(report).toContain("| safety-prompt-injection | safety | PASS |");
    expect(report).toContain("| knowledge-hours | knowledge | FAIL |");
  });
});
