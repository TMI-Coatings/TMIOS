import type { IsoDate } from "./types";

const DAY = 86_400_000;

const toDate = (s: IsoDate) => new Date(s + "T00:00:00Z");
const iso = (d: Date) => d.toISOString().slice(0, 10);

export const addDays = (s: IsoDate, n: number): IsoDate => iso(new Date(toDate(s).getTime() + n * DAY));

export const dayOfWeek = (s: IsoDate) => toDate(s).getUTCDay(); // 0 Sun .. 5 Fri

export const isFriday = (s: IsoDate) => dayOfWeek(s) === 5;

/** Weeks end on Friday. Sat and Sun belong to the following week. */
export const weekEnding = (s: IsoDate): IsoDate => {
  const d = dayOfWeek(s);
  return addDays(s, (5 - d + 7) % 7);
};

export const mondayOf = (week: IsoDate): IsoDate => addDays(week, -4);

export const weekList = (first: IsoDate, n: number): IsoDate[] =>
  Array.from({ length: n }, (_, i) => addDays(first, 7 * i));

export const daysBetween = (a: IsoDate, b: IsoDate) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY);

/** Today's date in the company time zone (America/Chicago, decision 26). */
export const todayIn = (now: Date, timeZone = "America/Chicago"): IsoDate => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return parts;
};

export const currentWeek = (now: Date = new Date()): IsoDate => weekEnding(todayIn(now));

export const fmtShort = (s: IsoDate) =>
  toDate(s).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export const fmtLong = (s: IsoDate) =>
  toDate(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
