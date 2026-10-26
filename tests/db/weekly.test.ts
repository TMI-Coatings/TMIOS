import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { canSeeAlert } from "../../src/domain/alerts";
import { forecastAccuracy } from "../../src/domain/close";
import { allPlans, buildIndex, weekTotals } from "../../src/domain/schedule";
import type { Alert, Viewer } from "../../src/domain/types";
import { addDays, weekList } from "../../src/domain/weeks";
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

describe("the database plans exactly as the screens do", () => {
  it("same hours for every job and week, 40 weeks out", async () => {
    const idx = buildIndex(sample);
    const ts = allPlans(sample, idx, TEST_WEEK);
    const { rows } = await db.query("select job_id, week::text, hours from app.plan_all($1)", [TEST_WEEK]);
    const sql = new Map<string, number>(rows.map((r) => [r.job_id + "|" + r.week, r.hours]));
    const flat = new Map<string, number>();
    for (const [jobId, m] of ts) for (const [w, h] of m) flat.set(jobId + "|" + w, h);
    expect(sql).toEqual(flat);
  });
  it("same totals rows: sold, on hold, available, leaders", async () => {
    const idx = buildIndex(sample);
    const ts = weekTotals(sample, idx, allPlans(sample, idx, TEST_WEEK), weekList(TEST_WEEK, 13));
    const { rows } = await db.query("select week::text, sold, on_hold, available, leaders_needed, leaders_available from app.week_totals($1, 13)", [TEST_WEEK]);
    rows.forEach((r, i) => {
      expect(r.week).toBe(ts[i].week);
      expect(Number(r.sold)).toBe(ts[i].sold);
      expect(Number(r.on_hold)).toBe(ts[i].onHold);
      expect(Number(r.available)).toBeCloseTo(ts[i].available, 6);
      expect(Number(r.leaders_needed)).toBeCloseTo(ts[i].leadersNeeded, 6);
      expect(Number(r.leaders_available)).toBeCloseTo(ts[i].leadersAvailable, 6);
    });
  });
  it("still matches after a week is set by hand", async () => {
    const j = sample.jobs[1];
    await db.query("begin");
    try {
      await db.query("insert into public.plan_overrides (job_id, week, hours) values ($1, $2, 400)", [j.id, addDays(TEST_WEEK, 7)]);
      const { rows } = await db.query("select week::text, hours from app.job_plan((select j from public.jobs j where id = $1), $2)", [j.id, TEST_WEEK]);
      const ds = { ...sample, overrides: [{ jobId: j.id, week: addDays(TEST_WEEK, 7), hours: 400 }] };
      const ts = allPlans(ds, buildIndex(ds), TEST_WEEK).get(j.id)!;
      expect(rows.map((r) => [r.week, r.hours])).toEqual([...ts.entries()].sort((a, b) => a[0].localeCompare(b[0])));
    } finally {
      await db.query("rollback");
    }
  });
});

