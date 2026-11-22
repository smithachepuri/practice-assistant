import type { AppointmentStore } from "../booking/store";
import type { PracticeConfig } from "../core/config";
import type { SafetyFlag, ToolEvent } from "../core/types";
import { TOOL_NAMES } from "../tools/definitions";

export interface OutputDecision {
  reply: string;
  flag?: SafetyFlag;
}

const CONDITIONS =
  "cavity|cavities|abscess|infection|gingivitis|periodontitis|gum disease|tmj|impacted|" +
  "cracked tooth|fracture|pulpitis|dry socket|oral cancer|tooth decay";

/** Phrases that amount to diagnosing the patient or prescribing treatment. */
const MEDICAL_ADVICE_PATTERNS: RegExp[] = [
  new RegExp(
    `\\b(you (likely |probably |may |might |definitely )?have|sounds like (you have|it(?:'s| is)|you(?:'ve| have) got)|` +
      `this is (likely |probably |definitely )?)\\s+(a |an |the )?(${CONDITIONS})\\b`,
    "i",
  ),
  /\b\d+(\.\d+)?\s?(mg|milligrams?|ml|mcg)\b/i,
  /\b(you should|you can|i recommend|i suggest|try)\s+(take|taking|use|using)\s+(ibuprofen|acetaminophen|tylenol|advil|aspirin|amoxicillin|antibiotics?|painkillers?|naproxen)\b/i,
];

const BOOKING_CLAIM_PATTERNS: RegExp[] = [
  /\b(is|are|has been|have been|'s|been)\s+(now\s+|all\s+|successfully\s+)?(booked|confirmed|scheduled|rescheduled|cancell?ed|moved)\b/i,
  /\bI(?:'ve| have)\s+(now\s+|just\s+|successfully\s+)?(booked|scheduled|rescheduled|cancell?ed|moved|confirmed)\b/i,
  /\byou(?:'re| are)\s+(all\s+)?(set|booked|confirmed)\b/i,
];

const MUTATING_TOOLS: string[] = [TOOL_NAMES.book, TOOL_NAMES.cancel, TOOL_NAMES.reschedule];

/**
 * Checks the model's final reply before it reaches the patient.
 *
 * 1. Medical advice: a reply that diagnoses or suggests medication is replaced.
 * 2. Unverified bookings: a reply may only say an appointment was booked, moved or
 *    cancelled if a tool actually did it this turn, or if it cites a confirmation
 *    code that really exists. This stops a hallucinated confirmation reaching a patient.
 */
export async function checkOutput(
  reply: string,
  toolEvents: ToolEvent[],
  store: AppointmentStore,
  practice: PracticeConfig,
): Promise<OutputDecision> {
  if (MEDICAL_ADVICE_PATTERNS.some((pattern) => pattern.test(reply))) {
    return {
      flag: "medical_advice_blocked",
      reply:
        "I'm not able to assess symptoms or suggest treatment or medication. One of our dentists " +
        `can do that at a visit. I can book you an appointment, or you can call us at ${practice.phone}. ` +
        "If you have severe pain, swelling or bleeding, please call our emergency line at " +
        `${practice.emergencyPhone}.`,
    };
  }

  const codePattern = new RegExp(`\\b${practice.confirmationPrefix}-[A-Z0-9]{6}\\b`, "gi");
  const citedCodes = [...new Set((reply.match(codePattern) ?? []).map((code) => code.toUpperCase()))];
  let everyCodeExists = true;
  for (const code of citedCodes) {
    if (!(await store.findByCode(code))) everyCodeExists = false;
  }

  const changedThisTurn = toolEvents.some((event) => event.ok && MUTATING_TOOLS.includes(event.name));
  const claimsChange = BOOKING_CLAIM_PATTERNS.some((pattern) => pattern.test(reply));
  const backedByRealCode = citedCodes.length > 0 && everyCodeExists;

  if (!everyCodeExists || (claimsChange && !changedThisTurn && !backedByRealCode)) {
    return {
      flag: "unverified_booking_blocked",
      reply:
        "I wasn't able to complete that appointment change, so nothing has been booked or changed yet. " +
        "Could you confirm your name, phone number and the time you'd like, and I'll try again? " +
        `You can also call us at ${practice.phone}.`,
    };
  }

  return { reply };
}
