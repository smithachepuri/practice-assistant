import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { KnowledgeDocument } from "../assistant";

/** Reads every Markdown file in a folder as a knowledge document. */
export function loadKnowledgeDirectory(directory: string): KnowledgeDocument[] {
  return readdirSync(directory)
    .filter((file) => file.endsWith(".md"))
    .sort()
    .map((file) => ({
      name: file.replace(/\.md$/, ""),
      text: readFileSync(path.join(directory, file), "utf8"),
    }));
}

export const DEFAULT_KNOWLEDGE_DIRECTORY = path.join(process.cwd(), "data", "knowledge");
