import type { Dataset, IsoDate, Job, Person } from "./types";
import { type Index, inWindow, isSold, offFraction } from "./schedule";
import { addDays } from "./weeks";

export type CrewIssueKind = "double" | "off" | "inactive" | "qual" | "dot" | "short";

export interface CrewIssue {
  kind: CrewIssueKind;
  week: IsoDate;
  job: Job;
  person?: Person;
  otherJob?: Job;
  missing?: string[];
  have?: number;
}

export const CREW_ISSUE_LABEL: Record<CrewIssueKind, string> = {
  double: "Double-booked",
  off: "Time off",
  inactive: "Off roster",
  qual: "Qualification",
  dot: "DOT physical",
  short: "Short crew",
};

export function assignedIds(ds: Dataset, jobId: string, week: IsoDate): string[] {
  return ds.assignments.filter((a) => a.jobId === jobId && a.week === week).map((a) => a.personId);
}

/** A qualification counts only if held and not expired by the week ending. */
export const missingQuals = (p: Person, job: Job, week: IsoDate) =>
  job.requirements.filter((q) => !(q in p.quals) || (p.quals[q] != null && p.quals[q]! < week));

/** Double-booked, time off, off roster, missing or expired qualification, DOT physical lapsed (drivers only), short crew. */
export function crewIssues(ds: Dataset, idx: Index, weeks: IsoDate[]): CrewIssue[] {
  const people = new Map(ds.people.map((p) => [p.id, p]));
  const out: CrewIssue[] = [];
  for (const week of weeks) {
    const seen = new Map<string, Job>();
    for (const job of ds.jobs) {
      if (!isSold(job) || !inWindow(job, week)) continue;
      const ids = assignedIds(ds, job.id, week);
      for (const pid of ids) {
        const p = people.get(pid);
        if (!p) continue;
        const other = seen.get(pid);
        if (other) out.push({ kind: "double", week, job, person: p, otherJob: other });
        else seen.set(pid, job);
        if (offFraction(idx, p, week) > 0) out.push({ kind: "off", week, job, person: p });
        if (!p.active) out.push({ kind: "inactive", week, job, person: p });
        const miss = missingQuals(p, job, week);
        if (miss.length) out.push({ kind: "qual", week, job, person: p, missing: miss });
        if (p.driver && (!p.dotExpires || p.dotExpires < week)) out.push({ kind: "dot", week, job, person: p });
      }
      if (ids.length < job.crewSize) out.push({ kind: "short", week, job, have: ids.length });
    }
  }
  return out;
}

/**
 * Crew auto-fill, shown as a preview first (decision 28): the leader, then last week's crew,
 * then qualified people who are free, on the roster, not off, and (for drivers) with a current DOT.
 */
export function proposeCrew(ds: Dataset, idx: Index, job: Job, week: IsoDate): string[] {
  const cur = assignedIds(ds, job.id, week);
  const add: string[] = [];
  const busy = new Set(ds.assignments.filter((a) => a.week === week && a.jobId !== job.id).map((a) => a.personId));
  if (job.leaderId && !cur.includes(job.leaderId) && !busy.has(job.leaderId)) add.push(job.leaderId);
  const need = job.crewSize - cur.length - add.length;
  if (need <= 0) return add;
  const prev = new Set(assignedIds(ds, job.id, addDays(week, -7)));
  const ok = (p: Person) => missingQuals(p, job, week).length === 0;
  const score = (p: Person) => (prev.has(p.id) ? 4 : 0) + (ok(p) ? 2 : 0);
  const cands = ds.people
    .filter(
      (p) =>
        p.active &&
        p.kind === "field" &&
        !busy.has(p.id) &&
        !cur.includes(p.id) &&
        !add.includes(p.id) &&
        offFraction(idx, p, week) === 0 &&
        (!p.driver || (!!p.dotExpires && p.dotExpires >= week)),
    )
    .sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
  return [...add, ...cands.slice(0, need).map((p) => p.id)];
}

/** Auto-fill every short crew in a week, earliest-starting jobs first, so nobody is proposed twice. */
export function proposeWeek(ds: Dataset, idx: Index, week: IsoDate): { job: Job; add: string[] }[] {
  const work: Dataset = { ...ds, assignments: [...ds.assignments] };
  const out: { job: Job; add: string[] }[] = [];
  const jobs = ds.jobs.filter((j) => isSold(j) && j.status !== "on_hold" && inWindow(j, week)).sort((a, b) => a.start.localeCompare(b.start));
  for (const job of jobs) {
    if (assignedIds(work, job.id, week).length >= job.crewSize) continue;
    const add = proposeCrew(work, idx, job, week);
    if (!add.length) continue;
    out.push({ job, add });
    for (const pid of add) work.assignments.push({ id: "proposed", jobId: job.id, personId: pid, week });
  }
  return out;
}