describe("the weekly close", () => {
  const entries = sample.jobs
    .filter((j) => j.status !== "complete" && j.start <= TEST_WEEK)
    .slice(1)
    .map((j, i) => ({ jobId: j.id, hours: i === 0 ? 400 : 100, source: "csv" }));
  const finished = [sample.jobs.find((j) => j.status === "active")!.id];

  it("only the scheduler or an admin closes", async () => {
    const r = await as(user("pm"), (q) => q("select public.close_week($1)", [{ week: TEST_WEEK, entries: [], finished: [] }]));
    expect(r.ok).toBe(false);
  });

  it("refuses the wrong week", async () => {
    const r = await as(user("scheduler"), (q) => q("select public.close_week($1)", [{ week: addDays(TEST_WEEK, 7), entries: [], finished: [] }]));
    expect(r.ok).toBe(false);
  });

  it("archives hours, completes jobs, records metrics, snapshots the forecast and rolls forward", async () => {
    const r = await as(user("scheduler"), async (q) => {
      const res = (await q("select public.close_week($1) x", [{ week: TEST_WEEK, entries, finished }])).rows[0].x;
      const weeks = (await q("select public.schedule_weeks() x")).rows[0].x;
      const actuals = (await q("select count(*)::int n from public.actual_hours where week = $1", [TEST_WEEK])).rows[0].n;
      const done = (await q("select status from public.jobs where id = $1", [finished[0]])).rows[0].status;
      const m = (await q("select * from public.weekly_metrics where week = $1", [TEST_WEEK])).rows[0];
      const snaps = (await q("select target_week::text t, count(*)::int n from public.forecast_snapshots where made_week = $1 group by 1 order by 1", [addDays(TEST_WEEK, 7)])).rows;
      const overrun = (await q("select title from public.alerts where rule = 'overrun'")).rows.map((x: any) => x.title);
      const log = (await q("select count(*)::int n from public.change_log where table_name = 'actual_hours' and user_name = 'Nicole'")).rows[0].n;
      return { rows: [{ res, weeks, actuals, done, m, snaps, overrun, log }] } as any;
    });
    expect(r.ok ? "" : r.error).toBe("");
    const x = r.ok && r.rows[0];
    expect(x.res).toMatchObject({ week: TEST_WEEK, entered: entries.length, missing: 1, nextWeek: addDays(TEST_WEEK, 7) });
    expect(x.weeks).toMatchObject({ planningWeek: addDays(TEST_WEEK, 7), weekToClose: null, lastClosed: TEST_WEEK });
    expect(x.actuals).toBe(entries.length);
    expect(x.done).toBe("complete");
    expect(x.snaps.map((s: any) => s.t)).toEqual([addDays(TEST_WEEK, 7), addDays(TEST_WEEK, 35)]);
    expect(x.log).toBe(entries.length);
    const total = entries.reduce((a, e) => a + e.hours, 0);
    const missing = sample.jobs.filter((j) => j.start <= TEST_WEEK && j.status !== "complete" && !entries.some((e) => e.jobId === j.id)).map((j) => j.id);
    const acc = forecastAccuracy(sample.snapshots.filter((s) => s.targetWeek === TEST_WEEK), total, missing);
    expect(Number(x.m.accuracy)).toBeCloseTo(acc!, 3);
    expect(Number(x.m.utilization)).toBeCloseTo(total / (50 * 40), 4);
    expect(x.overrun.length).toBeGreaterThan(0);
  });
});

describe("alerts", () => {
  it("a date move alerts the job's PM and leader, not other PMs or accounting", async () => {
    const j = sample.jobs.find((x) => x.pmCode === "JS" && x.status === "scheduled")!;
    const r = await as(user("admin"), async (q) => {
      await q("update public.jobs set start = start + 7, projected_finish = projected_finish + 7 where id = $1", [j.id]);
      return q("select id from public.alerts where rule = 'date' and job_id = $1", [j.id]);
    });
    expect(r.ok && r.rows.length).toBe(1);
  });
  it("who sees which alert matches the screens' routing for every role", async () => {
    await db.query("begin");
    try {
      const j = sample.jobs.find((x) => x.status === "scheduled")!;
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user("admin").userId })]);
      await db.query("update public.jobs set crew_size = crew_size + 1 where id = $1", [j.id]);
      await db.query("select public.post_digest('Digest', 'Body')");
      const all = (await db.query("select id, rule, job_id, recipients from public.alerts")).rows;
      expect(all.map((a) => a.rule)).toEqual(expect.arrayContaining(["open", "cert", "crew", "digest"]));
      for (const v of sample.users) {
        await db.query("set local role authenticated");
        await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: v.userId })]);
        const seen = new Set((await db.query("select id from public.alerts")).rows.map((r) => r.id));
        await db.query("reset role");
        for (const a of all) {
          const alert = { rule: a.rule, jobId: a.job_id, recipients: a.recipients } as Pick<Alert, "rule" | "jobId" | "recipients">;
          expect(seen.has(a.id), `${v.role} ${a.rule}`).toBe(canSeeAlert(v, alert, sample, TEST_WEEK));
        }
      }
    } finally {
      await db.query("rollback");
    }
  });
  it("certification reminders fire once per step", async () => {
    const r = await as(user("admin"), async (q) => q("select app.cert_reminders() n"));
    // Already sent when the sample loaded; running again sends nothing new.
    expect(r.ok).toBe(false); // internal function: not callable from the app
    const again = await db.query("select app.cert_reminders() n");
    expect(again.rows[0].n).toBe(0);
  });
});

