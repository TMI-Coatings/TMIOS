import { describe, expect, it } from "vitest";
import { describeChange, fieldLabel, valueText } from "../../src/domain/changeText";
import { DEFAULT_CHECKPOINTS, DEFAULT_STAGES, Journey, applies } from "../../src/domain/journey";
import type { ChangeLogEntry } from "../../src/domain/types";
import { dataset, job, person } from "./fixtures";

const entry = (field: string, oldValue: string | null, newValue: string | null, table = "jobs"): ChangeLogEntry => ({
  id: "c1",
  at: "2026-10-27T15:00:00Z",
  who: "Nicole",
  table,
  recordId: "j1",
  recordLabel: "Job 4112",
  field,
  oldValue,
  newValue,
});

describe("change history in plain words", () => {
  const ds = dataset({ people: [person({ id: "p1", name: "Tony Becker" }), person({ id: "p2", name: "Ben Schultz" })], reps: [{ code: "ER", name: "Eric Rich" }], pms: [] });
  it("names people, labels fields and formats dates, from the sample or the database", () => {
    expect(describeChange(entry("leaderId", "p1", "p2"), ds)).toBe("Job leader Tony Becker → Ben Schultz");
    expect(describeChange(entry("leader_id", "p1", "p2"), ds)).toBe("Job leader Tony Becker → Ben Schultz");
    expect(describeChange(entry("projectedFinish", "2026-11-20", "2026-11-27"), ds)).toBe("Projected finish Nov 20 → Nov 27");
    expect(describeChange(entry("firmness", "locked", "flexible"), ds)).toBe("Date firmness Locked → Very flexible");
    expect(describeChange(entry("firmnessReason", null, "Plant asked"), ds)).toBe("Firmness reason blank → Plant asked");
    expect(describeChange(entry("contract_cents", "1000000", "1250000"), ds)).toBe("Contract value $10,000 → $12,500");
    expect(fieldLabel("hours, week ending 2026-11-13")).toBe("hours, week ending Nov 13");
  });
  it("says what was added instead of just 'added'", () => {
    expect(valueText("added", "52 hrs (import)", ds, "actual_hours")).toBe("52 hrs (import)");
    expect(valueText("added", JSON.stringify({ hours: 52, week: "2026-10-30", source: "csv" }), ds, "actual_hours")).toBe("52 hrs, week ending Oct 30 (csv)");
    expect(describeChange(entry("added", null, JSON.stringify({ customer: "Test Co", estimate_hrs: 400 })), ds)).toBe("job added: Test Co, 400 hrs");
  });
});

describe("journey checkpoints added later", () => {
  const facts = { woFinal: () => false, hasActuals: () => false, finalInvoiced: () => false };
  const added = { ...DEFAULT_CHECKPOINTS[0], key: "hotel", label: "Hotel confirmed", offsetDays: -7, appliesFrom: "2026-10-27" };
  it("don't make finished or started jobs overdue", () => {
    const old = job({ id: "old", start: "2026-08-03", projectedFinish: "2026-09-04", status: "complete" });
    const future = job({ id: "new", start: "2026-12-07", projectedFinish: "2026-12-18", status: "scheduled" });
    expect(applies(old, added)).toBe(false);
    expect(applies(future, added)).toBe(true);
    const jy = new Journey(DEFAULT_STAGES, [...DEFAULT_CHECKPOINTS, added], [], facts, "2026-10-27");
    expect(jy.lateList(old).map((c) => c.key)).not.toContain("hotel");
    expect(jy.isDone(future, added)).toBe(false);
  });
});

