const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const DATE_OF_BIRTH = /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g;
const LONG_NUMBER = /\b\d{7,}\b/g;

/** Removes contact details and identifiers from text before it is written to a log. */
export function redactText(text: string): string {
  return text
    .replace(EMAIL, "[email]")
    .replace(PHONE, "[phone]")
    .replace(DATE_OF_BIRTH, "[date]")
    .replace(LONG_NUMBER, "[number]");
}

const SENSITIVE_KEYS = new Set(["phone", "patient_name", "patientName"]);

/** Redacts a tool-argument object: named fields are masked, other text is scrubbed. */
export function redactArguments(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (SENSITIVE_KEYS.has(key)) {
      out[key] = "[redacted]";
    } else {
      out[key] = typeof value === "string" ? redactText(value) : value;
    }
  }
  return out;
}
