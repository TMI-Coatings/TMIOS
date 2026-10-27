/**
 * The weekly close: which jobs need hours, what to flag for review, and reading a CSV.
 * The close itself runs in the database (public.close_week); sample mode mirrors it in sampleRepo.
 */
import { type Index, type Plans, isSold } from "./schedule";
import type { Dataset, IsoDate, Job } from "./types";
import { fmtShort } from "./weeks";

/** Every sold job that has started by the week being closed. */
export const closeRows = (ds: Dataset, week: IsoDate): Job[] =>
  ds.jobs.filter((j) => isSold(j) && j.start <= week).sort((a, b) => a.number.localeCompare(b.number));

export const plannedFor = (plans: Plans, j: Job, week: IsoDate) => plans.get(j.id)?.get(week) ?? 0;

/** "Missing" once an import has run and a job has no hours; "+18% vs plan" past the overrun threshold. */
export function reviewFlag(planned: number, actual: number | null, importRan: boolean, overrunPct: number): string | null {
  if (actual == null) return importRan ? "Missing" : null;
  if (planned && Math.abs(actual - planned) / planned > overrunPct / 100) {
    return `${actual > planned ? "+" : "−"}${Math.round((Math.abs(actual - planned) / planned) * 100)}% vs plan`;
  }
  return null;
}

/** CSV rows of job number, hours. Hours for the same job add up; header and blank rows are skipped. */
export function parseHoursCsv(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of text.split(/\r?\n/)) {
    const c = line.split(",").map((x) => x.trim().replace(/^"|"$/g, ""));
    if (c.length < 2) continue;
    const hrs = parseFloat(c[1]);
    const num = c[0].replace(/\D/g, "");
    if (!num || Number.isNaN(hrs)) continue;
    out.set(num, (out.get(num) ?? 0) + hrs);
  }
  return out;
}

export interface CloseInput {
  week: IsoDate;
  entries: { jobId: string; hours: number; source: "typed" | "csv" | "import" }[];
  finished: string[];
}

export interface CloseResult {
  week: IsoDate;
  entered: number;
  total: number;
  missing: number;
  alerts: number;
  nextWeek: IsoDate;
}

/** Forecast accuracy against the forecast made 4 weeks earlier, with missing jobs left out. */
export function forecastAccuracy(snapshot: { jobId: string; hours: number }[], actualTotal: number, missing: string[]): number | null {
  const fc = snapshot.reduce((a, s) => a + s.hours, 0) - snapshot.filter((s) => missing.includes(s.jobId)).reduce((a, s) => a + s.hours, 0);
  return fc > 0 ? Math.max(0, 1 - Math.abs(actualTotal - fc) / fc) : null;
}

export type { Index };

/** Jobs still waiting on hours for the week, grouped by PM, for the scheduler's nudge list. */
export function missingHoursByPm(ds: Dataset, week: IsoDate): { pmCode: string; jobs: Job[] }[] {
  const have = new Set(ds.hourEntries.filter((e) => e.week === week).map((e) => e.jobId));
  const by = new Map<string, Job[]>();
  for (const j of closeRows(ds, week).filter((x) => !have.has(x.id))) by.set(j.pmCode, [...(by.get(j.pmCode) ?? []), j]);
  return [...by].map(([pmCode, jobs]) => ({ pmCode, jobs })).sort((a, b) => b.jobs.length - a.jobs.length || a.pmCode.localeCompare(b.pmCode));
}

/** The nudge a PM gets. Same words as the database's nudge_hours. */
export const nudgeAlert = (week: IsoDate, jobs: Pick<Job, "number" | "customer">[], who: string) => ({
  title: `Hours needed: week ending ${fmtShort(week)}`,
  body: `Enter this week’s hours before the close: ${jobs.map((j) => `${j.number} ${j.customer}`).join(", ")}.\nSent by ${who}.`,
});
