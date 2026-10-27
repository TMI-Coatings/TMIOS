import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import type { Viewer } from "../../src/domain/types";
import { buildSample } from "../../src/sample/seed";
import { asUser, freshDatabase, TEST_WEEK } from "./harness";

const sample = buildSample(TEST_WEEK);
const user = (role: string) => sample.users.find((u) => u.role === role)!;
const as = (v: Viewer, fn: Parameters<typeof asUser>[3]) => asUser(db, v.userId, v.email, fn);

let db: pg.Client;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await freshDatabase());
});
afterAll(async () => close?.());

describe("fixes from the demo review", () => {
  it("a new job leader takes the old one's place on the crew from the planning week on", async () => {
    const j = sample.jobs.find((x) => x.leaderId && sample.assignments.some((a) => a.jobId === x.id && a.personId === x.leaderId && a.week > TEST_WEEK))!;
    const next = sample.people.find((p) => p.kind === "leader" && p.id !== j.leaderId && !sample.assignments.some((a) => a.jobId === j.id && a.personId === p.id))!;
    const weeks = sample.assignments.filter((a) => a.jobId === j.id && a.personId === j.leaderId && a.week >= TEST_WEEK).map((a) => a.week).sort();
    const r = await as(user("admin"), async (q) => {
      await q("update public.jobs set leader_id = $2 where id = $1", [j.id, next.id]);
      return q("select person_id, week::text, active from public.assignments where job_id = $1 and person_id in ($2, $3) and week >= $4 order by week", [j.id, j.leaderId, next.id, TEST_WEEK]);
    });
    expect(r.ok).toBe(true);
    const rows = r.ok ? r.rows : [];
    expect(rows.filter((x) => x.person_id === next.id && x.active).map((x) => x.week)).toEqual(weeks);
    expect(rows.filter((x) => x.person_id === j.leaderId && x.active)).toEqual([]);
  });

  it("the firmness alert uses the same words as the screen", async () => {
    const j = sample.jobs.find((x) => x.firmness === "locked" && x.status === "active")!;
    const r = await as(user("admin"), async (q) => {
      await q("update public.jobs set firmness = 'flexible', firmness_reason = 'Plant asked' where id = $1", [j.id]);
      return q("select body from public.alerts where job_id = $1 and title like 'Firmness changed%'", [j.id]);
    });
    expect(r.ok && r.rows[0].body).toMatch(/^Locked → Very flexible\nReason: Plant asked/);
  });

  it("lists estimators from the Access list for the Add job pick list", async () => {
    const r = await as(user("job_setup"), (q) => q("select public.staff_names() x"));
    expect(r.ok && r.rows[0].x.estimators).toEqual(sample.users.filter((u) => u.role === "estimator").map((u) => u.name).sort());
  });

  it("a checkpoint added now applies only where it is still ahead", async () => {
    const r = await as(user("admin"), async (q) => {
      await q("insert into public.journey_checkpoints (key, stage_key, label, owner, offset_days, anchor, sort) values ('hotel', 'equip', 'Hotel confirmed', 'scheduler', -7, 'start', 99)");
      return q("select applies_from::text a from public.journey_checkpoints where key = 'hotel'");
    });
    expect(r.ok && r.rows[0].a).not.toBeNull();
  });
});
