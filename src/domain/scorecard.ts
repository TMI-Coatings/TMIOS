/** The leader scorecard: finished jobs per leader, hours and margin against bid, causes of overruns. */
import type { IsoDate, Job, Person } from "./types";

export interface Outcome {
  id: string;
  jobId: string | null;
  number: string;
  customer: string;
  jobType: string;
  leaderId: string | null;
  pmCode: string | null;
  finishedOn: IsoDate;
  estimateHrs: number;
  actualHrs: number;
  contractCents: number;
  gpBid: number;
  gpFinal: number;
  onTime: boolean;
  cause: string | null;
  illustrative: boolean;
}

export const fadeCents = (o: Outcome) => o.contractCents * (o.gpFinal - o.gpBid);

export interface LeaderRow {
  leader: Person;
  outcomes: Outcome[];
  jobs: number;
  hoursVsBid: number;
  over: number;
  fadePts: number;
  fadeCents: number;
  fieldCents: number;
  onTime: number | null;
  running: Job[];
}

/** One row per leader, ranked by field-caused fade (worst first), then total fade. */
export function leaderRows(leaders: Person[], outcomes: Outcome[], running: Job[], overrunPct: number): LeaderRow[] {
  return leaders
    .map((leader) => {
      const h = outcomes.filter((o) => o.leaderId === leader.id).sort((a, b) => b.finishedOn.localeCompare(a.finishedOn));
      const est = h.reduce((a, o) => a + o.estimateHrs, 0);
      const act = h.reduce((a, o) => a + o.actualHrs, 0);
      const val = h.reduce((a, o) => a + o.contractCents, 0);
      const fade = h.reduce((a, o) => a + fadeCents(o), 0);
      return {
        leader,
        outcomes: h,
        jobs: h.length,
        hoursVsBid: est ? act / est - 1 : 0,
        over: h.filter((o) => o.actualHrs > o.estimateHrs * (1 + overrunPct / 100)).length,
        fadePts: val ? fade / val : 0,
        fadeCents: fade,
        fieldCents: h.filter((o) => o.cause === "Field").reduce((a, o) => a + fadeCents(o), 0),
        onTime: h.length ? h.filter((o) => o.onTime).length / h.length : null,
        running: running.filter((j) => j.leaderId === leader.id),
      };
    })
    .filter((r) => r.jobs || r.running.length)
    .sort((a, b) => a.fieldCents - b.fieldCents || a.fadeCents - b.fadeCents);
}

/** Margin lost to fade, by tagged cause. */
export function lostByCause(outcomes: Outcome[]): [string, number][] {
  const by = new Map<string, number>();
  for (const o of outcomes) {
    const f = fadeCents(o);
    if (f < 0) by.set(o.cause ?? "Untagged", (by.get(o.cause ?? "Untagged") ?? 0) + f);
  }
  return [...by].sort((a, b) => a[1] - b[1]);
}
