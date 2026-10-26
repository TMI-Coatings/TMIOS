import { describe, expect, it } from "vitest";
import {
  allPlans,
  availableMen,
  bidMargin,
  buildIndex,
  capacity,
  eac,
  hoursLeft,
  isOverrun,
  isPastMustFinish,
  isWinterWeek,
  leadersNeeded,
  materialRevenueCents,
  needsDateConfirm,
  planFor,
  predecessorIssue,
  weekTotals,
} from "../../src/domain/schedule";
import { weekList } from "../../src/domain/weeks";
import { W, dataset, job, person } from "./fixtures";

describe("plan spread", () => {
  it("spreads hours left evenly over the remaining weeks", () => {
    const ds = dataset({ jobs: [job()] });
    const p = planFor(buildIndex(ds), ds.jobs[0], W);
    expect([...p.entries()]).toEqual([
      ["2026-10-30", 100],
      ["2026-11-06", 100],
      ["2026-11-13", 100],
      ["2026-11-20", 100],
    ]);
  });
  it("subtracts actuals before spreading", () => {
    const ds = dataset({ jobs: [job({ start: "2026-10-19" })], actuals: [{ jobId: "j1", week: "2026-10-23", hours: 100 }] });
    const idx = buildIndex(ds);
    expect(hoursLeft(idx, ds.jobs[0])).toBe(300);
    expect([...planFor(idx, ds.jobs[0], W).values()]).toEqual([75, 75, 75, 75]);
  });
  it("keeps a week set by hand and rebalances the rest", () => {
    const ds = dataset({ jobs: [job()], overrides: [{ jobId: "j1", week: "2026-11-06", hours: 160 }] });
    const p = planFor(buildIndex(ds), ds.jobs[0], W);
    expect(p.get("2026-11-06")).toBe(160);
    expect(p.get("2026-10-30")).toBe(80);
    expect(p.get("2026-11-20")).toBe(80);
  });
  it("puts leftover hours in this week when a job runs past its finish", () => {
    const ds = dataset({ jobs: [job({ start: "2026-10-05", projectedFinish: "2026-10-16" })] });
    expect([...planFor(buildIndex(ds), ds.jobs[0], W).entries()]).toEqual([[W, 400]]);
  });
  it("plans nothing for complete jobs", () => {
    const ds = dataset({ jobs: [job({ status: "complete" })] });
    expect(planFor(buildIndex(ds), ds.jobs[0], W).size).toBe(0);
  });
});

describe("capacity", () => {
  const crew = [person({ id: "a", kind: "leader" }), person({ id: "b" }), person({ id: "c" }), person({ id: "d", active: false })];
  it("is active roster less time off x hours per man-week x (1 - absence)", () => {
    const ds = dataset({ people: crew, timeOff: [{ id: "t", personId: "b", firstDay: "2026-10-26", lastDay: "2026-10-27", type: "PTO", active: true }] });
    const idx = buildIndex(ds);
    expect(availableMen(ds, idx, W)).toBeCloseTo(2.6);
    expect(capacity(ds, idx, W)).toBeCloseTo(2.6 * 40 * 0.9);
    expect(availableMen(ds, idx, W, true)).toBe(1);
  });
  it("ignores time off that was removed", () => {
    const ds = dataset({ people: crew, timeOff: [{ id: "t", personId: "b", firstDay: "2026-10-26", lastDay: "2026-10-30", type: "PTO", active: false }] });
    expect(availableMen(ds, buildIndex(ds), W)).toBe(3);
  });
  it("uses the settings, not fixed numbers", () => {
    const ds = dataset({ people: crew });
    ds.settings.absencePct = 20;
    ds.settings.hoursPerManWeek = 50;
    expect(capacity(ds, buildIndex(ds), W)).toBeCloseTo(3 * 50 * 0.8);
  });
});

describe("load and totals", () => {
  it("counts sold work only and takes on-hold hours out of capacity", () => {
    const ds = dataset({
      people: [person({ id: "p1", kind: "leader" }), person({ id: "p2" })],
      jobs: [job({ id: "a" }), job({ id: "b", status: "on_hold" }), job({ id: "c", status: "complete" })],
    });
    const idx = buildIndex(ds);
    const [t] = weekTotals(ds, idx, allPlans(ds, idx, W), [W]);
    expect(t.sold).toBe(100);
    expect(t.onHold).toBe(100);
    expect(t.available).toBeCloseTo(72);
    expect(t.open).toBeCloseTo(-28);
    expect(t.gap).toBe(true);
  });
  it("needs one leader for a large job and half for a small one", () => {
    const ds = dataset({ jobs: [job({ id: "a", projectedHrs: 400 }), job({ id: "b", projectedHrs: 200 })] });
    const idx = buildIndex(ds);
    expect(leadersNeeded(ds, allPlans(ds, idx, W), W)).toBe(1.5);
  });
  it("flags a gap week when leaders run short even with hours to spare", () => {
    const ds = dataset({ people: Array.from({ length: 10 }, (_, i) => person({ id: "f" + i })), jobs: [job()] });
    const idx = buildIndex(ds);
    const ws = weekList(W, 2);
    expect(weekTotals(ds, idx, allPlans(ds, idx, W), ws).map((t) => t.gap)).toEqual([true, true]);
  });
});

