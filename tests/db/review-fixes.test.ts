import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import type { Viewer } from "../../src/domain/types";
import { buildSample } from "../../src/sample/seed";
import { asUser, freshDatabase, TEST_TODAY, TEST_WEEK } from "./harness";

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

describe("hours nudge", () => {
  it("the scheduler nudges a PM with the same words as the screen; the PM sees it, other PMs don't", async () => {
    const { missingHoursByPm, nudgeAlert } = await import("../../src/domain/close");
    const sched = user("scheduler");
    const miss = missingHoursByPm(sample, TEST_WEEK)[0];
    const r = await as(sched, async (q) => {
      const n = (await q("select public.nudge_hours($1, $2) n", [miss.pmCode, TEST_WEEK])).rows[0].n;
      await q("reset role");
      const a = (await q("select title, body, recipients from public.alerts where rule = 'hours'")).rows[0];
      return { rows: { n, a } } as never;
    });
    expect(r.ok ? "" : r.error).toBe("");
    const x = r.ok ? (r.rows as unknown as { n: number; a: { title: string; body: string; recipients: string[] } }) : null;
    const pmName = sample.pms.find((p) => p.code === miss.pmCode)!.name;
    expect(x!.n).toBe(miss.jobs.length);
    expect(x!.a).toEqual({ ...nudgeAlert(TEST_WEEK, miss.jobs, sched.name), recipients: [pmName] });
    const rep = await as(user("sales_rep"), (q) => q("select public.nudge_hours($1, $2)", [miss.pmCode, TEST_WEEK]));
    expect(rep.ok).toBe(false);
  });
});

describe("reminders, retainage part payments and stages", () => {
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
  it("Lori reminds the person a stuck work order waits on, once a day, in the same words as the screen", async () => {
    const { woReminder } = await import("../../src/domain/workOrders");
    const { namesOf } = await import("../../src/domain/views");
    const w = sample.workOrders.find((x) => x && !x.final && x.fileName && !x.returned && x.currentStep < 3)!;
    const j = sample.jobs.find((x) => x.id === w.jobId)!;
    const lori = user("job_setup");
    const r = await as(lori, async (q) => {
      const first = await attempt(q, "select public.wo_remind($1)", [j.id]);
      const again = await attempt(q, "select public.wo_remind($1)", [j.id]);
      await q("reset role");
      const a = (await q("select title, body, recipients from public.alerts where title like 'Reminder: work order%'")).rows[0];
      return { rows: { first, again, a } } as never;
    });
    expect(r.ok ? "" : r.error).toBe("");
    const x = r.ok ? (r.rows as unknown as { first: string; again: string; a: unknown }) : null;
    expect(x!.first).toBe("ok");
    expect(x!.again).toBe("Already reminded today");
    expect(x!.a).toEqual(woReminder(j, w, namesOf(sample), TEST_TODAY, lori.name));
    const rep = await as(user("sales_rep"), (q) => q("select public.wo_remind($1)", [j.id]));
    expect(rep.ok).toBe(false);
  });
  it("accounting records part of the retainage, never more than is outstanding", async () => {
    const j = sample.jobs.find((x) => sample.invoices.some((i) => i.jobId === x.id && i.retainageCents > 0))!;
    const r = await as(user("accounting"), async (q) => ({
      rows: {
        part: await attempt(q, "select public.record_retainage_received($1, 1000)", [j.id]),
        tooMuch: await attempt(q, "select public.record_retainage_received($1, 999999999)", [j.id]),
        rest: await attempt(q, "select public.record_retainage_received($1)", [j.id]),
        none: await attempt(q, "select public.record_retainage_received($1)", [j.id]),
      },
    }) as never);
    const x = r.ok ? (r.rows as unknown as Record<string, string>) : {};
    expect(x.part).toBe("ok");
    expect(x.tooMuch).toMatch(/^Enter an amount up to the \$/);
    expect(x.rest).toBe("ok");
    expect(x.none).toBe("No retainage outstanding on this job");
  });
  it("admins add and reorder stages; a stage in use can't be retired", async () => {
    const r = await as(user("admin"), async (q) => ({
      rows: {
        add: await attempt(q, "insert into public.journey_stages (key, label, sort, startup) values ('safety', 'Pre-job safety review', 99, true)"),
        retire: await attempt(q, "update public.journey_stages set active = false where key = 'sold'"),
        empty: await attempt(q, "update public.journey_stages set active = false where key = 'safety'"),
      },
    }) as never);
    expect(r.ok && r.rows).toEqual({ add: "ok", retire: "Move or retire this stage's checkpoints first", empty: "ok" });
    const pm = await as(user("pm"), (q) => q("insert into public.journey_stages (key, label, sort, startup) values ('x', 'X', 98, true)"));
    expect(pm.ok).toBe(false);
  });
});

