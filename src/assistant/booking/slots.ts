import type { PracticeConfig } from "../core/config";

const pad = (value: number) => String(value).padStart(2, "0");

const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written as "YYYY-MM-DD". */
export function isValidDate(value: string): boolean {
  const match = LOCAL_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** True for a real local time written as "YYYY-MM-DDTHH:mm". */
export function isValidLocalTime(value: string): boolean {
  const match = LOCAL_TIME.exec(value);
  if (!match) return false;
  return isValidDate(value.slice(0, 10)) && Number(match[4]) < 24 && Number(match[5]) < 60;
}

/** Adds days to a "YYYY-MM-DD" date. Local dates are handled as UTC to avoid DST drift. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return `${result.getUTCFullYear()}-${pad(result.getUTCMonth() + 1)}-${pad(result.getUTCDate())}`;
}

export function weekdayOf(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** All appointment start times the practice offers on one date, ignoring existing bookings. */
export function slotsForDate(date: string, practice: PracticeConfig): string[] {
  if (practice.closedWeekdays.includes(weekdayOf(date))) return [];
  const [lunchStart, lunchEnd] = practice.lunchBreak;
  const slots: string[] = [];
  for (
    let minutes = practice.openHour * 60;
    minutes + practice.slotMinutes <= practice.closeHour * 60;
    minutes += practice.slotMinutes
  ) {
    const endMinutes = minutes + practice.slotMinutes;
    const overlapsLunch = minutes < lunchEnd * 60 && endMinutes > lunchStart * 60;
    if (!overlapsLunch) {
      slots.push(`${date}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`);
    }
  }
  return slots;
}
