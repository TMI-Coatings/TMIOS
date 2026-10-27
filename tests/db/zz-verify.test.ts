import { afterAll, beforeAll, it } from "vitest";
import type pg from "pg";
import { buildSample } from "../../src/sample/seed";
import { asUser, freshDatabase, TEST_WEEK } from "./harness";
const sample = buildSample(TEST_WEEK);
const user = (role: string) => sample.users.find((u) => u.role === role)!;
let db: pg.Client; let close: () => Promise<void>;
beforeAll(async () => { ({ db, close } = await freshDatabase()); }, 120000);
afterAll(async () => close?.());
const attempt = async (q: any, sql: string, params: unknown[] = []) => {
  await q("savepoint t");
  try { const r = await q(sql, params); await q("release savepoint t"); return "ok n=" + r.rowCount + " " + JSON.stringify(r.rows?.slice(0, 3) ?? []); }
  catch (e: any) { await q("rollback to savepoint t"); return "ERR " + e.message; }
};
const su = async (q: any, sql: string, params: unknown[] = []) => { await q("set local role postgres"); try { return await attempt(q, sql, params); } finally { await q("set local role authenticated"); } };
const run = async (label: string, role: string, fn: (q: any) => Promise<Record<string, unknown>>, u?: any) => {
  const v = u ?? user(role);
  let out: any;
  const r = await asUser(db, v.userId, v.email, async (q) => { out = await fn(q); });
  console.log(label, r.ok ? JSON.stringify(out, null, 1) : r.error);
};

