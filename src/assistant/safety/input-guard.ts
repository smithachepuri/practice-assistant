import type { PracticeConfig } from "../core/config";
import type { SafetyFlag } from "../core/types";

export type InputDecision =
  | { action: "allow" }
  | { action: "block"; flag: SafetyFlag; reply: string };

/** Signs of a situation that needs urgent care now, not a chatbot. */
const EMERGENCY_PATTERNS: RegExp[] = [
  /\b(can'?t|cannot|can not|trouble|difficulty|hard to|struggling to)\s+(breathe|breathing|swallow|swallowing)\b/i,
  /\bbleeding\b.{0,40}\b(won'?t|will not|doesn'?t|does not|not)\s+stop/i,
  /\b(won'?t|will not|doesn'?t|does not)\s+stop\s+bleeding\b/i,
  /\b(severe|heavy|uncontrolled|a lot of)\s+bleeding\b/i,
  /\bswelling\b.{0,60}\b(eye|neck|throat|spreading)\b/i,
  /\b(face|jaw|neck|throat)\b.{0,30}\bswell(ing|ed|s)?\b.{0,40}\b(fever|breath|swallow|spreading)\b/i,
  /\bknocked[\s-]?out\b.{0,20}\btooth\b|\btooth\b.{0,30}\bknocked[\s-]?out\b/i,
  /\b(broken|fractured|dislocated)\s+jaw\b|\bjaw\b.{0,20}\b(broken|fractured|dislocated)\b/i,
];

/** Common attempts to override the assistant's instructions. Kept deliberately narrow. */
const INJECTION_PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget|override)\b.{0,30}\b(previous|prior|above|earlier|all|your|the)\b.{0,20}\b(instructions?|rules?|prompts?|guidelines?)\b/i,
  /\b(reveal|show|print|repeat|output|tell me)\b.{0,40}\b(system prompt|system message|hidden instructions|your instructions|your prompt)\b/i,
  /\byou are now\b|\bfrom now on,? you\b/i,
  /\b(developer|debug|admin|god)\s+mode\b|\bjailbreak\b|\bDAN\b/,
  /\bpretend (you are|you're|to be)\b|\bact as (?!a (new )?patient)/i,
  /<\/?(system|assistant|instructions?)>|\[\/?(system|inst)\]/i,
];

/**
 * Checks a user message before any model call. Emergencies and instruction-override
 * attempts get a fixed reply, so the outcome does not depend on model behaviour.
 */
export function checkInput(text: string, practice: PracticeConfig, maxChars: number): InputDecision {
  if (text.length > maxChars) {
    return {
      action: "block",
      flag: "input_too_long",
      reply: `That message is a bit long for me. Could you shorten it to under ${maxChars} characters?`,
    };
  }
  if (EMERGENCY_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      action: "block",
      flag: "emergency",
      reply:
        "This sounds like it may need urgent care. If you have trouble breathing or swallowing, " +
        "bleeding that will not stop, or swelling that is spreading, call 911 or go to the nearest " +
        `emergency room now. For an urgent dental problem, call our emergency line at ${practice.emergencyPhone}. ` +
        "If this is not an emergency, tell me and I can help you find the next available appointment.",
    };
  }
  if (INJECTION_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      action: "block",
      flag: "injection_blocked",
      reply:
        `I can only help with questions about ${practice.name} and with booking, changing or ` +
        "cancelling appointments. What can I help you with?",
    };
  }
  return { action: "allow" };
}
