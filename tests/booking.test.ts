import { describe, expect, it } from "vitest";

import { BookingError, DEFAULT_PRACTICE, normalizePhone } from "../src/assistant";
import { addDays, isValidDate, isValidLocalTime, slotsForDate, weekdayOf } from "../src/assistant/booking/slots";
import { JORDAN, makeBundle } from "./helpers";

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof BookingError) return error.code;
    throw error;
  }
  return "no error";
}

describe("slot generation", () => {
  it("offers 14 half-hour slots on a weekday, skipping lunch", () => {
    const slots = slotsForDate("2026-11-24", DEFAULT_PRACTICE);
    expect(slots).toHaveLength(14);
    expect(slots[0]).toBe("2026-11-24T09:00");
    expect(slots).toContain("2026-11-24T11:30");
    expect(slots).not.toContain("2026-11-24T12:00");
    expect(slots).not.toContain("2026-11-24T12:30");
    expect(slots).toContain("2026-11-24T13:00");
    expect(slots[slots.length - 1]).toBe("2026-11-24T16:30");
  });

  it("offers nothing at the weekend", () => {
    expect(weekdayOf("2026-11-28")).toBe(6);
    expect(slotsForDate("2026-11-28", DEFAULT_PRACTICE)).toEqual([]);
    expect(slotsForDate("2026-11-29", DEFAULT_PRACTICE)).toEqual([]);
  });

  it("validates dates and times", () => {
    expect(isValidDate("2026-02-28")).toBe(true);
    expect(isValidDate("2026-02-30")).toBe(false);
    expect(isValidDate("11/24/2026")).toBe(false);
    expect(isValidLocalTime("2026-11-24T10:00")).toBe(true);
    expect(isValidLocalTime("2026-11-24T25:00")).toBe(false);
    expect(isValidLocalTime("2026-11-24 10:00")).toBe(false);
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("normalizePhone", () => {
  it.each([
    ["555-010-0111", "5550100111"],
    ["(555) 010-0111", "5550100111"],
    ["+1 555 010 0111", "5550100111"],
  ])("accepts %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(["12345", "555-010-01111", "not a phone"])("rejects %s", (input) => {
    expect(normalizePhone(input)).toBeUndefined();
  });
});

describe("BookingService", () => {
  it("lists the next open slots from now, and a given day's slots", async () => {
    const { booking } = makeBundle();
    expect((await booking.findAvailableSlots({ limit: 3 }))).toEqual([
      "2026-11-23T09:00",
      "2026-11-23T09:30",
      "2026-11-23T10:00",
    ]);
    expect(await booking.findAvailableSlots({ date: "2026-11-28" })).toEqual([]);
    expect((await booking.findAvailableSlots({ date: "2026-11-24", limit: 12 }))).toHaveLength(12);
  });

  it("hides slots earlier today and dates outside the booking window", async () => {
    const { booking } = makeBundle([], "2026-11-23T15:10");
    expect(await booking.findAvailableSlots({ date: "2026-11-23" })).toEqual([
      "2026-11-23T15:30",
      "2026-11-23T16:00",
      "2026-11-23T16:30",
    ]);
    expect(await booking.findAvailableSlots({ date: "2026-11-20" })).toEqual([]);
    expect(await booking.findAvailableSlots({ date: "2027-03-01" })).toEqual([]);
  });

  it("books a valid request and removes the slot from availability", async () => {
    const { booking, store } = makeBundle();
    const appointment = await booking.book(JORDAN);

    expect(appointment).toMatchObject({
      confirmationCode: "MG-TEST01",
      patientName: "Jordan Rivera",
      phone: "5550100111",
      start: "2026-11-24T10:00",
      durationMinutes: 30,
      status: "booked",
    });
    expect(await store.findByCode("mg-test01")).toMatchObject({ patientName: "Jordan Rivera" });
    expect(await booking.findAvailableSlots({ date: "2026-11-24", limit: 12 })).not.toContain("2026-11-24T10:00");
  });

  it("rejects invalid requests with a specific reason", async () => {
    const { booking } = makeBundle();
    expect(await codeOf(booking.book({ ...JORDAN, patientName: " " }))).toBe("invalid_name");
    expect(await codeOf(booking.book({ ...JORDAN, phone: "12345" }))).toBe("invalid_phone");
    expect(await codeOf(booking.book({ ...JORDAN, reason: "" }))).toBe("invalid_reason");
    expect(await codeOf(booking.book({ ...JORDAN, start: "tomorrow at ten" }))).toBe("invalid_time");
    expect(await codeOf(booking.book({ ...JORDAN, start: "2026-11-28T10:00" }))).toBe("slot_unavailable");
    expect(await codeOf(booking.book({ ...JORDAN, start: "2026-11-24T12:00" }))).toBe("slot_unavailable");
    expect(await codeOf(booking.book({ ...JORDAN, start: "2026-11-24T10:15" }))).toBe("slot_unavailable");
    expect(await codeOf(booking.book({ ...JORDAN, start: "2026-11-20T10:00" }))).toBe("slot_unavailable");
    expect(await codeOf(booking.book({ ...JORDAN, start: "2027-03-01T10:00" }))).toBe("slot_unavailable");
  });

  it("refuses to double-book a slot", async () => {
    const { booking } = makeBundle();
    await booking.book(JORDAN);
    expect(await codeOf(booking.book({ ...JORDAN, patientName: "Sam Lee", phone: "5550100222" }))).toBe(
      "slot_unavailable",
    );
  });

  it("cancels only with the matching phone number, and frees the slot", async () => {
    const { booking } = makeBundle();
    await booking.book(JORDAN);

    expect(await codeOf(booking.cancel("MG-TEST01", "555-010-0999"))).toBe("phone_mismatch");
    expect(await codeOf(booking.cancel("MG-NOPE00", "555-010-0111"))).toBe("not_found");

    const cancelled = await booking.cancel("mg-test01", "(555) 010-0111");
    expect(cancelled.status).toBe("cancelled");
    expect(await booking.findAvailableSlots({ date: "2026-11-24", limit: 12 })).toContain("2026-11-24T10:00");
    expect(await codeOf(booking.cancel("MG-TEST01", "555-010-0111"))).toBe("already_cancelled");
  });

  it("gives the same message for an unknown code and a wrong phone number", async () => {
    const { booking } = makeBundle();
    await booking.book(JORDAN);
    const messages = await Promise.all(
      [booking.cancel("MG-TEST01", "555-010-0999"), booking.cancel("MG-NOPE00", "555-010-0111")].map((p) =>
        p.then(() => "", (error: Error) => error.message),
      ),
    );
    expect(messages[0]).toBe(messages[1]);
  });

  it("reschedules to an open slot and frees the old one", async () => {
    const { booking } = makeBundle();
    await booking.book(JORDAN);
    await booking.book({ ...JORDAN, patientName: "Sam Lee", phone: "5550100222", start: "2026-11-24T11:00" });

    expect(await codeOf(booking.reschedule("MG-TEST01", "555-010-0111", "2026-11-24T11:00"))).toBe("slot_unavailable");
    expect(await codeOf(booking.reschedule("MG-TEST01", "555-010-0999", "2026-11-25T09:00"))).toBe("phone_mismatch");

    const moved = await booking.reschedule("MG-TEST01", "555-010-0111", "2026-11-25T09:00");
    expect(moved).toMatchObject({ confirmationCode: "MG-TEST01", start: "2026-11-25T09:00", status: "booked" });
    const tuesday = await booking.findAvailableSlots({ date: "2026-11-24", limit: 12 });
    expect(tuesday).toContain("2026-11-24T10:00");
  });
});
