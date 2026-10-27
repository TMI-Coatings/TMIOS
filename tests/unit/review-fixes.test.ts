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
