/**
 * Public entry point of the assistant module.
 *
 * Everything under src/assistant is plain TypeScript with no framework imports, so the
 * folder can be copied into another application. The host supplies a model provider,
 * the practice documents, and (optionally) its own appointment store, clock and audit sink.
 */
import { Assistant } from "./agent/orchestrator";
import { ConsoleAuditSink, type AuditSink } from "./audit/logger";
import { BookingService } from "./booking/service";
import { InMemoryAppointmentStore, type AppointmentStore } from "./booking/store";
import { DEFAULT_CONFIG, practiceClock, type AssistantConfig } from "./core/config";
import type { Clock, LlmProvider } from "./core/types";
import { chunkDocuments, type KnowledgeDocument } from "./knowledge/loader";
import { Bm25Retriever, type Retriever } from "./knowledge/retriever";
import { ToolExecutor } from "./tools/executor";

export interface CreateAssistantOptions {
  provider: LlmProvider;
  documents: KnowledgeDocument[];
  config?: AssistantConfig;
  store?: AppointmentStore;
  retriever?: Retriever;
  clock?: Clock;
  audit?: AuditSink;
  generateCode?: () => string;
}

export interface AssistantBundle {
  assistant: Assistant;
  booking: BookingService;
  store: AppointmentStore;
}

export function createAssistant(options: CreateAssistantOptions): AssistantBundle {
  const config = options.config ?? DEFAULT_CONFIG;
  const clock = options.clock ?? practiceClock(config.practice.timeZone);
  const store = options.store ?? new InMemoryAppointmentStore();
  const retriever = options.retriever ?? new Bm25Retriever(chunkDocuments(options.documents));
  const booking = new BookingService(store, config.practice, clock, options.generateCode);
  const assistant = new Assistant({
    provider: options.provider,
    tools: new ToolExecutor(retriever, booking),
    store,
    config,
    clock,
    audit: options.audit ?? new ConsoleAuditSink(),
  });
  return { assistant, booking, store };
}

export { Assistant, sanitizeHistory } from "./agent/orchestrator";
export { ConsoleAuditSink, MemoryAuditSink } from "./audit/logger";
export type { AuditEvent, AuditSink } from "./audit/logger";
export { BookingService, normalizePhone } from "./booking/service";
export { InMemoryAppointmentStore } from "./booking/store";
export type { Appointment, AppointmentStore } from "./booking/store";
export { DEFAULT_CONFIG, DEFAULT_PRACTICE, practiceClock, readProviderSettings } from "./core/config";
export type { AssistantConfig, PracticeConfig, ProviderSettings } from "./core/config";
export { AssistantError, BookingError, ConfigurationError, ProviderError } from "./core/errors";
export type * from "./core/types";
export { chunkDocument, chunkDocuments } from "./knowledge/loader";
export type { KnowledgeChunk, KnowledgeDocument } from "./knowledge/loader";
export { Bm25Retriever } from "./knowledge/retriever";
export type { Retriever } from "./knowledge/retriever";
export { createProvider } from "./llm/factory";
export { TOOL_DEFINITIONS, TOOL_NAMES } from "./tools/definitions";
