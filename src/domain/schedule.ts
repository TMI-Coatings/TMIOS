import type { Dataset, Firmness, IsoDate, Job, Person, Settings, TimeOff } from "./types";
import { addDays, mondayOf, weekList } from "./weeks";

/** How far ahead plans are spread. Wider than the 13-week grid so long jobs rebalance correctly. */
export const PLAN_HORIZON_WEEKS = 40;

export const FIRMNESS: { key: Firmness; label: string; description: string }[] = [
  { key: "locked", label: "Locked", description: "No flexibility. Shutdown, contract or hard customer date." },
  { key: "confirmed", label: "Confirmed, some flexibility", description: "General timing confirmed with the customer. Some room to move." },
  { key: "waiting", label: "Waiting on another job", description: "Timing confirmed, but it can’t start until another job finishes." },
  { key: "flexible", label: "Very flexible", description: "Customer is open on timing." },
  { key: "best_guess", label: "TMI’s best guess", description: "Not confirmed with the customer yet." },
  { key: "fill_in", label: "Fill-in work", description: "Non-critical work used to fill crew gaps." },
];
export const firmnessLabel = (f: Firmness) => FIRMNESS.find((x) => x.key === f)?.label ?? f;
export const MOVABLE: Firmness[] = ["fill_in", "flexible", "best_guess"];

export const isSold = (j: Job) => j.active && j.status !== "complete";
export const isOnHold = (j: Job) => j.status === "on_hold";
export const inWindow = (j: Job, week: IsoDate) => j.start <= week && j.projectedFinish >= mondayOf(week);

/** Per-job lookups built once per dataset. */
export interface Index {
  actualsByJob: Map<string, Map<IsoDate, number>>;
  overridesByJob: Map<string, Map<IsoDate, number>>;
  timeOffByPerson: Map<string, TimeOff[]>;
  jobsById: Map<string, Job>;
}

export function buildIndex(ds: Dataset): Index {
  const actualsByJob = new Map<string, Map<IsoDate, number>>();
  for (const a of ds.actuals) {
    if (!actualsByJob.has(a.jobId)) actualsByJob.set(a.jobId, new Map());
    const m = actualsByJob.get(a.jobId)!;
    m.set(a.week, (m.get(a.week) ?? 0) + a.hours);
  }
  const overridesByJob = new Map<string, Map<IsoDate, number>>();
  for (const o of ds.overrides) {
    if (!overridesByJob.has(o.jobId)) overridesByJob.set(o.jobId, new Map());
    overridesByJob.get(o.jobId)!.set(o.week, o.hours);
  }
  const timeOffByPerson = new Map<string, TimeOff[]>();
  for (const t of ds.timeOff) {
    if (!t.active) continue;
    if (!timeOffByPerson.has(t.personId)) timeOffByPerson.set(t.personId, []);
    timeOffByPerson.get(t.personId)!.push(t);
  }
  return { actualsByJob, overridesByJob, timeOffByPerson, jobsById: new Map(ds.jobs.map((j) => [j.id, j])) };
}

export const actualToDate = (idx: Index, j: Job) => {
  let s = 0;
  for (const h of idx.actualsByJob.get(j.id)?.values() ?? []) s += h;
  return s;
};

export const hoursLeft = (idx: Index, j: Job) => j.projectedHrs - actualToDate(idx, j);

/**
 * Planned hours by week. Hours left spread evenly across the job's remaining weeks;
 * any week set by hand is kept and the rest rebalance.
 */
export function planFor(idx: Index, j: Job, week: IsoDate): Map<IsoDate, number> {
  const out = new Map<IsoDate, number>();
  if (!isSold(j)) return out;
  let weeks = weekList(week, PLAN_HORIZON_WEEKS).filter((w) => inWindow(j, w));
  const left = hoursLeft(idx, j);
  if (!weeks.length) {
    if (j.start <= week && left > 0) weeks = [week];
    else return out;
  }
  const ov = idx.overridesByJob.get(j.id);
  let rem = Math.max(0, left);
  const free: IsoDate[] = [];
  for (const w of weeks) {
    const set = ov?.get(w);
    if (set != null) {
      out.set(w, set);
      rem -= set;
    } else free.push(w);
  }
  rem = Math.max(0, rem);
  for (const w of free) out.set(w, Math.round(rem / free.length));
  return out;
}

export type Plans = Map<string, Map<IsoDate, number>>;

export function allPlans(ds: Dataset, idx: Index, week: IsoDate): Plans {
  return new Map(ds.jobs.map((j) => [j.id, planFor(idx, j, week)]));
}

const planned = (plans: Plans, j: Job, w: IsoDate) => plans.get(j.id)?.get(w) ?? 0;

/** Sold, not on hold, planned hours that week. */
export const loadForWeek = (ds: Dataset, plans: Plans, w: IsoDate) =>
  ds.jobs.reduce((a, j) => a + (isSold(j) && !isOnHold(j) ? planned(plans, j, w) : 0), 0);

/** On-hold hours: shown, but out of the capacity math. */
export const holdForWeek = (ds: Dataset, plans: Plans, w: IsoDate) =>
  ds.jobs.reduce((a, j) => a + (isSold(j) && isOnHold(j) ? planned(plans, j, w) : 0), 0);

/** Share of the Monday–Friday days this person is off in the week. */
export function offFraction(idx: Index, p: Person, week: IsoDate): number {
  const list = idx.timeOffByPerson.get(p.id);
  if (!list?.length) return 0;
  const mon = mondayOf(week);
  let days = 0;
  for (let i = 0; i < 5; i++) {
    const d = addDays(mon, i);
    if (list.some((t) => t.firstDay <= d && t.lastDay >= d)) days++;
  }
  return days / 5;
}

