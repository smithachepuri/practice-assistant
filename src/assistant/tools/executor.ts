import type { BookingService } from "../booking/service";
import type { Appointment } from "../booking/store";
import { BookingError } from "../core/errors";
import type { Source, ToolCall, ToolEvent } from "../core/types";
import type { Retriever } from "../knowledge/retriever";
import { TOOL_NAMES } from "./definitions";

export interface ToolOutcome {
  event: ToolEvent;
  /** JSON text handed back to the model as the tool result. */
  content: string;
  sources: Source[];
}

class ArgumentError extends Error {}

function requireString(args: Record<string, unknown>, key: string, maxLength = 300): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ArgumentError(`"${key}" is required and must be text.`);
  }
  if (value.length > maxLength) {
    throw new ArgumentError(`"${key}" is too long.`);
  }
  return value.trim();
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new ArgumentError(`"${key}" must be text.`);
  return value.trim();
}

/** What the model is told about an appointment. The phone number is never echoed back. */
function describe(appointment: Appointment) {
  return {
    confirmation_code: appointment.confirmationCode,
    patient_name: appointment.patientName,
    start: appointment.start,
    duration_minutes: appointment.durationMinutes,
    reason: appointment.reason,
    status: appointment.status,
  };
}

/** Runs tool calls requested by the model. Arguments are validated here, never trusted. */
export class ToolExecutor {
  constructor(
    private readonly retriever: Retriever,
    private readonly booking: BookingService,
  ) {}

  async execute(call: ToolCall): Promise<ToolOutcome> {
    const sources: Source[] = [];
    try {
      const result = await this.run(call, sources);
      return {
        event: { name: call.name, arguments: call.arguments, ok: true, result },
        content: JSON.stringify(result),
        sources,
      };
    } catch (error) {
      if (!(error instanceof ArgumentError) && !(error instanceof BookingError)) throw error;
      const result = {
        error: error.message,
        ...(error instanceof BookingError ? { code: error.code } : { code: "invalid_arguments" }),
      };
      return {
        event: { name: call.name, arguments: call.arguments, ok: false, result },
        // The model sees the message only; the code stays in the event for audit and evaluation.
        content: JSON.stringify({ error: error.message }),
        sources: [],
      };
    }
  }

  private async run(call: ToolCall, sources: Source[]): Promise<unknown> {
    const args = call.arguments;
    switch (call.name) {
      case TOOL_NAMES.search: {
        const hits = this.retriever.search(requireString(args, "query"), 3);
        for (const hit of hits) {
          sources.push({ id: hit.chunk.id, title: hit.chunk.title, document: hit.chunk.document });
        }
        return {
          results: hits.map((hit) => ({ source_id: hit.chunk.id, title: hit.chunk.title, text: hit.chunk.text })),
          note: hits.length === 0 ? "Nothing relevant was found in the practice documents." : undefined,
        };
      }
      case TOOL_NAMES.findSlots: {
        const date = optionalString(args, "date");
        const slots = await this.booking.findAvailableSlots({ date });
        return { date: date ?? null, open_times: slots };
      }
      case TOOL_NAMES.book: {
        const appointment = await this.booking.book({
          patientName: requireString(args, "patient_name", 80),
          phone: requireString(args, "phone", 30),
          reason: requireString(args, "reason", 200),
          start: requireString(args, "start", 16),
        });
        return { booked: true, appointment: describe(appointment) };
      }
      case TOOL_NAMES.cancel: {
        const appointment = await this.booking.cancel(
          requireString(args, "confirmation_code", 20),
          requireString(args, "phone", 30),
        );
        return { cancelled: true, appointment: describe(appointment) };
      }
      case TOOL_NAMES.reschedule: {
        const appointment = await this.booking.reschedule(
          requireString(args, "confirmation_code", 20),
          requireString(args, "phone", 30),
          requireString(args, "new_start", 16),
        );
        return { rescheduled: true, appointment: describe(appointment) };
      }
      default:
        throw new ArgumentError(`Unknown tool "${call.name}".`);
    }
  }
}
