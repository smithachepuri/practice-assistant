import { randomInt } from "node:crypto";

import type { PracticeConfig } from "../core/config";
import { BookingError } from "../core/errors";
import type { Clock } from "../core/types";
import { addDays, isValidDate, isValidLocalTime, slotsForDate } from "./slots";
import type { Appointment, AppointmentStore } from "./store";

// No 0/O or 1/I, so codes read aloud over the phone are unambiguous.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function defaultCodeGenerator(): string {
  return Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
}

export function normalizePhone(value: string): string | undefined {
  const digits = value.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return national.length === 10 ? national : undefined;
}

export interface BookingRequest {
  patientName: string;
  phone: string;
  reason: string;
  start: string;
}

/** All appointment rules live here. Nothing in this class trusts its caller. */
export class BookingService {
  constructor(
    private readonly store: AppointmentStore,
    private readonly practice: PracticeConfig,
    private readonly clock: Clock,
    private readonly generateCode: () => string = defaultCodeGenerator,
  ) {}

  private async takenStarts(ignoreCode?: string): Promise<Set<string>> {
    const appointments = await this.store.list();
    return new Set(
      appointments
        .filter((a) => a.status === "booked" && a.confirmationCode !== ignoreCode)
        .map((a) => a.start),
    );
  }

  private lastBookableDate(): string {
    return addDays(this.clock().slice(0, 10), this.practice.bookingHorizonDays);
  }

  /** Open slots on one date, or the next open slots from now when no date is given. */
  async findAvailableSlots(options: { date?: string; limit?: number } = {}): Promise<string[]> {
    const now = this.clock();
    const today = now.slice(0, 10);
    const limit = Math.min(Math.max(options.limit ?? 6, 1), 12);
    const taken = await this.takenStarts();
    const isOpen = (slot: string) => slot > now && !taken.has(slot);

    if (options.date !== undefined) {
      if (!isValidDate(options.date)) {
        throw new BookingError("invalid_time", "The date must be written as YYYY-MM-DD.");
      }
      if (options.date < today || options.date > this.lastBookableDate()) {
        return [];
      }
      return slotsForDate(options.date, this.practice).filter(isOpen).slice(0, limit);
    }

    const found: string[] = [];
    for (let offset = 0; offset <= this.practice.bookingHorizonDays && found.length < limit; offset++) {
      for (const slot of slotsForDate(addDays(today, offset), this.practice)) {
        if (isOpen(slot)) found.push(slot);
        if (found.length >= limit) break;
      }
    }
    return found;
  }

  private async assertBookable(start: string, ignoreCode?: string): Promise<void> {
    if (!isValidLocalTime(start)) {
      throw new BookingError("invalid_time", "The time must be written as YYYY-MM-DDTHH:mm.");
    }
    const date = start.slice(0, 10);
    if (start <= this.clock()) {
      throw new BookingError("slot_unavailable", "That time has already passed.");
    }
    if (date > this.lastBookableDate()) {
      throw new BookingError(
        "slot_unavailable",
        `Appointments can only be booked up to ${this.practice.bookingHorizonDays} days ahead.`,
      );
    }
    if (!slotsForDate(date, this.practice).includes(start)) {
      throw new BookingError("slot_unavailable", "The practice has no appointment slot at that time.");
    }
    if ((await this.takenStarts(ignoreCode)).has(start)) {
      throw new BookingError("slot_unavailable", "That slot has just been taken.");
    }
  }

  async book(request: BookingRequest): Promise<Appointment> {
    const patientName = request.patientName.trim().replace(/\s+/g, " ");
    if (patientName.length < 2 || patientName.length > 80 || !/[a-z]/i.test(patientName)) {
      throw new BookingError("invalid_name", "A patient name is required.");
    }
    const phone = normalizePhone(request.phone);
    if (!phone) {
      throw new BookingError("invalid_phone", "A 10-digit phone number is required.");
    }
    const reason = request.reason.trim().replace(/\s+/g, " ");
    if (reason.length < 2 || reason.length > 200) {
      throw new BookingError("invalid_reason", "A short reason for the visit is required.");
    }
    await this.assertBookable(request.start);

    const appointment: Appointment = {
      confirmationCode: `${this.practice.confirmationPrefix}-${this.generateCode()}`,
      patientName,
      phone,
      reason,
      start: request.start,
      durationMinutes: this.practice.slotMinutes,
      status: "booked",
    };
    await this.store.save(appointment);
    return appointment;
  }

  /** Finds an active appointment, but only for a caller who knows its phone number. */
  private async findOwned(confirmationCode: string, phone: string): Promise<Appointment> {
    const appointment = await this.store.findByCode(confirmationCode.trim());
    const normalized = normalizePhone(phone);
    // The same error for "no such code" and "wrong phone" avoids confirming which codes exist.
    if (!appointment || !normalized || appointment.phone !== normalized) {
      throw new BookingError(
        appointment ? "phone_mismatch" : "not_found",
        "No appointment matches that confirmation code and phone number.",
      );
    }
    if (appointment.status === "cancelled") {
      throw new BookingError("already_cancelled", "That appointment has already been cancelled.");
    }
    return appointment;
  }

  async cancel(confirmationCode: string, phone: string): Promise<Appointment> {
    const appointment = await this.findOwned(confirmationCode, phone);
    const cancelled: Appointment = { ...appointment, status: "cancelled" };
    await this.store.save(cancelled);
    return cancelled;
  }

  async reschedule(confirmationCode: string, phone: string, newStart: string): Promise<Appointment> {
    const appointment = await this.findOwned(confirmationCode, phone);
    await this.assertBookable(newStart, appointment.confirmationCode);
    const moved: Appointment = { ...appointment, start: newStart };
    await this.store.save(moved);
    return moved;
  }
}