export const availableMen = (ds: Dataset, idx: Index, w: IsoDate, leadersOnly = false) =>
  ds.people
    .filter((p) => p.active && p.kind !== "leadership" && (!leadersOnly || p.kind === "leader"))
    .reduce((a, p) => a + (1 - offFraction(idx, p, w)), 0);

/** Capacity = active roster less time off x hours per man-week x (1 - absence). */
export const capacity = (ds: Dataset, idx: Index, w: IsoDate, s: Settings = ds.settings) =>
  availableMen(ds, idx, w) * s.hoursPerManWeek * (1 - s.absencePct / 100);

export const leadersNeeded = (ds: Dataset, plans: Plans, w: IsoDate, s: Settings = ds.settings) =>
  ds.jobs
    .filter((j) => isSold(j) && !isOnHold(j) && planned(plans, j, w) > 0)
    .reduce((a, j) => a + (j.projectedHrs >= s.dedicatedLeaderHrs ? 1 : s.smallJobLeaderWeight), 0);

export interface WeekTotals {
  week: IsoDate;
  sold: number;
  onHold: number;
  available: number;
  open: number;
  leadersNeeded: number;
  leadersAvailable: number;
  gap: boolean;
}

export function weekTotals(ds: Dataset, idx: Index, plans: Plans, weeks: IsoDate[]): WeekTotals[] {
  return weeks.map((w) => {
    const sold = loadForWeek(ds, plans, w);
    const available = capacity(ds, idx, w);
    const ln = leadersNeeded(ds, plans, w);
    const la = availableMen(ds, idx, w, true);
    return {
      week: w,
      sold,
      onHold: holdForWeek(ds, plans, w),
      available,
      open: available - sold,
      leadersNeeded: ln,
      leadersAvailable: la,
      gap: sold > available || ln > la,
    };
  });
}

/** Estimate at completion: average of the last two actual weeks x weeks remaining + actual to date. */
export function eac(idx: Index, j: Job): number {
  // A finished job's hours are what it took (review, Oct 27).
  if (j.status === "complete") return actualToDate(idx, j);
  const m = idx.actualsByJob.get(j.id);
  if (!m?.size) return j.projectedHrs;
  const ks = [...m.keys()].sort();
  const last = ks.slice(-2).map((k) => m.get(k)!);
  const burn = last.reduce((a, b) => a + b, 0) / last.length;
  let rem = 0;
  for (let w = addDays(ks[ks.length - 1], 7); mondayOf(w) <= j.projectedFinish; w = addDays(w, 7)) rem++;
  const act = actualToDate(idx, j);
  return rem > 0 ? act + burn * rem : Math.max(act, j.projectedHrs);
}

export const isOverrun = (idx: Index, j: Job, s: Settings) =>
  isSold(j) && (idx.actualsByJob.get(j.id)?.size ?? 0) > 0 && eac(idx, j) > j.projectedHrs * (1 + s.overrunPct / 100);

export const isPastFinish = (j: Job, week: IsoDate) => isSold(j) && j.projectedFinish < mondayOf(week);

export const isPastMustFinish = (j: Job) => isSold(j) && !!j.mustFinish && j.projectedFinish > j.mustFinish;

export const needsDateConfirm = (j: Job, week: IsoDate, s: Settings) =>
  isSold(j) && !isOnHold(j) && j.firmness === "best_guess" && j.start <= addDays(week, s.confirmDatesDays);

/** For a job waiting on another: "slip" if the predecessor finishes on or after this start, "over" if it is overrunning. */
export function predecessorIssue(idx: Index, j: Job, s: Settings): { pred: Job; issue: "slip" | "over" | null } | null {
  if (j.firmness !== "waiting" || !j.waitsOnJobId) return null;
  const pred = idx.jobsById.get(j.waitsOnJobId);
  if (!pred) return null;
  if (!isSold(pred) || !isSold(j)) return { pred, issue: null };
  if (pred.projectedFinish >= j.start) return { pred, issue: "slip" };
  if (isOverrun(idx, pred, s)) return { pred, issue: "over" };
  return { pred, issue: null };
}

export const isWinterWeek = (w: IsoDate, s: Settings) => {
  const md = mondayOf(w).slice(5);
  return s.winterStart <= s.winterEnd ? md >= s.winterStart && md <= s.winterEnd : md >= s.winterStart || md <= s.winterEnd;
};

/** Must-finish date falls in this week (Monday to Wednesday-after-Friday, as the demo marks it). */
export const mustFinishInWeek = (j: Job, w: IsoDate) =>
  !!j.mustFinish && mondayOf(w) <= j.mustFinish && j.mustFinish <= addDays(w, 2);

/**
 * Materials share of the contract, split by estimated cost at the burdened rate.
 * Computed once at intake and stored (decision 22).
 */
export function materialRevenueCents(contractCents: number, materialCostCents: number, estimateHrs: number, rateCents: number): number {
  const labor = estimateHrs * rateCents;
  const denom = materialCostCents + labor;
  if (denom <= 0 || contractCents <= 0) return 0;
  return Math.round((contractCents * materialCostCents) / denom);
}

export function bidMargin(contractCents: number, materialCostCents: number, estimateHrs: number, rateCents: number): number {
  if (contractCents <= 0) return 0;
  return 1 - (materialCostCents + estimateHrs * rateCents) / contractCents;
}
