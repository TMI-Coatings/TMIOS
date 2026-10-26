import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import type { Viewer } from "../../src/domain/types";
import { buildSample } from "../../src/sample/seed";
import { asUser, freshDatabase, TEST_TODAY, TEST_WEEK } from "./harness";

const sample = buildSample(TEST_WEEK, TEST_TODAY);
const user = (role: string) => sample.users.find((u) => u.role === role)!;
const as = (v: Viewer, fn: Parameters<typeof asUser>[3]) => asUser(db, v.userId, v.email, fn);

let db: pg.Client;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await freshDatabase());
});
afterAll(async () => close?.());

describe("leader scorecard", () => {
  it("office roles see every leader; a leader sees only their own line; a PM only their jobs", async () => {
    const all = (await db.query("select count(*)::int n from public.closeout_outcomes")).rows[0].n;
    expect(all).toBe(sample.outcomes.length);
    const sched = await as(user("scheduler"), (q) => q("select count(*)::int n from public.closeout_outcomes"));
    expect(sched.ok && sched.rows[0].n).toBe(all);
    const supt = user("superintendent");
    const r = await as(supt, (q) => q("select distinct leader_id from public.closeout_outcomes"));
    expect(r.ok && r.rows.map((x) => x.leader_id)).toEqual([supt.personId]);
    const pm = await as(user("pm"), (q) => q("select distinct pm_code from public.closeout_outcomes"));
    expect(pm.ok && pm.rows.map((x) => x.pm_code)).toEqual(["JM"]);
    const rep = await as(user("sales_rep"), (q) => q("select count(*)::int n from public.closeout_outcomes"));
    expect(rep.ok && rep.rows[0].n).toBe(0);
  });

  it("completing a job records its outcome against the bid", async () => {
    const j = sample.jobs.find((x) => x.status === "active")!;
    const r = await as(user("scheduler"), async (q) => {
      await q("update public.jobs set status = 'complete', actual_finish = $2 where id = $1", [j.id, TEST_WEEK]);
      return q("select estimate_hrs::int, actual_hrs::int, on_time, illustrative from public.closeout_outcomes where job_id = $1", [j.id]);
    });
    const act = sample.actuals.filter((a) => a.jobId === j.id).reduce((a, x) => a + x.hours, 0);
    expect(r.ok && r.rows[0]).toEqual({ estimate_hrs: j.estimateHrs, actual_hrs: Math.round(act), on_time: TEST_WEEK <= (j.mustFinish ?? j.baselineFinish), illustrative: false });
  });

  it("the PM tags the cause on their own jobs, which ticks the journey checkpoint; another PM can't", async () => {
    const own = sample.outcomes.find((o) => o.jobId && o.pmCode === "JM")!;
    const r = await as(user("pm"), async (q) => {
      await q("select public.tag_closeout_cause($1, 'Estimate')", [own.id]);
      return q("select (select cause from public.closeout_outcomes where id = $1) c, (select count(*)::int from public.job_checkpoints where job_id = $2 and checkpoint_key = 'cause' and active) k", [own.id, own.jobId]);
    });
    expect(r.ok && r.rows[0]).toEqual({ c: "Estimate", k: 1 });
    const other = sample.outcomes.find((o) => o.pmCode !== "JM")!;
    const denied = await as(user("pm"), (q) => q("select public.tag_closeout_cause($1, 'Field')", [other.id]));
    expect(denied.ok).toBe(false);
    const bad = await as(user("admin"), (q) => q("select public.tag_closeout_cause($1, 'Bad luck')", [own.id]));
    expect(bad.ok).toBe(false);
  });
});

describe("board pack", () => {
  it("counts for the communication record go to admin, CEO and CFO only", async () => {
    const r = await as(user("cfo"), (q) => q("select public.board_counts() x"));
    expect(r.ok && Object.keys(r.rows[0].x).sort()).toEqual(["acknowledgments", "alerts", "changes", "closes", "digests"]);
    const s = await as(user("scheduler"), (q) => q("select public.board_counts()"));
    expect(s.ok).toBe(false);
  });
});
