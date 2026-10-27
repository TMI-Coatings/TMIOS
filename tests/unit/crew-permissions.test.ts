import { describe, expect, it } from "vitest";
import { crewIssues } from "../../src/domain/crew";
import { canEditJob, canSeeJob, seesCompanyTotals, tabsFor } from "../../src/domain/permissions";
import { buildIndex } from "../../src/domain/schedule";
import { ROLES, type Role, type Viewer } from "../../src/domain/types";
import { buildSample } from "../../src/sample/seed";
import { isFriday } from "../../src/domain/weeks";
import { W, dataset, job, person } from "./fixtures";

const viewer = (role: Role, extra: Partial<Viewer> = {}): Viewer => ({
  userId: "u",
  name: "x",
  email: "x@example.com",
  role,
  personId: null,
  repCode: null,
  pmCode: null,
  ...extra,
});

describe("crew checks", () => {
  it("finds double-booking, time off, missing quals, lapsed DOT and short crews", () => {
    const ds = dataset({
      jobs: [job({ id: "a", crewSize: 2, requirements: ["Lift"] }), job({ id: "b", crewSize: 1 })],
      people: [person({ id: "p1", quals: { Lift: null } }), person({ id: "p2", driver: true, dotExpires: "2026-10-01" })],
      timeOff: [{ id: "t", personId: "p1", firstDay: "2026-10-28", lastDay: "2026-10-28", type: "PTO", active: true }],
      assignments: [
        { id: "1", jobId: "a", personId: "p1", week: W },
        { id: "2", jobId: "a", personId: "p2", week: W },
        { id: "3", jobId: "b", personId: "p1", week: W },
      ],
    });
    const kinds = crewIssues(ds, buildIndex(ds), [W]).map((i) => i.kind + ":" + i.job.id + ":" + (i.person?.id ?? ""));
    expect(kinds).toEqual(expect.arrayContaining(["off:a:p1", "qual:a:p2", "dot:a:p2", "double:b:p1", "off:b:p1"]));
    expect(kinds).not.toContain("short:a:");
  });
  it("treats an expired qualification as missing", () => {
    const ds = dataset({
      jobs: [job({ crewSize: 1, requirements: ["Lift"] })],
      people: [person({ quals: { Lift: "2026-10-01" } })],
      assignments: [{ id: "1", jobId: "j1", personId: "p1", week: W }],
    });
    expect(crewIssues(ds, buildIndex(ds), [W]).map((i) => i.kind)).toEqual(["qual"]);
  });
});

describe("permissions", () => {
  const j = job({ leaderId: "p9", repCode: "ER", pmCode: "JM" });
  it("shows reps and PMs every job (decision 6a) and limits leaders to their own", () => {
    expect(canSeeJob(viewer("sales_rep", { repCode: "ER" }), j)).toBe(true);
    expect(canSeeJob(viewer("sales_rep", { repCode: "KK" }), j)).toBe(true);
    expect(canSeeJob(viewer("pm", { pmCode: "SS" }), j)).toBe(true);
    expect(canSeeJob(viewer("superintendent", { personId: "p1" }), j)).toBe(false);
    expect(canSeeJob(viewer("superintendent", { personId: "p9" }), j)).toBe(true);
    expect(canSeeJob(viewer("field_crew"), j)).toBe(false);
    expect(canSeeJob(viewer("cfo"), j)).toBe(true);
  });
  it("lets the scheduler and the job's own PM move dates and plan cells (decision 8)", () => {
    expect(canEditJob(viewer("scheduler"), j, "start")).toBe(true);
    expect(canEditJob(viewer("scheduler"), j, "plan")).toBe(true);
    expect(canEditJob(viewer("pm", { pmCode: "JM" }), j, "plan")).toBe(true);
    expect(canEditJob(viewer("pm", { pmCode: "SS" }), j, "plan")).toBe(false);
    expect(canEditJob(viewer("sales_rep", { repCode: "ER" }), j, "start")).toBe(false);
  });
  it("gives the CEO full admin edit rights (decision 7)", () => {
    for (const f of ["plan", "leaderId", "projectedHrs", "intake", "crew", "pinNotes"] as const) expect(canEditJob(viewer("ceo"), j, f)).toBe(true);
  });
  it("shows company totals to reps and PMs but not to leaders", () => {
    expect(seesCompanyTotals("sales_rep")).toBe(true);
    expect(seesCompanyTotals("pm")).toBe(true);
    expect(seesCompanyTotals("superintendent")).toBe(false);
    expect(seesCompanyTotals("field_crew")).toBe(false);
  });
  it("has no board role; the board view (for the PDF pack) is admin, CEO and CFO only (decision 12)", () => {
    expect(ROLES as readonly string[]).not.toContain("board");
    for (const r of ROLES) expect(tabsFor(r).some((t) => t.id === "board"), r).toBe(["admin", "ceo", "cfo"].includes(r));
  });
});

describe("sample data", () => {
  const s = buildSample(W);
  it("matches the demo's shape", () => {
    expect(s.jobs.filter((j) => j.status !== "complete")).toHaveLength(20);
    expect(s.jobs.filter((j) => j.status === "complete")).toHaveLength(5);
    expect(s.people).toHaveLength(75);
    expect(s.people.filter((p) => p.kind === "leader")).toHaveLength(14);
  });
  it("follows the hard rules: four-digit job numbers, Friday weeks, whole cents", () => {
    expect(s.jobs.every((j) => /^\d{4}$/.test(j.number))).toBe(true);
    expect(s.actuals.every((a) => isFriday(a.week))).toBe(true);
    expect(s.assignments.every((a) => isFriday(a.week))).toBe(true);
    expect(s.jobs.every((j) => Number.isInteger(j.contractCents) && Number.isInteger(j.materialRevenueCents))).toBe(true);
  });
  it("is identical every time for the same week", () => {
    expect(JSON.stringify(buildSample(W))).toBe(JSON.stringify(s));
  });
});