describe("independent review: security fixes", () => {
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
  it("leaders can't read closeout dollars, directly or through the change log; money roles still can", async () => {
    const supt = user("superintendent");
    const direct = await as(supt, (q) => q("select contract_cents from public.closeout_outcomes limit 1"));
    expect(direct.ok).toBe(false);
    const own = await as(supt, (q) => q("select count(*)::int n from public.closeout_outcomes"));
    expect(own.ok && own.rows[0].n).toBeGreaterThan(0);
    const viaFn = await as(supt, (q) => q("select count(*)::int n from public.outcome_money()"));
    expect(viaFn.ok && viaFn.rows[0].n).toBe(0);
    const cfo = await as(user("cfo"), (q) => q("select count(*)::int n from public.outcome_money()"));
    expect(cfo.ok && cfo.rows[0].n).toBe(sample.outcomes.length);
    // Complete a job so a closeout row lands in the change log, then look as an estimator.
    const j = sample.jobs.find((x) => x.status === "active")!;
    const est = user("estimator");
    const r = await as(user("admin"), async (q) => {
      await q("update public.jobs set status = 'complete', actual_finish = $2 where id = $1", [j.id, TEST_WEEK]);
      await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: est.userId, email: est.email, role: "authenticated" })]);
      return q("select count(*)::int n from public.change_log where table_name = 'closeout_outcomes'");
    });
    expect(r.ok && r.rows[0].n).toBe(0);
  });
  it("a PM can't tick the customer sign-off on someone else's job", async () => {
    const pm = user("pm");
    const other = sample.jobs.find((x) => x.pmCode !== pm.pmCode && x.status !== "complete")!;
    const mine = sample.jobs.find((x) => x.pmCode === pm.pmCode && x.status !== "complete")!;
    const r = await as(pm, async (q) => ({
      rows: {
        other: await attempt(q, "select public.set_checkpoint($1, 'walk', true)", [other.id]),
        mine: await attempt(q, "select public.set_checkpoint($1, 'walk', true)", [mine.id]),
      },
    }) as never);
    expect(r.ok && r.rows).toEqual({ other: "That checkpoint belongs to someone else", mine: "ok" });
  });
  it("job setup can't name herself estimator and sign the estimator step", async () => {
    const lori = user("job_setup");
    const w = sample.workOrders.find((x) => x && !x.final && x.fileName && !x.returned && x.currentStep === 0)!;
    const r = await as(lori, async (q) => {
      await q("update public.jobs set estimator = $2 where id = $1", [w.jobId, lori.name]);
      return { rows: { sign: await attempt(q, "select public.wo_approve($1)", [w.jobId]) } } as never;
    });
    expect(r.ok && (r.rows as unknown as { sign: string }).sign).not.toBe("ok");
  });
  it("nobody inserts jobs directly; create_job is the only way in", async () => {
    const r = await as(user("scheduler"), (q) =>
      q("insert into public.jobs (number, customer, job_type, location, rep_code, pm_code, estimator, crew_size, estimate_hrs, projected_hrs, contract_cents, start, projected_finish, baseline_finish) values ('9876','X','Y','Z','ER','JM','E',1,100,100,100,'2026-12-07','2026-12-11','2027-12-31')"),
    );
    expect(r.ok).toBe(false);
  });
  it("notes carry the real author, and a leader can't add a pinned note", async () => {
    const supt = user("superintendent");
    const j = sample.jobs.find((x) => x.leaderId === supt.personId)!;
    const r = await as(supt, async (q) => ({
      rows: {
        pinned: await attempt(q, "insert into public.job_notes (job_id, body, pinned, author_name) values ($1, 'x', true, 'Derrick Gordon')", [j.id]),
        plain: await attempt(q, "insert into public.job_notes (job_id, body, pinned, author_name) values ($1, 'gate code changed', false, 'Derrick Gordon')", [j.id]),
        author: (await q("select author_name from public.job_notes where body = 'gate code changed'")).rows[0]?.author_name,
      },
    }) as never);
    expect(r.ok ? "" : r.error).toBe("");
    const x = (r.ok ? r.rows : []) as unknown as { pinned: string; plain: string; author: string };
    expect(x.pinned).not.toBe("ok");
    expect(x.plain).toBe("ok");
    expect(x.author).toBe(supt.name);
  });
});

