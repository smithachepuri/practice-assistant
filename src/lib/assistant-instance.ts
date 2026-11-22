import { createAssistant, createProvider, readProviderSettings, type Assistant } from "@/assistant";

import { DEFAULT_KNOWLEDGE_DIRECTORY, loadKnowledgeDirectory } from "./knowledge-files";

// Kept on globalThis so the demo's in-memory appointments survive hot reloads in development.
const holder = globalThis as unknown as { __practiceAssistant?: Assistant };

/** Returns the shared assistant, creating it on first use. Throws ConfigurationError if no key is set. */
export function getAssistant(): Assistant {
  if (!holder.__practiceAssistant) {
    const provider = createProvider(readProviderSettings());
    const documents = loadKnowledgeDirectory(DEFAULT_KNOWLEDGE_DIRECTORY);
    holder.__practiceAssistant = createAssistant({ provider, documents }).assistant;
  }
  return holder.__practiceAssistant;
}
