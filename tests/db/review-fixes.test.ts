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
    expect(r.ok && r.rows[0].x.estimators).toEqual(sample.users.filter((u) => u.role === "estimator" || u.alsoEstimator).map((u) => u.name).sort());
  });

  it("a checkpoint added now applies only where it is still ahead", async () => {
    const r = await as(user("admin"), async (q) => {
      await q("insert into public.journey_checkpoints (key, stage_key, label, owner, offset_days, anchor, sort) values ('hotel', 'equip', 'Hotel confirmed', 'scheduler', -7, 'start', 99)");
      return q("select applies_from::text a from public.journey_checkpoints where key = 'hotel'");
    });
    expect(r.ok && r.rows[0].a).not.toBeNull();
  });
});

describe("controls from the demo review", () => {
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
  it("the database holds the same setting limits as the screens", async () => {
    const { SETTING_LIMITS } = await import("../../src/domain/settingsRules");
    const { rows } = await db.query("select key, min::float8 min, max::float8 max, whole from app.setting_limits()");
    const sql = Object.fromEntries(rows.map((r) => [r.key, { min: r.min, max: r.max, whole: r.whole }]));
    const ts = Object.fromEntries(Object.entries(SETTING_LIMITS).map(([k, l]) => [k, { min: l.min, max: l.max, whole: !!l.whole }]));
    expect(sql).toEqual(ts);
  });
  it("refuses settings outside their range or out of order", async () => {
    const r = await as(user("admin"), async (q) => ({
      rows: {
        absence: await attempt(q, "update public.settings set value = '150' where key = 'absencePct'"),
        window: await attempt(q, "update public.settings set value = '10' where key = 'openWindowStartWeeks'"),
        ok: await attempt(q, "update public.settings set value = '12' where key = 'absencePct'"),
      },
    }) as never);
    expect(r.ok && r.rows).toEqual({ absence: "Use a number from 0 to 50", window: "The open capacity window has to start before it ends", ok: "ok" });
  });
  it("nobody changes their own access, and someone keeps full rights", async () => {
    const admin = user("admin");
    const r = await as(admin, async (q) => ({
      rows: {
        self: await attempt(q, "update public.app_users set role = 'estimator' where id = $1", [admin.userId]),
        other: await attempt(q, "update public.app_users set active = false where id = $1", [user("estimator").userId]),
      },
    }) as never);
    expect(r.ok && r.rows).toEqual({ self: "You can't change your own access. Ask another admin", other: "ok" });
    const full = sample.users.filter((u) => ["admin", "ceo", "cfo"].includes(u.role));
    const last = await as(admin, async (q) => {
      await q("reset role");
      await q("select set_config('request.jwt.claims', '{}', true)");
      for (const u of full.slice(0, -1)) await q("update public.app_users set active = false where id = $1", [u.userId]);
      return { rows: { last: await attempt(q, "update public.app_users set active = false where id = $1", [full[full.length - 1].userId]) } } as never;
    });
    expect(last.ok && last.rows).toEqual({ last: "Someone has to keep full rights" });
  });
});

describe("wording from the demo review", () => {
  it("late work order alerts name the step's role", async () => {
    const { rows } = await db.query("select body from public.alerts where title like 'Work order review late%'");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.body).toMatch(/^Waiting \d+ days on (Estimator|Rep|PM|Scheduler) \S|^Waiting \d+ days on Lori /);
  });
});

describe("permission changes (Oct 27)", () => {
  it("leaders, crew and estimators can't read the dollar columns on jobs; money roles get them through job_money", async () => {
    for (const role of ["superintendent", "estimator"]) {
      const r = await as(user(role), (q) => q("select contract_cents from public.jobs limit 1"));
      expect(r.ok, role).toBe(false);
      const m = await as(user(role), (q) => q("select count(*)::int n from public.job_money()"));
      expect(m.ok && m.rows[0].n, role).toBe(0);
    }
    const pm = await as(user("pm"), (q) => q("select count(*)::int n from public.job_money()"));
    expect(pm.ok && pm.rows[0].n).toBe(sample.jobs.length);
  });
  it("the scheduler sets job leader, crew size and projected hours", async () => {
    const j = sample.jobs.find((x) => x.status === "scheduled")!;
    const r = await as(user("scheduler"), (q) => q("update public.jobs set crew_size = crew_size + 1, projected_hrs = projected_hrs + 10 where id = $1 returning id", [j.id]));
    expect(r.ok ? "" : r.error).toBe("");
  });
  it("the job's named estimator signs the estimator step whatever their role", async () => {
    const scott = sample.users.find((u) => u.name === "Scott Salmon")!;
    const w = sample.workOrders.find((x) => x && !x.final && x.currentStep === 0 && x.fileName)!;
    const r = await as(scott, async (q) => {
      await q("reset role");
      await q("select set_config('request.jwt.claims', '{}', true)");
      await q("update public.jobs set estimator = 'Scott Salmon' where id = $1", [w.jobId]);
      await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: scott.userId, email: scott.email, role: "authenticated" })]);
      await q("set local role authenticated");
      await q("select public.wo_approve($1)", [w.jobId]);
      return q("select current_step from public.work_orders where job_id = $1", [w.jobId]);
    });
    expect(r.ok ? "" : r.error).toBe("");
    expect(r.ok && r.rows[0].current_step).toBe(1);
    const staff = await as(user("job_setup"), (q) => q("select public.staff_names() x"));
    expect(staff.ok && staff.rows[0].x.estimators).toContain("Scott Salmon");
  });
  it("leaders see job changes in the log but not dollar figures", async () => {
    const supt = user("superintendent");
    const r = await as(supt, (q) => q("select count(*)::int n from public.change_log where field in ('contract_cents', 'material_cost_cents') or table_name in ('invoices', 'change_orders')"));
    expect(r.ok && r.rows[0].n).toBe(0);
  });
});