it("verify", async () => {
  const admins = sample.users.filter((u) => ["admin", "ceo", "cfo"].includes(u.role));
  const me = admins[0];
  await run("#2", "admin", async (q) => {
    const o: any = {};
    for (const a of admins.slice(1)) o[a.name] = await attempt(q, "update public.app_users set active=false where id=$1", [a.userId]);
    o.self = await attempt(q, "update public.app_users set auth_user_id=gen_random_uuid(), email='gone@example.com' where id=$1", [me.userId]);
    o.after = await attempt(q, "select count(*) from public.app_users where auth_user_id = auth.uid()");
    return o;
  }, me);
  await run("#3", "admin", async (q) => ({
    rename: await attempt(q, "update public.settings set key='absencePctX' where key='absencePct'"),
    setting: await su(q, "select app.setting('absencePct') v"),
    cap: await su(q, "select app.capacity($1::date) c", [TEST_WEEK]),
    winter: await attempt(q, `update public.settings set value='"banana"' where key='winterStart'`),
    winter2: await attempt(q, `update public.settings set value='{"a":1}' where key='winterEnd'`),
  }));
  const j = (await db.query("select id, number, contract_cents, billing_method from public.jobs where status <> 'complete' and active order by number limit 1")).rows[0];
  await run("#4", "job_setup", async (q) => ({
    bm: await attempt(q, "update public.jobs set billing_method='milestone' where id=$1", [j.id]),
    cc: await attempt(q, "update public.jobs set contract_cents=1, material_revenue_cents=0, estimate_hrs=1 where id=$1", [j.id]),
    setbm: await attempt(q, "select public.set_billing_method($1,'monthly')", [j.id]),
    now: await su(q, "select contract_cents, billing_method, estimate_hrs from public.jobs where id=$1", [j.id]),
  }));
  // #14 progress-billed job -> milestone
  const mj = (await db.query("select id, number, (app.contract_cents(jobs) - app.billed_cents(id))::int as left from public.jobs where billing_method='monthly' and status<>'complete' and active order by number limit 1")).rows[0];
  await run("#14", "admin", async (q) => {
    const o: any = {};
    o.left0 = await su(q, "select app.contract_cents(j) - app.billed_cents(j.id) left from public.jobs j where id=$1", [mj.id]);
    o.prog = await attempt(q, `select public.record_invoice(jsonb_build_object('jobId',$1::uuid::text,'kind','progress','period','2026-10','number','P1','amountCents',$2::bigint))`, [mj.id, mj.left - 100]);
    o.sw = await attempt(q, "select public.set_billing_method($1,'milestone')", [mj.id]);
    o.ms = await attempt(q, "select id, pct from public.milestones where job_id=$1 and active order by sort", [mj.id]);
    const m = (await q("select id from public.milestones where job_id=$1 and active order by sort limit 1", [mj.id])).rows[0];
    o.reach = await attempt(q, "select public.mark_milestone_reached($1)", [m.id]);
    o.inv = await attempt(q, `select public.record_invoice(jsonb_build_object('jobId',$1::uuid::text,'kind','milestone','milestoneId',$2::text,'number','M1'))`, [mj.id, m.id]);
    o.after = await su(q, "select app.contract_cents(j) c, app.billed_cents(j.id) b from public.jobs j where id=$1", [mj.id]);
    return o;
  });
  // #15 close_week
  const done = (await db.query("select id from public.jobs where status='complete' limit 1")).rows[0];
  const fut = (await db.query("select id, number, start from public.jobs where status<>'complete' and start > '2026-11-30' and active limit 1")).rows[0];
  await run("#15", "scheduler", async (q) => {
    const wk = (await q("select public.schedule_weeks() s")).rows[0].s.weekToClose;
    return {
      wk, fut,
      badsrc: await attempt(q, `select public.close_week(jsonb_build_object('week',$1::uuid::text,'entries',jsonb_build_array(jsonb_build_object('jobId',$2::text,'hours',5,'source','banana'))))`, [wk, fut.id]),
      procore: await attempt(q, `select public.close_week(jsonb_build_object('week',$1::uuid::text,'entries',jsonb_build_array(jsonb_build_object('jobId',$2::text,'hours',5,'source','procore'),jsonb_build_object('jobId',$3::text,'hours',7)),'finished',jsonb_build_array($2::text)))`, [wk, fut.id, done.id]),
      futNow: await su(q, "select status, actual_finish::text, start::text from public.jobs where id=$1", [fut.id]),
      doneHrs: await su(q, "select hours from public.actual_hours where job_id=$1 and week=$2", [done.id, wk]),
    };
  });
  // #16
  await run("#16", "accounting", async (q) => ({
    past: await attempt(q, `select public.record_invoice(jsonb_build_object('jobId',$1::uuid::text,'kind','skip','period','1999-01'))`, [mj.id]),
    future: await attempt(q, `select public.record_invoice(jsonb_build_object('jobId',$1::uuid::text,'kind','skip','period','2027-03'))`, [mj.id]),
    futprog: await attempt(q, `select public.record_invoice(jsonb_build_object('jobId',$1::uuid::text,'kind','progress','period','2030-05','number','X9','amountCents',100))`, [mj.id]),
    month13: await attempt(q, `select public.record_invoice(jsonb_build_object('jobId',$1::uuid::text,'kind','skip','period','2026-13'))`, [mj.id]),
  }));
  // #17
  const bj = (await db.query("select j.id, j.contract_cents::int contract_cents from public.jobs j where active and exists (select 1 from public.invoices i where i.job_id=j.id and i.active and i.amount_cents>0) order by number limit 1")).rows[0];
  await run("#17", "admin", async (q) => ({
    neg: await attempt(q, `select public.add_change_order(jsonb_build_object('jobId',$1::uuid::text,'number','CO-9','approvedBy','X','amountCents',-$2::bigint))`, [bj.id, bj.contract_cents]),
    after: await su(q, "select app.contract_cents(j) c, app.billed_cents(j.id) b from public.jobs j where id=$1", [bj.id]),
    mat: await attempt(q, `select public.add_change_order(jsonb_build_object('jobId',$1::uuid::text,'number','CO-10','approvedBy','X','amountCents',100,'materialCents',99999))`, [bj.id]),
  }));
  // #18
  await run("#18", "admin", async (q) => ({
    st: await attempt(q, "insert into public.journey_stages (key,label,sort) values ('zz','Old',99)"),
    ret: await attempt(q, "update public.journey_stages set active=false where key='zz'"),
    ins: await attempt(q, "insert into public.journey_checkpoints (key, stage_key, label, owner, offset_days, anchor, sort) values ('zzc','zz','X','pm',0,'start',1)"),
    mv: await attempt(q, "update public.journey_checkpoints set stage_key='zz' where key=(select key from public.journey_checkpoints where active limit 1)"),
  }));
  // #19
  const closed = (await db.query("select max(week)::text w from public.week_closes")).rows[0].w;
  const aj = (await db.query("select a.job_id, a.person_id, a.id from public.assignments a join public.jobs j on j.id=a.job_id where a.active and a.week=$1 limit 1", [closed])).rows[0];
  const anyj = (await db.query("select id from public.jobs where active and status='active' limit 1")).rows[0];
  const p = (await db.query("select id from public.people where active and kind<>'leadership' limit 1")).rows[0];
  await run("#19", "scheduler", async (q) => ({
    closed,
    remove: aj ? await attempt(q, "update public.assignments set active=false where id=$1", [aj.id]) : "no assignment in closed week",
    add: await attempt(q, "insert into public.assignments (job_id, person_id, week) values ($1,$2,$3) on conflict do nothing", [anyj.id, p.id, closed]),
    ov: await attempt(q, "insert into public.plan_overrides (job_id, week, hours) values ($1,$2,10)", [anyj.id, closed]),
  }));
  // #6 & #13 SQL
  await run("#6/13", "admin", async (q) => {
    const j51 = (await q("select id from public.jobs where number='4051'")).rows[0].id;
    return {
      before: await su(q, "select r.gp_now from app.wip_rows('2026-10') r where number='4051'"),
      upd: await attempt(q, "update public.jobs set projected_finish = projected_finish + 28 where id=$1", [j51]),
      after: await su(q, "select r.gp_now, r.gp_bid from app.wip_rows('2026-10') r where number='4051'"),
      nullAf: await attempt(q, "update public.jobs set actual_finish = null where id=$1", [j51]),
      in13: await su(q, "select count(*) from app.wip_rows('2026-10') r where number='4051'"),
      newComplete: await attempt(q, "update public.jobs set status='complete' where id=$1 returning actual_finish", [anyj.id]),
    };
  });
  // #7 SQL: CO effect on backlog formula
  await run("#7", "admin", async (q) => ({
    pre: await su(q, "select round(sum(j.contract_cents::numeric * greatest(0, j.projected_hrs - coalesce((select sum(hours) from public.actual_hours a where a.job_id=j.id and a.active),0)) / greatest(1, j.projected_hrs))) from public.jobs j where j.active and j.status<>'complete'"),
    co: await attempt(q, `select public.add_change_order(jsonb_build_object('jobId',$1::uuid::text,'number','CO-B','approvedBy','X','amountCents',10000000,'hours',100))`, [anyj.id]),
    post: await su(q, "select round(sum(j.contract_cents::numeric * greatest(0, j.projected_hrs - coalesce((select sum(hours) from public.actual_hours a where a.job_id=j.id and a.active),0)) / greatest(1, j.projected_hrs))) from public.jobs j where j.active and j.status<>'complete'"),
  }));
}, 120000);
