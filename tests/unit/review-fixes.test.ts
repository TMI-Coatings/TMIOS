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
    const inv = { id: "i", jobId: j.id, kind: "progress" as const, period: "2026-09", milestoneId: null, number: "26-1", amountCents: 1_000_000, retainageCents: 50_000, invoicedOn: "2026-09-25", recordedBy: "x" };
    const ds = dataset({ jobs: [j], invoices: [inv], retainageReceipts: [{ id: "r", jobId: j.id, amountCents: 20_000, receivedOn: "2026-10-01" }] });
    expect(new Money(ds, buildIndex(ds), "2026-10-30", "2026-10-27").retainageOutstanding(j)).toBe(30_000);
  });
});
