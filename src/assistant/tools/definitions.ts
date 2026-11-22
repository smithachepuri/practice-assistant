import type { ToolDefinition } from "../core/types";

export const TOOL_NAMES = {
  search: "search_practice_info",
  findSlots: "find_available_slots",
  book: "book_appointment",
  cancel: "cancel_appointment",
  reschedule: "reschedule_appointment",
} as const;

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: TOOL_NAMES.search,
    description:
      "Search the practice's own documents (hours, location, insurance, payment, services, " +
      "policies, new-patient information). Use this before answering any question about the practice.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look up, in plain words." },
      },
      required: ["query"],
    },
  },
  {
    name: TOOL_NAMES.findSlots,
    description:
      "List open appointment times. Give a date to see that day, or omit it to see the next open times.",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "Optional date as YYYY-MM-DD." },
      },
      required: [],
    },
  },
  {
    name: TOOL_NAMES.book,
    description:
      "Book an appointment. Only call this after the patient has given their name, phone number, " +
      "reason for the visit, and has chosen one of the open times.",
    parameters: {
      type: "object",
      properties: {
        patient_name: { type: "string", description: "Patient's full name." },
        phone: { type: "string", description: "Patient's 10-digit phone number." },
        reason: { type: "string", description: "Short reason for the visit, in the patient's words." },
        start: { type: "string", description: "Chosen start time as YYYY-MM-DDTHH:mm." },
      },
      required: ["patient_name", "phone", "reason", "start"],
    },
  },
  {
    name: TOOL_NAMES.cancel,
    description: "Cancel an appointment. Needs the confirmation code and the phone number used to book.",
    parameters: {
      type: "object",
      properties: {
        confirmation_code: { type: "string", description: "Code given when the appointment was booked." },
        phone: { type: "string", description: "Phone number used to book." },
      },
      required: ["confirmation_code", "phone"],
    },
  },
  {
    name: TOOL_NAMES.reschedule,
    description:
      "Move an appointment to a new open time. Needs the confirmation code, the phone number used " +
      "to book, and the new start time.",
    parameters: {
      type: "object",
      properties: {
        confirmation_code: { type: "string", description: "Code given when the appointment was booked." },
        phone: { type: "string", description: "Phone number used to book." },
        new_start: { type: "string", description: "New start time as YYYY-MM-DDTHH:mm." },
      },
      required: ["confirmation_code", "phone", "new_start"],
    },
  },
];
