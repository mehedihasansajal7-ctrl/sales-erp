/**
 * Timezone helpers. Every date boundary in the application (today, this week,
 * document-number years, overdue checks) is evaluated in APP_TIMEZONE
 * (default Asia/Dhaka) — never in the server's local zone or UTC.
 */
export const APP_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Dhaka";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

/** yyyy-MM-dd in APP_TIMEZONE for a given instant. */
export function toZonedDateString(date: Date = new Date(), timeZone = APP_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return parts;
}

/** yyyy-MM-dd HH:mm:ss in APP_TIMEZONE. */
export function toZonedDateTimeString(date: Date = new Date(), timeZone = APP_TIMEZONE): string {
  const datePart = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  const timePart = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
  return `${datePart} ${timePart}`;
}

/** Year used for document numbers, in APP_TIMEZONE. */
export function zonedYear(date: Date = new Date(), timeZone = APP_TIMEZONE): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric" }).format(date),
  );
}

/**
 * Timezone offset (in ms) of `timeZone` at instant `date`.
 * Positive east of UTC.
 */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const get = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };
  const asUTC = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asUTC - date.getTime();
}

/**
 * Converts a wall-clock date/time in APP_TIMEZONE to the equivalent UTC instant.
 * `"2026-10-15"` or `"2026-10-15T14:30"` both work (date-only => midnight local).
 */
export function zonedToUtc(input: string | Date, timeZone = APP_TIMEZONE): Date {
  if (input instanceof Date) return input;
  const value = input.trim();
  if (!ISO_DATE_RE.test(value) && !ISO_DATETIME_LOCAL_RE.test(value)) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid date: ${input}`);
    return parsed;
  }
  const [datePart, timePart = "00:00:00"] = value.split("T");
  const [y, m, d] = (datePart as string).split("-").map(Number);
  const [hh, mm, ss = "0"] = timePart.split(":");
  const guessUtc = Date.UTC(y as number, (m as number) - 1, d as number, Number(hh), Number(mm), Number(ss));
  // Two-pass conversion handles DST transitions correctly.
  const offset1 = zoneOffsetMs(new Date(guessUtc), timeZone);
  const candidate = new Date(guessUtc - offset1);
  const offset2 = zoneOffsetMs(candidate, timeZone);
  return new Date(guessUtc - offset2);
}

/** Start of the day (00:00:00) in APP_TIMEZONE, as a UTC instant. */
export function startOfZonedDay(date: Date = new Date(), timeZone = APP_TIMEZONE): Date {
  return zonedToUtc(toZonedDateString(date, timeZone), timeZone);
}

/** Start of the next day in APP_TIMEZONE (exclusive upper bound "today"). */
export function endOfZonedDay(date: Date = new Date(), timeZone = APP_TIMEZONE): Date {
  const start = startOfZonedDay(date, timeZone);
  const next = new Date(start);
  next.setUTCDate(next.getUTCDate() + 1);
  return zonedToUtc(toZonedDateString(next, timeZone), timeZone);
}

/** Start of the month in APP_TIMEZONE. */
export function startOfZonedMonth(date: Date = new Date(), timeZone = APP_TIMEZONE): Date {
  const day = toZonedDateString(date, timeZone);
  const [y, m] = day.split("-");
  return zonedToUtc(`${y}-${m}-01`, timeZone);
}

/** Monday-based start of the week in APP_TIMEZONE. */
export function startOfZonedWeek(date: Date = new Date(), timeZone = APP_TIMEZONE): Date {
  const start = startOfZonedDay(date, timeZone);
  const zoned = toZonedDateString(date, timeZone);
  const [y, m, d] = zoned.split("-").map(Number);
  const dow = new Date(Date.UTC(y as number, (m as number) - 1, d as number)).getUTCDay();
  const diff = (dow + 6) % 7; // Monday = 0
  const result = new Date(start.getTime() - diff * 86400000);
  return startOfZonedDay(result, timeZone);
}

/** Display helper: "15 Oct 2026, 2:30 PM" in APP_TIMEZONE. */
export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIMEZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

/** Display helper: "15 Oct 2026" in APP_TIMEZONE. */export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIMEZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

/** Value for a `datetime-local` input (APP_TIMEZONE wall clock). */
export function toDateTimeLocalValue(date: Date = new Date(), timeZone = APP_TIMEZONE): string {
  return toZonedDateTimeString(date, timeZone).slice(0, 16).replace(" ", "T");
}

/**
 * yyyy-MM-dd for `days` ago in APP_TIMEZONE.
 * Kept outside React components so that reading the clock never happens during
 * render (React 19 forbids impure calls in render).
 */
export function defaultFromZonedDateString(days: number, timeZone = APP_TIMEZONE): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return toZonedDateString(date, timeZone);
}