describe("tags", () => {
  it("flags an overrun when EAC beats projected by the overrun %", () => {
    const j = job({ start: "2026-10-12", projectedFinish: "2026-11-06", projectedHrs: 400 });
    const ds = dataset({
      jobs: [j],
      actuals: [
        { jobId: "j1", week: "2026-10-16", hours: 130 },
        { jobId: "j1", week: "2026-10-23", hours: 130 },
      ],
    });
    const idx = buildIndex(ds);
    expect(eac(idx, j)).toBe(260 + 130 * 2);
    expect(isOverrun(idx, j, ds.settings)).toBe(true);
    ds.settings.overrunPct = 40;
    expect(isOverrun(idx, j, ds.settings)).toBe(false);
  });
  it("flags a projected finish past the must-finish date", () => {
    expect(isPastMustFinish(job({ mustFinish: "2026-11-13" }))).toBe(true);
    expect(isPastMustFinish(job({ mustFinish: "2026-11-20" }))).toBe(false);
  });
  it("asks to confirm best-guess dates starting within the window", () => {
    const s = dataset().settings;
    expect(needsDateConfirm(job({ firmness: "best_guess", start: "2026-11-23" }), W, s)).toBe(true);
    expect(needsDateConfirm(job({ firmness: "best_guess", start: "2026-12-07" }), W, s)).toBe(false);
    expect(needsDateConfirm(job({ firmness: "confirmed", start: "2026-11-02" }), W, s)).toBe(false);
  });
  it("marks a waiting job blocked when its predecessor finishes on or after its start", () => {
    const pred = job({ id: "p", projectedFinish: "2026-11-20" });
    const next = job({ id: "n", firmness: "waiting", waitsOnJobId: "p", start: "2026-11-16", projectedFinish: "2026-12-04", status: "scheduled" });
    const ds = dataset({ jobs: [pred, next] });
    expect(predecessorIssue(buildIndex(ds), next, ds.settings)?.issue).toBe("slip");
  });
  it("knows winter weeks, including across New Year", () => {
    const s = dataset().settings;
    expect(isWinterWeek("2026-12-04", s)).toBe(false); // judged by its Monday, Nov 30
    expect(isWinterWeek("2026-12-11", s)).toBe(true);
    expect(isWinterWeek("2027-01-08", s)).toBe(true);
    expect(isWinterWeek("2027-03-19", s)).toBe(true); // Monday Mar 15 is the last winter Monday
    expect(isWinterWeek("2027-03-26", s)).toBe(false);
  });
});

describe("contract split at intake", () => {
  it("splits by estimated cost at the burdened rate, in whole cents", () => {
    // $100,000 contract, $20,000 materials, 600 hrs x $55 = $33,000 labor cost.
    expect(materialRevenueCents(10_000_000, 2_000_000, 600, 5500)).toBe(Math.round((10_000_000 * 2_000_000) / 5_300_000));
    expect(bidMargin(10_000_000, 2_000_000, 600, 5500)).toBeCloseTo(0.47);
  });
});

import { jobProblem } from "../../src/domain/jobRules";
describe("job checks before saving", () => {
  it("matches the database rules", () => {
    expect(jobProblem(null, job({ number: "412" }))).toMatch(/four digits/);
    expect(jobProblem(null, job({ projectedFinish: "2026-10-01" }))).toMatch(/finish date/);
    expect(jobProblem(null, job({ status: "on_hold" }))).toMatch(/on hold/);
    expect(jobProblem(null, job({ firmness: "waiting" }))).toMatch(/waits on/);
    expect(jobProblem(null, job({ retainagePct: 5 }))).toMatch(/release terms/);
    expect(jobProblem(job({ firmness: "locked" }), job({ firmness: "confirmed" }))).toMatch(/Locked/);
    expect(jobProblem(job({ firmness: "locked" }), job({ firmness: "confirmed", firmnessReason: "Moved" }))).toBeNull();
  });
});
