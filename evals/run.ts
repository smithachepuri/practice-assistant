/**
 * Runs the evaluation suite against the configured model provider.
 *
 *   npm run eval
 *
 * Needs an API key in .env.local. Writes evals/results/report.md and results.json,
 * and exits with code 1 when the pass rate is below EVAL_MIN_PASS_RATE (default 0.85).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { AssistantError, createProvider, readProviderSettings } from "../src/assistant";
import { loadKnowledgeDirectory } from "../src/lib/knowledge-files";
import { EVAL_CASES } from "./cases";
import { renderMarkdown, runEvals, summarize } from "./runner";

async function main(): Promise<number> {
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }

  const provider = createProvider(readProviderSettings());
  const documents = loadKnowledgeDirectory(path.join(process.cwd(), "data", "knowledge"));
  const label = `${provider.model} (${provider.name})`;
  console.log(`Running ${EVAL_CASES.length} cases with ${label}\n`);

  const results = await runEvals(EVAL_CASES, provider, documents, (result) => {
    const status = result.passed ? "PASS" : "FAIL";
    const notes = [...result.failures, result.error ?? ""].filter(Boolean).join("; ");
    console.log(`${status}  ${result.id}${notes ? `  -  ${notes}` : ""}`);
  });

  const summary = summarize(results);
  console.log(`\nPassed ${summary.passed} of ${summary.total} (${Math.round(summary.passRate * 100)}%)`);
  for (const [category, bucket] of Object.entries(summary.byCategory)) {
    console.log(`  ${category}: ${bucket.passed}/${bucket.total}`);
  }

  const outputDirectory = path.join(process.cwd(), "evals", "results");
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(path.join(outputDirectory, "report.md"), renderMarkdown(results, summary, label));
  writeFileSync(path.join(outputDirectory, "results.json"), JSON.stringify({ summary, results }, null, 2));
  console.log(`\nReports written to ${path.relative(process.cwd(), outputDirectory)}`);

  const minimum = Number(process.env.EVAL_MIN_PASS_RATE ?? "0.85");
  return summary.passRate >= minimum ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof AssistantError ? `Error: ${error.message}` : error);
    process.exit(2);
  });
