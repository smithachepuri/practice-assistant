import { ConfigurationError } from "./errors";
import type { Clock } from "./types";

export type ProviderName = "openai" | "anthropic";

export interface PracticeConfig {
  name: string;
  phone: string;
  emergencyPhone: string;
  timeZone: string;
  /** Hour the first appointment starts (24h clock). */
  openHour: number;
  /** Hour the practice closes; the last slot ends at this time. */
  closeHour: number;
  /** Lunch break as [startHour, endHour); no slots are offered inside it. */
  lunchBreak: [number, number];
  /** 0 = Sunday ... 6 = Saturday. */
  closedWeekdays: number[];
  slotMinutes: number;
  /** How many days ahead appointments can be booked. */
  bookingHorizonDays: number;
  confirmationPrefix: string;
}

export interface AssistantConfig {
  practice: PracticeConfig;
  maxInputChars: number;
  maxHistoryTurns: number;
  /** Upper limit on model calls within one user turn. */
  maxSteps: number;
  maxTokens: number;
}

export const DEFAULT_PRACTICE: PracticeConfig = {
  name: "Maple Grove Dental",
  phone: "(555) 010-0142",
  emergencyPhone: "(555) 010-0199",
  timeZone: "America/Los_Angeles",
  openHour: 9,
  closeHour: 17,
  lunchBreak: [12, 13],
  closedWeekdays: [0, 6],
  slotMinutes: 30,
  bookingHorizonDays: 30,
  confirmationPrefix: "MG",
};

export const DEFAULT_CONFIG: AssistantConfig = {
  practice: DEFAULT_PRACTICE,
  maxInputChars: 1500,
  maxHistoryTurns: 20,
  maxSteps: 6,
  maxTokens: 4000,
};

export interface ProviderSettings {
  provider: ProviderName;
  apiKey: string;
  model: string;
  /** Optional API origin, for a gateway or proxy. Defaults to the provider's public API. */
  baseUrl?: string;
}

const DEFAULT_MODELS: Record<ProviderName, string> = {
  openai: "gpt-5.4-mini",
  anthropic: "claude-haiku-5-5",
};

/** Reads provider settings from environment variables. */
export function readProviderSettings(
  env: Record<string, string | undefined> = process.env,
): ProviderSettings {
  const provider = (env.ASSISTANT_PROVIDER ?? "openai").trim().toLowerCase();
  if (provider !== "openai" && provider !== "anthropic") {
    throw new ConfigurationError(
      `ASSISTANT_PROVIDER must be "openai" or "anthropic", not "${provider}".`,
    );
  }
  const keyName = provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
  const apiKey = (env[keyName] ?? "").trim();
  if (!apiKey) {
    throw new ConfigurationError(`${keyName} is not set. Add it to .env.local (see .env.example).`);
  }
  const modelName = provider === "openai" ? "OPENAI_MODEL" : "ANTHROPIC_MODEL";
  const model = (env[modelName] ?? "").trim() || DEFAULT_MODELS[provider];
  const baseUrlName = provider === "openai" ? "OPENAI_BASE_URL" : "ANTHROPIC_BASE_URL";
  const baseUrl = (env[baseUrlName] ?? "").trim().replace(/\/+$/, "");
  return { provider, apiKey, model, ...(baseUrl ? { baseUrl } : {}) };
}

/** A clock that reports the current time in the practice's time zone. */
export function practiceClock(timeZone: string, now: () => Date = () => new Date()): Clock {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return () => {
    const parts = Object.fromEntries(
      formatter.formatToParts(now()).map((part) => [part.type, part.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  };
}