describe("money fixes", () => {
  it("bid margin uses the job's own labor rate and includes change orders at their cost", async () => {
    const { Money } = await import("../../src/domain/money");
    const { buildIndex } = await import("../../src/domain/schedule");
    const j = job({ burdenedRateCents: 5500, contractCents: 6_000_000, materialCostCents: 1_000_000, estimateHrs: 400 });
    const base = dataset({ jobs: [j] });
    const m0 = new Money(base, buildIndex(base), "2026-10-30", "2026-10-27");
    expect(m0.gpBid(j)).toBeCloseTo(1 - (1_000_000 + 400 * 5500) / 6_000_000, 9);
    const raised = { ...base, settings: { ...base.settings, burdenedRateCents: 9000 } };
    expect(new Money(raised, buildIndex(raised), "2026-10-30", "2026-10-27").gpBid(j)).toBeCloseTo(m0.gpBid(j), 9);
    const co = { id: "c", jobId: j.id, number: "CO-1", description: "", amountCents: 500_000, materialCents: 300_000, materialCostCents: 180_000, hours: 20, approvedOn: "2026-10-20", approvedBy: "Owner" };
    const withCo = { ...base, changeOrders: [co] };
    const m1 = new Money(withCo, buildIndex(withCo), "2026-10-30", "2026-10-27");
    expect(m1.materialCost(j)).toBe(1_180_000);
    expect(m1.gpBid(j)).toBeCloseTo(1 - (1_180_000 + 420 * 5500) / 6_500_000, 9);
  });
  it("retainage outstanding is what was held on each invoice, less what was received", async () => {
    const { Money } = await import("../../src/domain/money");
    const { buildIndex } = await import("../../src/domain/schedule");
    const j = job({ retainagePct: 10, billingMethod: "monthly" });
    const inv = { id: "i", jobId: j.id, kind: "progress" as const, period: "2026-09", milestoneId: null, number: "26-1", amountCents: 1_000_000, retainageCents: 50_000, invoicedOn: "2026-09-25", recordedBy: "x", paidOn: null };
    const ds = dataset({ jobs: [j], invoices: [inv], retainageReceipts: [{ id: "r", jobId: j.id, amountCents: 20_000, receivedOn: "2026-10-01" }] });
    expect(new Money(ds, buildIndex(ds), "2026-10-30", "2026-10-27").retainageOutstanding(j)).toBe(30_000);
  });
});

describe("settings limits", () => {
  it("refuses values that would break capacity or the alerts", async () => {
    const { settingProblem } = await import("../../src/domain/settingsRules");
    const { DEFAULT_SETTINGS } = await import("../../src/domain/types");
    const s = DEFAULT_SETTINGS;
    expect(settingProblem("absencePct", 150, s)).toBe("Use a number from 0 to 50.");
    expect(settingProblem("hoursPerManWeek", 0, s)).toBe("Use a number from 1 to 80.");
    expect(settingProblem("payAppDay", 12.5, s)).toBe("Use a whole number.");
    expect(settingProblem("openWindowStartWeeks", 10, s)).toBe("The open capacity window has to start before it ends.");
    expect(settingProblem("certSecondDays", 90, s)).toMatch(/second certification reminder/);
    expect(settingProblem("absencePct", 12, s)).toBeNull();
  });
});

describe("cash and WIP export", () => {
  it("ages unpaid invoices net of retainage and writes a WIP CSV", async () => {
    const { arAging, wipCsv } = await import("../../src/domain/money");
    const j = job({ retainagePct: 5 });
    const mk = (id: string, on: string, paidOn: string | null) => ({ id, jobId: j.id, kind: "progress" as const, period: on.slice(0, 7), milestoneId: null, number: id, amountCents: 100_000, retainageCents: 5_000, invoicedOn: on, recordedBy: "x", paidOn });
    const ds = dataset({ jobs: [j], invoices: [mk("a", "2026-10-20", null), mk("b", "2026-08-01", null), mk("c", "2026-07-01", "2026-07-30")] });
    const ar = arAging(ds, "2026-10-27");
    expect(ar.total).toBe(190_000);
    expect(ar.buckets.map((b) => b.cents)).toEqual([95_000, 0, 95_000, 0]);
    const csv = wipCsv([{ jobId: "j", number: "4112", customer: 'Acme, "North"', pmCode: "JM", contractCents: 123456, materialsPct: 50, laborPct: 40, recognizedCents: 1000, billedCents: 500, overUnderCents: -500, costToCompleteCents: 200, gpBid: 0.4, gpNow: 0.35, retainageCents: 25 }], () => "Jake Moen");
    expect(csv.split("\r\n")[1]).toBe('4112,"Acme, ""North""",Jake Moen,1234.56,50,40,10.00,5.00,-5.00,2.00,40.0,35.0,0.25');
  });
});

