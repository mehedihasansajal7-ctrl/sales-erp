import { toZonedDateString, zonedToUtc } from "@/lib/dates";
import { errors } from "@/lib/errors";

/**
 * The date a stock movement belongs to. The warehouse may type yesterday's receipt
 * this morning (the goods arrived yesterday), so back-dating is allowed; a future
 * date is not, because it would show stock that is not there yet.
 */
export function movementDateFromInput(raw: string | null | undefined, now: Date = new Date()): Date {
  const value = (raw ?? "").trim();
  if (!value) return now;

  const datePart = value.slice(0, 10);
  const today = toZonedDateString(now);
  if (datePart > today) {
    throw errors.validation(`The entry date (${datePart}) cannot be in the future.`);
  }

  return zonedToUtc(value);
}
