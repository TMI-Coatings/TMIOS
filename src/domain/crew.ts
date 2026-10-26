import type { Dataset, IsoDate, Job, Person } from "./types";
import { type Index, inWindow, isSold, offFraction } from "./schedule";

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
