import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { DEFAULT_CHECKPOINTS, DEFAULT_STAGES, canCheck } from "../../src/domain/journey";
import { canSeeJob } from "../../src/domain/permissions";
import type { Viewer } from "../../src/domain/types";
import { journeyOf } from "../../src/domain/views";
import { buildSample } from "../../src/sample/seed";
import { asUser, freshDatabase, TEST_TODAY, TEST_WEEK } from "./harness";

const sample = buildSample(TEST_WEEK, TEST_TODAY);
const user = (role: string) => sample.users.find((u) => u.role === role)!;
const as = (v: Viewer, fn: Parameters<typeof asUser>[3]) => asUser(db, v.userId, v.email, fn);

/** Run a statement that may be refused without aborting the test's transaction. */
const attempt = async (q: (s: string, p?: unknown[]) => Promise<pg.QueryResult>, sql: string, params: unknown[] = []) => {
  await q("savepoint t");
  try {
    await q(sql, params);
    await q("release savepoint t");
    return "ok";
  } catch (e: any) {
    await q("rollback to savepoint t");
    return e.message as string;
  }
};

let db: pg.Client;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await freshDatabase());
});
afterAll(async () => close?.());

const owatonna = sample.jobs[11]; // waiting on the rep, Eric Rich
const wo = (q: (s: string, p?: unknown[]) => Promise<pg.QueryResult>, id: string) =>
  q("select current_step, final, filed, file_name, returned_comment, version from public.work_orders where job_id = $1", [id]).then((r) => r.rows[0]);

describe("work orders", () => {
  it("the sample states load as the demo seeds them", async () => {
    const { rows } = await db.query("select job_id, app.wo_status(w) s from public.work_orders w");
    const by = new Map(rows.map((r) => [r.job_id, r.s]));
    expect(by.get(sample.jobs[14].id)).toBe("Returned");
    expect(by.get(sample.jobs[17].id)).toBe("Awaiting draft");
    expect(by.get(owatonna.id)).toBe("In review");
  });

  it("only the person at the step signs it off; admin can act for them", async () => {
    const pm = await as(user("pm"), (q) => q("select public.wo_approve($1)", [owatonna.id]));
    expect(pm.ok).toBe(false);
    const est = await as(user("estimator"), (q) => q("select public.wo_approve($1)", [owatonna.id]));
    expect(est.ok).toBe(false);
    const rep = await as(user("sales_rep"), async (q) => {
      await q("select public.wo_approve($1)", [owatonna.id]);
      return { rows: [await wo(q, owatonna.id)] } as any;
    });
    expect(rep.ok && rep.rows[0].current_step).toBe(2);
    const admin = await as(user("admin"), async (q) => {
      await q("select public.wo_approve($1)", [owatonna.id]);
      return q("select action from public.work_order_events where job_id = $1 order by at desc limit 1", [owatonna.id]);
    });
    expect(admin.ok && admin.rows[0].action).toMatch(/^Sales rep sign-off: contract terms approved, for Eric Rich\.$/);
  });

  it("the full chain: upload, four sign-offs in order, final, filed; each step alerts the next person", async () => {
    const j = sample.jobs[17]; // awaiting a draft
    const r = await asUser(db, user("job_setup").userId, user("job_setup").email, async (q) => {
      const step = async (role: string) => {
        await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user(role).userId })]);
      };
      await q("select public.wo_upload($1, 'WO-draft.pdf')", [j.id]);
      // Step 0 waits on the job's estimator by name; admin acts for them.
      await step("admin");
      await q("select public.wo_approve($1)", [j.id]);
      await step("sales_rep");
      const repTry = await attempt(q, "select public.wo_approve($1)", [j.id]);
      await step("admin");
      if (repTry !== "ok") await q("select public.wo_approve($1)", [j.id]);
      await q("select public.wo_approve($1)", [j.id]);
      await step("scheduler");
      await q("select public.wo_approve($1)", [j.id]);
      const after = await wo(q, j.id);
      await step("job_setup");
      await q("select public.wo_mark_filed($1)", [j.id]);
      const filed = await wo(q, j.id);
      await step("admin");
      const titles = (await q("select title from public.alerts where job_id = $1 and rule = 'wo' order by at", [j.id])).rows.map((x: any) => x.title);
      return { rows: [{ after, filed, titles }] } as any;
    });
    expect(r.ok ? "" : r.error).toBe("");
    const x = r.ok && r.rows[0];
    expect(x.after).toMatchObject({ current_step: 4, final: true, filed: false, version: 1 });
    expect(x.filed.filed).toBe(true);
    expect(x.titles.some((t: string) => /^Draft work order ready for review/.test(t))).toBe(true);
    expect(x.titles).toContain(`Work order final: ${j.number} ${j.customer}`);
  });

  it("sending back needs a comment, restarts at the estimator, and goes to Lori", async () => {
    const r = await as(user("admin"), async (q) => {
      const none = await attempt(q, "select public.wo_return($1, '  ')", [owatonna.id]);
      return { rows: [{ none }] } as any;
    });
    expect(r.ok && r.rows[0].none).toMatch(/comment/);
    const ok = await as(user("sales_rep"), async (q) => {
      await q("select public.wo_return($1, 'Retainage terms are wrong')", [owatonna.id]);
      const w = await wo(q, owatonna.id);
      const a = (await q("select recipients from public.alerts where title like 'Work order sent back%'")).rows[0];
      return { rows: [{ w, a }] } as any;
    });
    expect(ok.ok && ok.rows[0].w).toMatchObject({ current_step: 0, returned_comment: "Retainage terms are wrong" });
    expect(ok.ok && ok.rows[0].a.recipients).toContain("Lori");
  });

  it("a new job opens its work order and tells job setup", async () => {
    const r = await as(user("scheduler"), async (q) => {
      const id = (
        await q("select public.create_job($1) id", [
          { number: "4300", customer: "Test Malt", repCode: "ER", pmCode: "JM", estimator: "Juac Angoi", estimateHrs: 100, contractCents: 1_000_000, start: "2026-12-07", projectedFinish: "2026-12-11", firmness: "confirmed" },
        ])
      ).rows[0].id;
      const w = await wo(q, id);
      const a = (await q("select title, recipients from public.alerts where job_id = $1", [id])).rows;
      return { rows: [{ w, a }] } as any;
    });
    expect(r.ok && r.rows[0].w).toMatchObject({ current_step: 0, final: false, file_name: null });
    expect(r.ok && r.rows[0].a).toEqual([{ title: "New job booked, draft the work order: 4300 Test Malt", recipients: ["Lori"] }]);
  });

  it("a step past its deadline pings the PM once", async () => {
    await db.query("begin");
    try {
      await db.query("select app.wo_check()");
      await db.query("select app.wo_check()");
      const { rows } = await db.query("select count(*)::int n from public.alerts where title = $1", [`Work order review late: ${sample.jobs[13].number} ${sample.jobs[13].customer}`]);
      expect(rows[0].n).toBe(1);
    } finally {
      await db.query("rollback");
    }
  });
});

