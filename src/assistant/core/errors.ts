export class AssistantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Missing API key, unknown provider, and similar setup problems. */
export class ConfigurationError extends AssistantError {}

/** The model provider returned an error or an unusable response. */
export class ProviderError extends AssistantError {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export type BookingErrorCode =
  | "invalid_name"
  | "invalid_phone"
  | "invalid_reason"
  | "invalid_time"
  | "slot_unavailable"
  | "not_found"
  | "phone_mismatch"
  | "already_cancelled";

/** A booking request that cannot be carried out. The message is safe to show the model. */
export class BookingError extends AssistantError {
  constructor(
    readonly code: BookingErrorCode,
    message: string,
  ) {
    super(message);
  }
}
