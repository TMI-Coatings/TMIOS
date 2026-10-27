/**
 * The numbers and lists behind the Dashboard, the Monday digest and the alerts.
 * Ported from the demo (vDash, postDigest, capacityCheck, openCheck).
 */
import { crewIssues } from "./crew";
import {
  FIRMNESS,
  MOVABLE,
  type Index,
  type Plans,
  actualToDate,
  availableMen,
  capacity,
  eac,
  hoursLeft,
  inWindow,
  isOnHold,
  isOverrun,
  isPastFinish,
  isPastMustFinish,
  isSold,
  isWinterWeek,
  leadersNeeded,
  loadForWeek,
  needsDateConfirm,
  predecessorIssue,
} from "./schedule";
import type { Dataset, Firmness, IsoDate, Job, Settings } from "./types";
import { addDays, daysBetween, fmtShort, weekList } from "./weeks";
import { ownerName } from "./journey";
import { journeyOf, namesOf } from "./views";
import { Money, revenueByPeriod } from "./money";

const usdShort = (cents: number) => {
  const v = cents / 100;
  return v >= 1e6 ? "$" + (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? "$" + Math.round(v / 1e3) + "K" : "$" + Math.round(v);
};
import { woDaysWaiting, woLate, woOpen, woStatus, woWaiting } from "./workOrders";

const n0 = (v: number) => Math.round(v).toLocaleString("en-US");
const n1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString("en-US");

export function gapWeeks(ds: Dataset, idx: Index, plans: Plans, week: IsoDate, n = 8): IsoDate[] {
  return weekList(week, n).filter((w) => loadForWeek(ds, plans, w) > capacity(ds, idx, w) || leadersNeeded(ds, plans, w) > availableMen(ds, idx, w, true));
}

/** Weeks in the sell window (4 to 8 weeks out by default) with at least the open-capacity hours free. */
export function openWeeks(ds: Dataset, idx: Index, plans: Plans, week: IsoDate, s: Settings = ds.settings) {
  return weekList(week, s.openWindowEndWeeks + 1)
    .slice(s.openWindowStartWeeks)
    .map((w) => ({ week: w, open: capacity(ds, idx, w) - loadForWeek(ds, plans, w) }))
    .filter((x) => x.open >= s.openCapacityHrs);
}

/** Jobs that could move first in a gap week: fill-in, very flexible, best guess, loosest first. */
export function movers(ds: Dataset, plans: Plans, w: IsoDate): Job[] {
  const order = (f: Firmness) => FIRMNESS.findIndex((x) => x.key === f);
  return ds.jobs
    .filter((j) => isSold(j) && !isOnHold(j) && (plans.get(j.id)?.get(w) ?? 0) > 0 && MOVABLE.includes(j.firmness))
    .sort((a, b) => order(b.firmness) - order(a.firmness));
}

export const backlogHours = (ds: Dataset, idx: Index) => ds.jobs.filter(isSold).reduce((a, j) => a + Math.max(0, hoursLeft(idx, j)), 0);

export const backlogCents = (ds: Dataset, idx: Index) =>
  Math.round(ds.jobs.filter(isSold).reduce((a, j) => a + (j.contractCents * Math.max(0, hoursLeft(idx, j))) / Math.max(1, j.projectedHrs), 0));

export function backlogWeeks(ds: Dataset, idx: Index, week: IsoDate): number {
  const ws = weekList(week, 13);
  const cap = ws.reduce((a, w) => a + capacity(ds, idx, w), 0) / ws.length;
  return cap ? backlogHours(ds, idx) / cap : 0;
}

/** Scheduled hours in the next n weeks by firmness; on-hold hours kept apart. */
export function firmnessMix(ds: Dataset, plans: Plans, week: IsoDate, n = 8) {
  const t = Object.fromEntries(FIRMNESS.map((f) => [f.key, 0])) as Record<Firmness, number>;
  let hold = 0;
  for (const w of weekList(week, n))
    for (const j of ds.jobs) {
      if (!isSold(j)) continue;
      const h = plans.get(j.id)?.get(w) ?? 0;
      if (!h) continue;
      if (isOnHold(j)) hold += h;
      else t[j.firmness] += h;
    }
  return { byFirmness: t, total: Object.values(t).reduce((a, b) => a + b, 0), hold };
}

export function winterJobs(ds: Dataset, week: IsoDate) {
  return ds.jobs
    .filter((j) => isSold(j) && j.exterior)
    .map((j) => ({ job: j, weeks: weekList(week, 30).filter((w) => inWindow(j, w) && isWinterWeek(w, ds.settings)) }))
    .filter((x) => x.weeks.length);
}

export const range = (ws: IsoDate[]) => (ws.length > 1 ? `${fmtShort(ws[0])}–${fmtShort(ws[ws.length - 1])}` : fmtShort(ws[0]));

export type Tone = "red" | "yel" | "blue" | "";
export interface AttentionItem {
  tag: string;
  tone: Tone;
  /** Text with {job:<id>} markers the screen turns into job links. */
  text: string;
}

const jl = (j: Job) => `{job:${j.id}}`;
const leaderFirst = (ds: Dataset, j: Job) => (ds.people.find((p) => p.id === j.leaderId)?.name ?? "No leader").split(" ")[0];

/** The Dashboard's Needs attention list, in the demo's order. */
export function needsAttention(ds: Dataset, idx: Index, plans: Plans, week: IsoDate, today: IsoDate = addDays(week, -4)): AttentionItem[] {
  const s = ds.settings;
  const out: AttentionItem[] = [];
  const repName = (c: string) => ds.reps.find((r) => r.code === c)?.name ?? c;
  const pmName = (c: string) => ds.pms.find((r) => r.code === c)?.name ?? c;
  const gaps = gapWeeks(ds, idx, plans, week);
  for (const w of gaps) {
    const parts: string[] = [];
    const over = loadForWeek(ds, plans, w) - capacity(ds, idx, w);
    const short = leadersNeeded(ds, plans, w) - availableMen(ds, idx, w, true);
    if (over > 0) parts.push(`${n0(over)} hrs over`);
    if (short > 0) parts.push(`${n1(short)} leaders short`);
    out.push({ tag: "Gap", tone: "red", text: `Week ending ${fmtShort(w)}: ${parts.join(", ")}.` });
  }
  for (const w of gaps) {
    const mv = movers(ds, plans, w);
    if (mv.length)
      out.push({
        tag: "Move first",
        tone: "blue",
        text: `Week ending ${fmtShort(w)}: the most movable work is ${mv
          .slice(0, 3)
          .map((j) => `${jl(j)} (${FIRMNESS.find((f) => f.key === j.firmness)!.label.toLowerCase()})`)
          .join(", ")}. Locked jobs stay put.`,
      });
  }
  for (const j of ds.jobs.filter((x) => needsDateConfirm(x, week, s)))
    out.push({ tag: "Confirm", tone: "yel", text: `${jl(j)} starts ${fmtShort(j.start)} on TMI’s best guess. ${repName(j.repCode)} to confirm timing with the customer.` });
  for (const j of ds.jobs) {
    const p = predecessorIssue(idx, j, s);
    if (!p?.issue) continue;
    out.push({
      tag: p.issue === "slip" ? "Blocked" : "Watch",
      tone: p.issue === "slip" ? "red" : "yel",
      text:
        `${jl(j)} can’t start until ${jl(p.pred)} finishes. ` +
        (p.issue === "slip"
          ? `That job now runs to ${fmtShort(p.pred.projectedFinish)}, past this one’s ${fmtShort(j.start)} start. Move the start or the crew.`
          : `That job is on pace for ${n0(eac(idx, p.pred))} hrs against ${n0(p.pred.projectedHrs)}. Check the ${fmtShort(j.start)} start.`),
    });
  }
  for (const j of ds.jobs.filter((x) => isSold(x) && isOnHold(x) && x.holdUntil && x.holdUntil <= week))
    out.push({ tag: "On hold", tone: "yel", text: `${jl(j)} was due to restart ${fmtShort(j.holdUntil!)}. Update the status or the restart date.` });
  for (const j of ds.jobs.filter((x) => isOverrun(idx, x, s))) {
    const e = eac(idx, j);
    out.push({ tag: "Overrun", tone: "red", text: `${jl(j)} on pace for ${n0(e)} hrs vs ${n0(j.projectedHrs)} projected (+${Math.round((e / j.projectedHrs - 1) * 100)}%).` });
  }
  const issues = groupedCrewIssues(ds, idx, weekList(week, 6));
  for (const i of issues.slice(0, 8)) out.push(i);
  if (issues.length > 8) out.push({ tag: "Crew", tone: "", text: `${issues.length - 8} more crew issues in the next 6 weeks. Open a job to see its crew.` });
  const thisWeek = ds.jobs.filter((j) => isSold(j) && !isOnHold(j) && inWindow(j, week));
  const unconf = thisWeek.filter((j) => !ds.confirmations.some((c) => c.jobId === j.id && c.week === week));
  if (unconf.length)
    out.push({
      tag: "Unconfirmed",
      tone: "yel",
      text: `${unconf.length} of ${thisWeek.length} crews this week not confirmed by their leader: ${[...new Set(unconf.map((j) => leaderFirst(ds, j)))].join(", ")}.`,
    });
  for (const x of winterJobs(ds, week))
    out.push({ tag: "Winter", tone: "blue", text: `Exterior work on ${jl(x.job)} falls in winter weeks (${range(x.weeks)}). Confirm the weather plan.` });
  for (const j of ds.jobs.filter(isPastMustFinish))
    out.push({
      tag: "Deadline",
      tone: "red",
      text: `${jl(j)} is projected to finish ${fmtShort(j.projectedFinish)}, after its ${j.mustFinishReason === "shutdown" ? "shutdown" : "contract obligation"} deadline of ${fmtShort(j.mustFinish!)}.`,
    });
  for (const x of openWeeks(ds, idx, plans, week))
    out.push({ tag: "Sell", tone: "blue", text: `Week ending ${fmtShort(x.week)} has ${n0(x.open)} hrs open, about ${n0(x.open / s.hoursPerManWeek)} men. Sales team alerted.` });
  for (const j of ds.jobs.filter((x) => isPastFinish(x, week)))
    out.push({ tag: "Late", tone: "yel", text: `${jl(j)} passed its finish date with ${n0(hoursLeft(idx, j))} hrs left.` });
  const last = [...ds.closes].sort((a, b) => a.week.localeCompare(b.week)).at(-1);
  for (const id of last?.missingJobIds ?? []) {
    const j = ds.jobs.find((x) => x.id === id);
    if (j) out.push({ tag: "Missing", tone: "yel", text: `${jl(j)} had no hours at the last close (PM ${pmName(j.pmCode)}).` });
  }
  // Work orders late or not final close to the start.
  const n = namesOf(ds);
  const due = s.woReviewDays;
  for (const j of [...ds.jobs].sort((a, b) => a.start.localeCompare(b.start))) {
    const w = ds.workOrders.find((x) => x.jobId === j.id);
    if (!w || !woOpen(j, w)) continue;
    const late = woLate(j, w, today, due);
    const soon = daysBetween(today, j.start) <= s.woStartSoonDays;
    if (!late && !soon) continue;
    out.push({
      tag: "Work order",
      tone: late ? "red" : "yel",
      text:
        `${jl(j)} ` +
        (late ? `waiting ${woDaysWaiting(w, today)} days on ${woWaiting(j, w, n)}, past the ${due}-day review deadline. PM ${n.pm(j.pmCode)} pinged.` : `is ${woStatus(w).toLowerCase()}, waiting on ${woWaiting(j, w, n)}.`) +
        (soon ? ` Starts ${fmtShort(j.start)} without a final work order.` : ""),
    });
  }
  // Startup checkpoints overdue on jobs starting soon; a count for the rest.
  const jy = journeyOf(ds, today);
  const soonJobs = ds.jobs.filter((j) => isSold(j) && j.start <= addDays(today, s.journeyLookaheadDays) && jy.inStartup(j));
  for (const j of soonJobs) {
    const lt = jy.startupDefs().filter((c) => jy.isLate(j, c));
    if (lt.length)
      out.push({
        tag: "Not ready",
        tone: "red",
        text: `${jl(j)} starts ${fmtShort(j.start)} with ${lt.map((c) => `${c.label.charAt(0).toLowerCase() + c.label.slice(1)} (${ownerName(j, c, namesOf(ds))})`).join(", ")} overdue.`,
      });
  }
  const other = ds.jobs.filter((j) => isSold(j) && !soonJobs.includes(j)).reduce((a, j) => a + jy.lateList(j).length, 0);
  if (other) out.push({ tag: "Journey", tone: "yel", text: `${other} more overdue checkpoint${other > 1 ? "s" : ""} on other jobs. See the Job journey tab.` });
  return out;
}

export function groupedCrewIssues(ds: Dataset, idx: Index, weeks: IsoDate[]): AttentionItem[] {
  const groups = new Map<string, { i: ReturnType<typeof crewIssues>[number]; weeks: IsoDate[] }>();
  for (const i of crewIssues(ds, idx, weeks)) {
    const key = [i.kind, i.job.id, i.person?.id ?? "", i.otherJob?.id ?? ""].join("|");
    if (!groups.has(key)) groups.set(key, { i, weeks: [] });
    groups.get(key)!.weeks.push(i.week);
  }
  return [...groups.values()].map(({ i, weeks: ws }) => {
    const r = range(ws);
    const name = i.person?.name ?? "";
    const text = {
      double: `${name} is on ${jl(i.job)} and ${i.otherJob?.customer} the same week (${r}).`,
      off: `${name} is assigned to ${jl(i.job)} but has time off (${r}).`,
      inactive: `${name} is off the roster but still assigned to ${jl(i.job)} (${r}).`,
      qual: `${name} on ${jl(i.job)} lacks ${i.missing?.join(" and ")} (${r}).`,
      dot: `${name}’s DOT physical expires before ${jl(i.job)} (${r}).`,
      short: `${jl(i.job)} has ${i.have} of ${i.job.crewSize} crew assigned (${r}).`,
    }[i.kind];
    const tag = { double: "Double-booked", off: "Time off", inactive: "Off roster", qual: "Qualification", dot: "DOT physical", short: "Short crew" }[i.kind];
    return { tag, tone: i.kind === "double" || i.kind === "off" ? "red" : "yel", text } as AttentionItem;
  });
}

/** The Monday digest lines (the demo's postDigest), from what is built so far. */
export function digestLines(ds: Dataset, idx: Index, plans: Plans, week: IsoDate, today: IsoDate = addDays(week, -4)): string[] {
  const s = ds.settings;
  const jobsNow = ds.jobs.filter((j) => isSold(j) && !isOnHold(j) && (plans.get(j.id)?.get(week) ?? 0) > 0);
  const gaps = gapWeeks(ds, idx, plans, week);
  const last = [...ds.closes].sort((a, b) => a.week.localeCompare(b.week)).at(-1);
  const missing = (last?.missingJobIds ?? []).map((id) => ds.jobs.find((j) => j.id === id)).filter(Boolean) as Job[];
  const unconf = jobsNow.filter((j) => !ds.confirmations.some((c) => c.jobId === j.id && c.week === week)).length;
  const issues = groupedCrewIssues(ds, idx, [week, addDays(week, 7)]).length;
  const lateRisk = ds.jobs.filter(isPastMustFinish);
  const open = openWeeks(ds, idx, plans, week);
  const real = ds.metrics.filter((m) => !m.illustrative && m.accuracy != null).sort((a, b) => a.week.localeCompare(b.week));
  const acc = real.at(-1)?.accuracy;
  const pmName = (c: string) => ds.pms.find((r) => r.code === c)?.name ?? c;
  return [
    `${jobsNow.length} jobs on the board this week, ${n0(loadForWeek(ds, plans, week))} hrs scheduled vs ${n0(capacity(ds, idx, week))} available.`,
    jobsNow.length ? `Leaders: ${jobsNow.map((j) => `${leaderFirst(ds, j)} (${j.customer})`).join(", ")}.` : "",
    unconf ? `${unconf} crews not yet confirmed by their leader.` : "Every crew confirmed by its leader.",
    issues ? `${issues} crew issues in the next two weeks (double-booked, time off, qualifications).` : "No crew issues in the next two weeks.",
    lateRisk.length ? `Projected past must-finish: ${lateRisk.map((j) => `${j.customer} (${fmtShort(j.projectedFinish)} vs ${fmtShort(j.mustFinish!)})`).join(", ")}.` : "",
    open.length ? `Open to sell, ${s.openWindowStartWeeks} to ${s.openWindowEndWeeks} weeks out: ${open.map((x) => `${fmtShort(x.week)} (${n0(x.open)} hrs)`).join(", ")}.` : "",
    gaps.length ? `Gaps ahead: ${gaps.map(fmtShort).join(", ")}.` : "No capacity gaps in the next 8 weeks.",
    (() => {
      const open = ds.jobs.filter((j) => woOpen(j, ds.workOrders.find((w) => w.jobId === j.id)));
      if (!open.length) return "Every booked job has a final work order.";
      const late = open.filter((j) => woLate(j, ds.workOrders.find((w) => w.jobId === j.id), today, s.woReviewDays)).length;
      const soon = open.filter((j) => daysBetween(today, j.start) <= s.woStartSoonDays).length;
      return `Work orders: ${open.length} not final${late ? `, ${late} past the review deadline` : ""}${soon ? `, ${soon} starting within ${s.woStartSoonDays} days` : ""}.`;
    })(),
    missing.length ? `Missing hours from last close: ${missing.map((j) => `${j.number} ${j.customer} (PM ${pmName(j.pmCode)})`).join(", ")}.` : last ? "All hours entered at last close." : "",
    (() => {
      if (!ds.percents.length && !ds.invoices.length) return "";
      const m = new Money(ds, idx, week, today);
      const [mo] = revenueByPeriod(ds, m, plans, week, "month");
      return `${mo.label} revenue forecast ${usdShort(mo.actual + mo.lab + mo.mat)}, ${usdShort(mo.actual)} recognized so far.`;
    })(),
    acc != null ? `Forecast accuracy, 4 weeks out: ${Math.round(acc * 100)}%.` : "Forecast accuracy starts after the first close.",
  ].filter(Boolean);
}

export const digestTitle = (week: IsoDate) => `Monday digest for the week of ${fmtShort(addDays(week, -4))}`;

/** For the dashboard KPIs. */
export function kpis(ds: Dataset, idx: Index, plans: Plans, week: IsoDate) {
  const s = ds.settings;
  const load = loadForWeek(ds, plans, week);
  return {
    menScheduled: load / s.hoursPerManWeek,
    menAvailable: availableMen(ds, idx, week),
    leadersNeeded: leadersNeeded(ds, plans, week),
    leadersAvailable: availableMen(ds, idx, week, true),
    backlogWeeks: backlogWeeks(ds, idx, week),
    backlogCents: backlogCents(ds, idx),
    overruns: ds.jobs.filter((j) => isOverrun(idx, j, s)).length,
    gaps: gapWeeks(ds, idx, plans, week).length,
    actualToDate: (j: Job) => actualToDate(idx, j),
  };
}