describe("leaders and crews", () => {
  it("a leader confirms the crews on their own jobs; a rep can't", async () => {
    const supt = user("superintendent");
    const r = await as(supt, async (q) => {
      const n = (await q("select public.confirm_my_crews() n")).rows[0].n;
      const rows = (await q("select job_id from public.crew_confirmations where week = $1", [TEST_WEEK])).rows;
      return { rows: [{ n, rows }] } as any;
    });
    const mine = sample.jobs.filter((j) => j.leaderId === supt.personId && j.status !== "on_hold" && j.start <= TEST_WEEK && j.projectedFinish >= addDays(TEST_WEEK, -4));
    expect(r.ok && r.rows[0].n).toBe(mine.length);
    const rep = await as(user("sales_rep"), (q) => q("select public.confirm_my_crews()"));
    expect(rep.ok).toBe(false);
  });
  it("My week shows a leader only the jobs they're on, with crewmates and the site details", async () => {
    const supt = user("superintendent");
    const r = await as(supt, (q) => q("select public.my_week() x"));
    const x = r.ok && r.rows[0].x;
    const wk = sample.assignments.filter((a) => a.personId === supt.personId && a.week === TEST_WEEK);
    expect(x.person.name).toBe("Mike Ramirez");
    expect(x.weeks.map((w: any) => w.week)).toEqual([TEST_WEEK, addDays(TEST_WEEK, 7)]);
    expect(x.weeks[0].jobs.length).toBe(wk.length);
    expect(x.weeks[0].jobs[0]).toHaveProperty("siteAddress");
  });
  it("field crew see My week but not the jobs table", async () => {
    const person = sample.people.find((p) => p.kind === "field" && sample.assignments.some((a) => a.personId === p.id && a.week === TEST_WEEK))!;
    await db.query("insert into auth.users (id, email) values ('00000000-0000-4000-8fff-0000000000c1', 'crew1@example.com')");
    await db.query("insert into public.app_users (id, auth_user_id, email, name, role, person_id) values ('00000000-0000-4000-8fff-0000000000c1', '00000000-0000-4000-8fff-0000000000c1', 'crew1@example.com', $1, 'field_crew', $2)", [person.name, person.id]);
    const v: Viewer = { userId: "00000000-0000-4000-8fff-0000000000c1", email: "crew1@example.com", name: person.name, role: "field_crew", personId: person.id, repCode: null, pmCode: null };
    const r = await as(v, async (q) => {
      const mw = (await q("select public.my_week() x")).rows[0].x;
      const jobs = (await q("select count(*)::int n from public.jobs")).rows[0].n;
      await q("select public.acknowledge_week($1)", [TEST_WEEK]);
      const ack = (await q("select public.my_week() x")).rows[0].x.weeks[0].acknowledged;
      return { rows: [{ mw, jobs, ack }] } as any;
    });
    const x = r.ok && r.rows[0];
    expect(x.jobs).toBe(0);
    expect(x.mw.weeks[0].jobs.length).toBeGreaterThan(0);
    expect(x.mw.weeks[0].jobs[0].crew).toContain(person.name.split(" ")[0]);
    expect(x.ack).toBeTruthy();
  });
});
