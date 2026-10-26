import { describe, expect, it } from "vitest";
import { capacityAlerts, jobChangeAlerts } from "../../src/domain/alerts";
import { forecastAccuracy, parseHoursCsv, reviewFlag } from "../../src/domain/close";
import { proposeCrew, proposeWeek } from "../../src/domain/crew";
import { digestLines, needsAttention, openWeeks } from "../../src/domain/insights";
import { allPlans, buildIndex } from "../../src/domain/schedule";
import { planningWeek, weekToClose } from "../../src/domain/weeks";
import { buildSample } from "../../src/sample/seed";
import { W, dataset, job, person } from "./fixtures";

describe("which week", () => {
  it("plans from the first week not yet closed, never behind the calendar", () => {
    expect(planningWeek([], "2026-10-26")).toBe("2026-10-30");
    expect(planningWeek(["2026-10-23"], "2026-10-26")).toBe("2026-10-30");
    expect(planningWeek(["2026-10-30"], "2026-10-30")).toBe("2026-11-06"); // closed Friday afternoon
    expect(planningWeek(["2026-10-16"], "2026-10-28")).toBe("2026-10-30"); // a week was never closed
  });
  it("closes the next week in order, and not ahead of the calendar", () => {
    expect(weekToClose(["2026-10-23"], "2026-10-26")).toBe("2026-10-30");
    expect(weekToClose(["2026-10-30"], "2026-10-30")).toBeNull();
    expect(weekToClose(["2026-10-16"], "2026-11-02")).toBe("2026-10-23"); // catch up the missed week first
  });
});

describe("the close review", () => {
  it("flags missing hours only after an import, and hours past the overrun threshold", () => {
    expect(reviewFlag(100, null, false, 15)).toBeNull();
    expect(reviewFlag(100, null, true, 15)).toBe("Missing");
    expect(reviewFlag(100, 120, true, 15)).toBe("+20% vs plan");
    expect(reviewFlag(100, 80, true, 15)).toBe("−20% vs plan");
    expect(reviewFlag(100, 110, true, 15)).toBeNull();
  });
  it("reads a CSV of job number and hours, adding repeat lines", () => {
    const m = parseHoursCsv('Job,Hours\n4112,40\n"4112", 8.5\n4119,32\n\nnotes,x');
    expect([...m]).toEqual([
      ["4112", 48.5],
      ["4119", 32],
    ]);
  });
  it("measures accuracy against the forecast from 4 weeks earlier, leaving missing jobs out", () => {
    const snap = [
      { jobId: "a", hours: 100 },
      { jobId: "b", hours: 100 },
    ];
    expect(forecastAccuracy(snap, 90, ["b"])).toBeCloseTo(0.9);
    expect(forecastAccuracy([], 90, [])).toBeNull();
  });
});

describe("crew auto-fill", () => {
  const ds = dataset({
    jobs: [job({ crewSize: 3, leaderId: "L", requirements: ["Lift"] })],
    people: [
      person({ id: "L", kind: "leader" }),
      person({ id: "a", name: "Ann", quals: { Lift: null } }),
      person({ id: "b", name: "Bo" }),
      person({ id: "c", name: "Cy", quals: { Lift: null }, driver: true, dotExpires: "2026-01-01" }),
      person({ id: "d", name: "Di", quals: { Lift: null } }),
    ],
    assignments: [{ id: "x", jobId: "j1", personId: "d", week: "2026-10-23" }],
  });
  it("puts the leader first, then last week's crew, then qualified people; skips lapsed DOT", () => {
    expect(proposeCrew(ds, buildIndex(ds), ds.jobs[0], W)).toEqual(["L", "d", "a"]);
  });
  it("never proposes the same person for two jobs in one week", () => {
    const two = dataset({ ...ds, jobs: [job({ id: "j1", crewSize: 2, leaderId: null }), job({ id: "j2", crewSize: 2, leaderId: null })] });
    const all = proposeWeek(two, buildIndex(two), W).flatMap((x) => x.add);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("dashboard, digest and alerts on the sample", () => {
  const s = buildSample(W);
  const idx = buildIndex(s);
  const plans = allPlans(s, idx, W);
  it("lists what needs attention with job links", () => {
    const att = needsAttention(s, idx, plans, W);
    expect(att.map((a) => a.tag)).toEqual(expect.arrayContaining(["Overrun", "Confirm", "Deadline", "Unconfirmed"]));
    expect(att.find((a) => a.tag === "Overrun")!.text).toMatch(/\{job:/);
  });
  it("writes the Monday digest", () => {
    const lines = digestLines(s, idx, plans, W);
    expect(lines[0]).toMatch(/jobs on the board this week, [\d,]+ hrs scheduled vs [\d,]+ available\./);
    expect(lines.at(-1)).toMatch(/Forecast accuracy/);
  });
  it("fires open-capacity alerts once, until the weeks change", () => {
    const state: Record<string, string> = {};
    const first = capacityAlerts(s, idx, plans, W, state);
    expect(first.map((a) => a.rule)).toContain("open");
    expect(openWeeks(s, idx, plans, W).length).toBeGreaterThan(0);
    expect(capacityAlerts(s, idx, plans, W, state)).toEqual([]);
  });
  it("words a date move the way the database does", () => {
    const j = s.jobs[3];
    const [a] = jobChangeAlerts(s, j, { ...j, start: "2026-11-02" }, "Nicole");
    expect(a.title).toBe(`Date moved: ${j.number} ${j.customer}`);
    expect(a.body).toBe("Start Oct 26 → Nov 2\nChanged by Nicole.");
  });
});

import { leaderRows, lostByCause } from "../../src/domain/scorecard";
describe("leader scorecard", () => {
  const s = buildSample(W);
  it("ranks leaders by field-caused fade, worst first, and splits lost margin by cause", () => {
    const leaders = s.people.filter((p) => p.kind === "leader");
    const rows = leaderRows(leaders, s.outcomes, [], 15);
    expect(rows.length).toBe(14);
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].fieldCents <= rows[i].fieldCents).toBe(true);
    const causes = lostByCause(s.outcomes).map(([k]) => k);
    expect(causes).toEqual(expect.arrayContaining(["Field", "Estimate"]));
  });
});