describe("job journey", () => {
  it("the database starts with the same journey the screens use", async () => {
    const st = (await db.query("select key, label, sort, startup, active from public.journey_stages order by sort")).rows;
    expect(st).toEqual(DEFAULT_STAGES);
    const cp = (await db.query("select key, stage_key, label, owner, offset_days, anchor, auto_source, sort, active from public.journey_checkpoints order by sort")).rows;
    expect(cp.map((r) => ({ key: r.key, stageKey: r.stage_key, label: r.label, owner: r.owner, offsetDays: r.offset_days, anchor: r.anchor, autoSource: r.auto_source, sort: r.sort, active: r.active }))).toEqual(DEFAULT_CHECKPOINTS);
  });

  it("automatic checkpoints read the same state in the database as on screen", async () => {
    const jy = journeyOf(sample, TEST_TODAY);
    const autos = DEFAULT_CHECKPOINTS.filter((c) => c.autoSource && c.autoSource !== "final_invoice");
    for (const j of sample.jobs)
      for (const c of autos) {
        const { rows } = await db.query("select app.checkpoint_auto_done($1, $2) d", [j.id, c.autoSource]);
        expect(rows[0].d, `${j.number} ${c.key}`).toBe(jy.isDone(j, c));
      }
  });

  it("who can tick which checkpoint matches the screens, for every role", async () => {
    const jobs = [sample.jobs[0], sample.jobs[5], sample.jobs[11]];
    for (const v of sample.users)
      for (const j of jobs)
        for (const c of DEFAULT_CHECKPOINTS) {
          const r = await as(v, (q) => q("select app.can_check($1, $2) ok", [j.id, c.key]));
          expect(r.ok && r.rows[0].ok, `${v.role} ${c.key} on ${j.number}`).toBe(canCheck(v, c, canSeeJob(v, j) ? j : null));
        }
  });

  it("a PM ticks their own checkpoint; it is logged; automatic ones can't be ticked", async () => {
    const pm = user("pm");
    const j = sample.jobs.find((x) => x.pmCode === pm.pmCode && !sample.jobCheckpoints.some((c) => c.jobId === x.id && c.key === "walk"))!;
    const r = await as(pm, async (q) => {
      await q("select public.set_checkpoint($1, 'walk', true)", [j.id]);
      const auto = (await attempt(q, "select public.set_checkpoint($1, 'mob', true)", [j.id])) === "ok" ? "ok" : "refused";
      const log = (await q("select record_label from public.change_log where table_name = 'job_checkpoints' and user_name = $1", [pm.name])).rows[0];
      return { rows: [{ auto, log }] } as any;
    });
    expect(r.ok && r.rows[0].auto).toBe("refused");
    expect(r.ok && r.rows[0].log.record_label).toContain("Final walk and customer sign-off");
  });

  it("only admin, CEO and CFO change the journey's definitions", async () => {
    const s = await as(user("scheduler"), (q) => q("update public.journey_checkpoints set offset_days = -10 where key = 'rent'"));
    expect(s.ok && s.rowCount).toBe(0);
    const c = await as(user("cfo"), (q) => q("update public.journey_checkpoints set offset_days = -10 where key = 'rent'"));
    expect(c.ok && c.rowCount).toBe(1);
  });
});
