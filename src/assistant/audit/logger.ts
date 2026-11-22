import type { SafetyFlag } from "../core/types";

export interface AuditEvent {
  type: "turn";
  at: string;
  provider: string;
  model: string;
  /** Redacted before it is stored. */
  userMessage: string;
  /** Redacted before it is stored. */
  reply: string;
  tools: { name: string; ok: boolean; arguments: Record<string, unknown> }[];
  flags: SafetyFlag[];
  modelCalls: number;
}

export interface AuditSink {
  write(event: AuditEvent): void;
}

/** Writes one JSON line per turn to standard output. */
export class ConsoleAuditSink implements AuditSink {
  write(event: AuditEvent): void {
    console.log(JSON.stringify(event));
  }
}

export class MemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];

  write(event: AuditEvent): void {
    this.events.push(event);
  }
}