describe("independent review: money and rule fixes", () => {
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
  const run = async (role: string, fn: (q: (s: string, p?: unknown[]) => Promise<pg.QueryResult>) => Promise<Record<string, unknown>>) => {
    const r = await as(user(role), async (q) => ({ rows: await fn(q) }) as never);
    expect(r.ok ? "" : r.error).toBe("");
    return (r.ok ? r.rows : {}) as unknown as Record<string, string>;
  };

  it("locked WIP for a month leaves out later invoices and keeps jobs finished since", async () => {
    const j = sample.jobs.find((x) => x.status === "active" && x.start <= "2026-10-31")!;
    const r = await run("admin", async (q) => {
      await q("reset role");
      const before = (await q("select billed_cents from app.wip_rows('2026-10') where job_id = $1", [j.id])).rows[0]?.billed_cents ?? null;
      await q("update public.jobs set status = 'complete', actual_finish = '2026-11-02' where id = $1", [j.id]);
      await q("insert into public.invoices (job_id, kind, number, amount_cents, invoiced_on, recorded_by) values ($1, 'final', '26-9100', 100, '2026-11-02', 'x')", [j.id]);
      const after = (await q("select billed_cents from app.wip_rows('2026-10') where job_id = $1", [j.id])).rows[0]?.billed_cents ?? null;
      return { before, after };
    });
    expect(r.before).not.toBeNull();
    expect(r.after).toBe(r.before);
  });
  it("a finished job's hours are what it took, whatever its projected finish says", async () => {
    const j = sample.jobs.find((x) => x.status === "complete" && sample.actuals.some((a) => a.jobId === x.id))!;
    const act = sample.actuals.filter((a) => a.jobId === j.id).reduce((a, x) => a + x.hours, 0);
    const { rows } = await db.query("select app.eac(j) e from public.jobs j where id = $1", [j.id]);
    expect(Number(rows[0].e)).toBeCloseTo(act, 1);
  });
  it("milestone invoices can't bill more than the contract", async () => {
    const j = sample.jobs.find((x) => x.billingMethod === "monthly" && x.status === "active" && sample.invoices.some((i) => i.jobId === x.id))!;
    const r = await run("accounting", async (q) => {
      await q("select public.set_billing_method($1, 'milestone')", [j.id]);
      await q("reset role");
      await q("update public.milestones set reached_on = '2026-10-20', reached_by = 'x' where job_id = $1", [j.id]);
      await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user("accounting").userId, email: user("accounting").email, role: "authenticated" })]);
      await q("set local role authenticated");
      const ms = (await q("select id from public.milestones where job_id = $1 and active order by sort", [j.id])).rows;
      const out: string[] = [];
      for (const m of ms) out.push(await attempt(q, "select public.record_invoice($1)", [{ jobId: j.id, kind: "milestone", milestoneId: m.id, number: "26-M" + m.id.slice(-4) }]));
      await q("reset role");
      const v = (await q("select app.billed_cents($1) b, app.contract_cents(j) c from public.jobs j where id = $1", [j.id])).rows[0];
      return { out: out.join("|"), over: Number(v.b) > Number(v.c) ? "over" : "within" };
    });
    expect(r.over).toBe("within");
    expect(r.out).toMatch(/left to bill/);
  });
  it("change orders can't drop the contract below what's billed or carry more materials than they're worth", async () => {
    const j = sample.jobs.find((x) => sample.invoices.some((i) => i.jobId === x.id && i.amountCents > 0) && x.status === "active")!;
    const r = await run("admin", async (q) => ({
      below: await attempt(q, "select public.add_change_order($1)", [{ jobId: j.id, number: "CO-X", amountCents: -j.contractCents, approvedBy: "Owner" }]),
      mat: await attempt(q, "select public.add_change_order($1)", [{ jobId: j.id, number: "CO-Y", amountCents: 100, materialCents: 99999, approvedBy: "Owner" }]),
    }));
    expect(r.below).toMatch(/below the .* already billed/);
    expect(r.mat).toBe("The materials part can't be more than the change order itself");
  });
  it("job setup can't change the billing method or the estimate's dollars and hours", async () => {
    const j = sample.jobs.find((x) => x.status === "scheduled")!;
    const r = await run("job_setup", async (q) => ({
      method: await attempt(q, "update public.jobs set billing_method = 'milestone' where id = $1", [j.id]),
      bid: await attempt(q, "update public.jobs set estimate_hrs = 1 where id = $1", [j.id]),
      intake: await attempt(q, "update public.jobs set customer_po = 'PO-1' where id = $1", [j.id]),
    }));
    expect(r.method).toMatch(/can't change billingMethod/);
    expect(r.bid).toMatch(/can't change bid/);
    expect(r.intake).toBe("ok");
  });
  it("the close only takes the week's open jobs; progress invoices only for real months", async () => {
    const done = sample.jobs.find((x) => x.status === "complete")!;
    const later = sample.jobs.find((x) => x.start > TEST_WEEK)!;
    const c = await run("scheduler", async (q) => ({
      hours: await attempt(q, "select public.close_week($1)", [{ week: TEST_WEEK, entries: [{ jobId: done.id, hours: 5000, source: "typed" }], finished: [] }]),
      finish: await attempt(q, "select public.close_week($1)", [{ week: TEST_WEEK, entries: [], finished: [later.id] }]),
    }));
    expect(c.hours).toMatch(/^Hours can only go on jobs open/);
    expect(c.finish).toMatch(/^Only jobs that started by/);
    const m = sample.jobs.find((x) => x.billingMethod === "monthly" && x.status === "active")!;
    const p = await run("accounting", async (q) => ({
      future: await attempt(q, "select public.record_invoice($1)", [{ jobId: m.id, kind: "skip", period: "2030-01" }]),
      bad: await attempt(q, "select public.record_invoice($1)", [{ jobId: m.id, kind: "skip", period: "2026-13" }]),
    }));
    expect(p.future).toBe("Pick a month from the job's start through this month");
    expect(p.bad).toBe("Pick a month from the job's start through this month");
  });
  it("settings can't be renamed or given a bad date; an admin can't unlink their own sign-in", async () => {
    const admin = user("admin");
    const r = await run("admin", async (q) => ({
      rename: await attempt(q, "update public.settings set key = 'absencePctX' where key = 'absencePct'"),
      winter: await attempt(q, `update public.settings set value = '"banana"' where key = 'winterStart'`),
      unlink: await attempt(q, "update public.app_users set auth_user_id = null where id = $1", [admin.userId]),
      email: await attempt(q, "update public.app_users set email = 'x@example.com' where id = $1", [admin.userId]),
    }));
    expect(r).toEqual({
      rename: "Settings can't be renamed",
      winter: "Use MM-DD, for example 12-01",
      unlink: "You can't change your own access. Ask another admin",
      email: "You can't change your own access. Ask another admin",
    });
  });
  it("no checkpoints in retired stages, no crew or plan changes in closed weeks, no complete job without a finish date", async () => {
    const supt = user("superintendent");
    const lj = sample.jobs.find((x) => x.leaderId === supt.personId && x.status === "active")!;
    const closed = [...sample.closes].map((c) => c.week).sort().at(-1)!;
    const field = sample.people.find((p) => p.kind === "field")!;
    const a = await run("admin", async (q) => ({
      retire: await attempt(q, "insert into public.journey_stages (key, label, sort, startup, active) values ('old', 'Old', 98, false, false)"),
      into: await attempt(q, "insert into public.journey_checkpoints (key, stage_key, label, owner, offset_days, anchor, sort) values ('x1', 'old', 'X', 'pm', -7, 'start', 1)"),
      plan: await attempt(q, "insert into public.plan_overrides (job_id, week, hours) values ($1, $2, 10)", [lj.id, closed]),
      complete: await attempt(q, "update public.jobs set status = 'complete', actual_finish = null where id = $1", [lj.id]),
    }));
    expect(a.retire).toBe("ok");
    expect(a.into).toBe("That stage is retired");
    expect(a.plan).toMatch(/is closed$/);
    expect(a.complete).toMatch(/complete_has_finish/);
    const s = await run("superintendent", async (q) => ({ crew: await attempt(q, "insert into public.assignments (job_id, person_id, week) values ($1, $2, $3)", [lj.id, field.id, closed]) }));
    expect(s.crew).toMatch(/is closed$/);
  });
});