describe("independent review: app-side fixes", () => {
  it("spreadsheet export neutralizes formula-looking text but keeps negative numbers", async () => {
    const { wipCsv } = await import("../../src/domain/money");
    const csv = wipCsv([{ jobId: "j", number: "4112", customer: '=HYPERLINK("http://x","Open")', pmCode: "JM", contractCents: 100, materialsPct: 0, laborPct: 0, recognizedCents: 0, billedCents: 0, overUnderCents: -500, costToCompleteCents: 0, gpBid: 0, gpNow: 0, retainageCents: 0 }], () => "@PM");
    const row = csv.split("\r\n")[1];
    expect(row).toContain(`"'=HYPERLINK(""http://x"",""Open"")"`);
    expect(row).toContain("'@PM");
    expect(row).toContain(",-5.00,");
  });
  it("says 1st, 2nd, 3rd, 11th, 21st, 22nd", async () => {
    const { ordinal } = await import("../../src/format");
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 25].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "25th"]);
  });
  it("the pay-app suggestion never exceeds what's left, and backlog counts change orders", async () => {
    const { Money } = await import("../../src/domain/money");
    const { buildIndex } = await import("../../src/domain/schedule");
    const { backlogCents } = await import("../../src/domain/insights");
    const j = job({ contractCents: 10_005_000, materialRevenueCents: 0, billingMethod: "monthly" });
    const ds = dataset({ jobs: [j], percents: [{ jobId: j.id, week: "2026-10-30", materialsPct: 100, laborPct: 100, enteredBy: "x" }] });
    expect(new Money(ds, buildIndex(ds), "2026-10-30", "2026-10-27").progressSuggest(j)).toBe(10_005_000);
    const co = { id: "c", jobId: j.id, number: "CO", description: "", amountCents: 1_000_000, materialCents: 0, materialCostCents: 0, hours: 0, approvedOn: "2026-10-20", approvedBy: "x" };
    const withCo = { ...ds, changeOrders: [co] };
    expect(backlogCents(withCo, buildIndex(withCo))).toBeGreaterThan(backlogCents(ds, buildIndex(ds)));
  });
});

describe("build mode check", () => {
  it("refuses a production build in demo mode unless it's explicitly allowed", async () => {
    const { spawnSync } = await import("node:child_process");
    const run = (env: Record<string, string>) => spawnSync(process.execPath, ["scripts/check-build-mode.mjs"], { env: { ...process.env, CONTEXT: "", VITE_DATA_MODE: "", ALLOW_DEMO_IN_PRODUCTION: "", ...env } }).status;
    expect(run({ CONTEXT: "production", VITE_DATA_MODE: "sample" })).toBe(1);
    expect(run({ CONTEXT: "production", VITE_DATA_MODE: "sample", ALLOW_DEMO_IN_PRODUCTION: "yes" })).toBe(0);
    expect(run({ CONTEXT: "production" })).toBe(0);
    expect(run({ CONTEXT: "deploy-preview", VITE_DATA_MODE: "sample" })).toBe(0);
  });
  it("checks the default milestones", async () => {
    const { settingProblem } = await import("../../src/domain/settingsRules");
    const { DEFAULT_SETTINGS } = await import("../../src/domain/types");
    expect(settingProblem("milestoneDefaults", [{ label: "A", pct: 80 }, { label: "B", pct: 40 }], DEFAULT_SETTINGS)).toBe("The milestones add up to more than 100%.");
    expect(settingProblem("milestoneDefaults", [{ label: "Deposit", pct: 10 }], DEFAULT_SETTINGS)).toBeNull();
    expect(settingProblem("gapWindowWeeks", 30, DEFAULT_SETTINGS)).toBe("Use a number from 1 to 26.");
  });
});
