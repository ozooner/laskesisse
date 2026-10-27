export type EventKey = "mardi" | "kadri";

export const EVENT_KEYS: readonly EventKey[] = ["mardi", "kadri"];
export const TIME_ZONE = "Europe/Tallinn";

export const EVENTS: Record<EventKey, { month: number; day: number; name: string; untilWord: string; visitors: string }> = {
  mardi: { month: 11, day: 10, name: "Mardipäev", untilWord: "mardipäevani", visitors: "Mardisandid" },
  kadri: { month: 11, day: 25, name: "Kadripäev", untilWord: "kadripäevani", visitors: "Kadrisandid" },
};

const MONTHS = [
  "jaanuar", "veebruar", "märts", "aprill", "mai", "juuni",
  "juuli", "august", "september", "oktoober", "november", "detsember",
];

const pad = (n: number) => String(n).padStart(2, "0");

export function isEventKey(value: unknown): value is EventKey {
  return value === "mardi" || value === "kadri";
}

/** Today's date in Tallinn as YYYY-MM-DD. */
export function tallinnToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

/** The next occurrence of the event on or after `today`. */
export function eventDate(key: EventKey, today: string): string {
  const { month, day } = EVENTS[key];
  const year = Number(today.slice(0, 4));
  const thisYear = `${year}-${pad(month)}-${pad(day)}`;
  return thisYear >= today ? thisYear : `${year + 1}-${pad(month)}-${pad(day)}`;
}

/** The tab to open by default: whichever event comes first. */
export function defaultEvent(today: string): EventKey {
  return eventDate("mardi", today) <= eventDate("kadri", today) ? "mardi" : "kadri";
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString().slice(0, 10);
}

/** "10. november" */
export function formatDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d}. ${MONTHS[m - 1]}`;
}

/** "10.11.2026" */
export function formatShort(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}