describe("Austin's calls after the review", () => {
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
  it("milestone billing starts from the admin's default milestones, which are checked", async () => {
    const j = sample.jobs.find((x) => x.billingMethod === "final" && x.status === "scheduled")!;
    const r = await as(user("admin"), async (q) => {
      const bad = await attempt(q, `update public.settings set value = '[{"label":"A","pct":80},{"label":"B","pct":40}]' where key = 'milestoneDefaults'`);
      await q(`update public.settings set value = '[{"label":"Deposit","pct":10},{"label":"Half done","pct":50}]' where key = 'milestoneDefaults'`);
      await q("select public.set_billing_method($1, 'milestone')", [j.id]);
      const ms = (await q("select label, pct::int pct from public.milestones where job_id = $1 order by sort", [j.id])).rows;
      return { rows: { bad, ms } } as never;
    });
    expect(r.ok ? "" : r.error).toBe("");
    expect(r.ok && r.rows).toEqual({
      bad: "Each milestone needs a name and a percent from 1 to 100, adding up to no more than 100",
      ms: [
        { label: "Deposit", pct: 10 },
        { label: "Half done", pct: 50 },
      ],
    });
  });
  it("no two people share a name, and renaming an estimator carries their jobs along", async () => {
    const est = user("estimator");
    const other = sample.users.find((u) => u.role === "estimator" && u.userId !== est.userId)!;
    const r = await as(user("admin"), async (q) => {
      const dupe = await attempt(q, "update public.app_users set name = $2 where id = $1", [other.userId, est.name]);
      await q("update public.app_users set name = $2 where id = $1", [est.userId, est.name + " Jr"]);
      await q("reset role");
      const left = (await q("select count(*)::int n from public.jobs where estimator = $1", [est.name])).rows[0].n;
      const moved = (await q("select count(*)::int n from public.jobs where estimator = $1", [est.name + " Jr"])).rows[0].n;
      return { rows: { dupe, left, moved } } as never;
    });
    expect(r.ok ? "" : r.error).toBe("");
    const x = (r.ok ? r.rows : []) as unknown as { dupe: string; left: number; moved: number };
    expect(x.dupe).toMatch(/app_users_unique_name/);
    expect(x.left).toBe(0);
    expect(x.moved).toBe(sample.jobs.filter((j) => j.estimator === est.name).length);
  });
});
