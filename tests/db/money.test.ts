import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { Money } from "../../src/domain/money";
import { buildIndex } from "../../src/domain/schedule";
import type { Viewer } from "../../src/domain/types";
import { buildSample } from "../../src/sample/seed";
import { asUser, freshDatabase, TEST_TODAY, TEST_WEEK } from "./harness";

const sample = buildSample(TEST_WEEK, TEST_TODAY);
const user = (role: string) => sample.users.find((u) => u.role === role)!;
const as = (v: Viewer, fn: Parameters<typeof asUser>[3]) => asUser(db, v.userId, v.email, fn);
const money = new Money(sample, buildIndex(sample), TEST_WEEK, TEST_TODAY);
const byNum = (n: string) => sample.jobs.find((j) => j.number === n)!;

let db: pg.Client;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await freshDatabase());
});
afterAll(async () => close?.());

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

describe("the database's money matches the screens'", () => {
  it("recognized revenue, billed, and retainage held for every job", async () => {
    for (const j of sample.jobs) {
      const { rows } = await db.query(
        "select app.recognized_cents(j) rec, app.billed_cents(j.id) billed, app.retainage_outstanding_cents(j) ret, app.contract_cents(j) val from public.jobs j where id = $1",
        [j.id],
      );
      expect(Number(rows[0].rec), j.number).toBeCloseTo(money.recognized(j), 0);
      expect(Number(rows[0].billed), j.number).toBe(money.billed(j));
      expect(Number(rows[0].ret), j.number).toBe(money.retainageOutstanding(j));
      expect(Number(rows[0].val), j.number).toBe(money.contract(j));
    }
  });
  it("company totals for reps and PMs: remaining, net billing and the review count", async () => {
    const r = await as(user("sales_rep"), (q) => q("select public.company_revenue_totals() x"));
    const x = r.ok && r.rows[0].x;
    const jobs = sample.jobs;
    expect(x.remainingCents).toBe(Math.round(jobs.filter((j) => j.status !== "complete").reduce((a, j) => a + money.remaining(j), 0)));
    expect(x.netBillingCents).toBe(Math.round(jobs.filter((j) => money.billed(j) > 0 || money.recognized(j) > 0).reduce((a, j) => a + money.overUnder(j), 0)));
    expect(x.reviewCount).toBe(jobs.filter((j) => money.forReview(j)).length);
    const supt = await as(user("superintendent"), (q) => q("select public.company_revenue_totals()"));
    expect(supt.ok).toBe(false);
  });
  it("estimators and leaders don't see invoices or percent complete", async () => {
    for (const role of ["estimator", "superintendent"]) {
      const r = await as(user(role), (q) => q("select (select count(*) from public.invoices) i, (select count(*) from public.percent_complete) p"));
      expect(r.ok && r.rows[0], role).toEqual({ i: "0", p: "0" });
    }
  });
});

describe("billing", () => {
  it("the sample's billing board loads as seeded", () => {
    expect(money.billState(byNum("4051"))).toBe("ready");
    expect(money.billState(byNum("4065"))).toBe("wait");
    expect(money.billState(byNum("4072"))).toBe("ret");
    expect(money.billState(byNum("4079"))).toBe("closed");
  });

  it("accounting records a final invoice only once the customer has signed off", async () => {
    const r = await as(user("accounting"), async (q) => {
      const notSigned = await attempt(q, "select public.record_invoice($1)", [{ jobId: byNum("4065").id, kind: "final", number: "26-2001", amountCents: 100 }]);
      await q("select public.record_invoice($1)", [{ jobId: byNum("4051").id, kind: "final", number: "26-2002", amountCents: 14850000 }]);
      const auto = (await q("select app.checkpoint_auto_done($1, 'final_invoice') d", [byNum("4051").id]).catch(() => ({ rows: [{ d: "n/a" }] }))).rows[0].d;
      return { rows: [{ notSigned, auto }] } as any;
    });
    expect(r.ok && r.rows[0].notSigned).toMatch(/signed off/);
  });

  it("retainage held on gross invoices is received in one step", async () => {
    const j = byNum("4072");
    const r = await as(user("cfo"), async (q) => {
      await q("select public.record_retainage_received($1)", [j.id]);
      await q("reset role");
      return q("select app.retainage_outstanding_cents(j) ret from public.jobs j where id = $1", [j.id]);
    });
    expect(r.ok ? "" : r.error).toBe("");
    expect(money.retainageOutstanding(j)).toBe(Math.round(j.contractCents * 0.05));
    expect(r.ok && Number(r.rows[0].ret)).toBe(0);
  });

  it("a milestone is invoiced at its share of the contract; reps can't record invoices", async () => {
    const j = sample.jobs[1];
    const tank1 = sample.milestones.find((x) => x.jobId === j.id && x.label === "Tank 1 lined")!;
    const rep = await as(user("sales_rep"), (q) => q("select public.record_invoice($1)", [{ jobId: j.id, kind: "milestone", milestoneId: tank1.id, number: "26-3000" }]));
    expect(rep.ok).toBe(false);
    const r = await as(user("accounting"), async (q) => {
      await q("select public.record_invoice($1)", [{ jobId: j.id, kind: "milestone", milestoneId: tank1.id, number: "26-3001" }]);
      return q("select amount_cents from public.invoices where number = '26-3001'");
    });
    expect(r.ok && Number(r.rows[0].amount_cents)).toBe(Math.round(j.contractCents * 0.4));
  });

  it("monthly jobs record a pay app or nothing to bill, once per month", async () => {
    const j = sample.jobs[2];
    const period = TEST_WEEK.slice(0, 7);
    const r = await as(user("accounting"), async (q) => {
      await q("select public.record_invoice($1)", [{ jobId: j.id, kind: "progress", period, number: "26-4001", amountCents: 500000 }]);
      const again = await attempt(q, "select public.record_invoice($1)", [{ jobId: j.id, kind: "skip", period }]);
      return { rows: [{ again }] } as any;
    });
    expect(r.ok && r.rows[0].again).not.toBe("ok");
  });

  it("milestones can't add up to more than 100%", async () => {
    const r = await as(user("accounting"), (q) => q("select public.save_milestones($1, $2)", [sample.jobs[14].id, JSON.stringify([{ label: "A", pct: 60 }, { label: "B", pct: 50 }])]));
    expect(r.ok ? "" : r.error).toMatch(/110%/);
  });

  it("billing alerts: ready to invoice, waiting on sign-off, and this month's pay apps", async () => {
    await db.query("begin");
    try {
      await db.query("select app.bill_check()");
      const titles = (await db.query("select title from public.alerts where rule = 'bill'")).rows.map((r) => r.title);
      expect(titles).toEqual(
        expect.arrayContaining([`Ready to invoice: 4051 Dakota Ridge Ethanol`, `Complete, waiting on sign-off: 4065 Sunrise Cheese`, expect.stringMatching(/^Progress billing for /)]),
      );
    } finally {
      await db.query("rollback");
    }
  });
});

describe("percent complete and change orders", () => {
  it("a PM enters this week's percent for their own job, and recognized revenue follows", async () => {
    const pm = user("pm");
    const j = sample.jobs.find((x) => x.pmCode === pm.pmCode && x.status === "active")!;
    const r = await as(pm, async (q) => {
      await q("select public.record_percent($1, 80, 60)", [j.id]);
      await q("reset role");
      return q("select week::text, app.recognized_cents(j) rec from public.percent_complete p join public.jobs j on j.id = p.job_id where job_id = $1 order by week desc limit 1", [j.id]);
    });
    expect(r.ok ? "" : r.error).toBe("");
    expect(r.ok && r.rows[0].week).toBe(TEST_WEEK);
    expect(r.ok && Number(r.rows[0].rec)).toBeCloseTo(j.materialRevenueCents * 0.8 + (j.contractCents - j.materialRevenueCents) * 0.6, 0);
  });

  it("an approved change order adds to the contract and the projected hours, and is logged", async () => {
    const pm = user("pm");
    const j = sample.jobs.find((x) => x.pmCode === pm.pmCode && x.status === "active")!;
    const r = await as(pm, async (q) => {
      await q("select public.add_change_order($1)", [{ jobId: j.id, number: "CO-1", description: "Third boom lift", amountCents: 1200000, materialCents: 400000, materialCostCents: 250000, hours: 40, approvedBy: "Plant engineer" }]);
      await q("reset role");
      return q(
        "select j.projected_hrs, app.contract_cents(j) val, (select count(*)::int from public.change_log where table_name = 'change_orders') logged from public.jobs j where id = $1",
        [j.id],
      );
    });
    expect(r.ok ? "" : r.error).toBe("");
    expect(r.ok && r.rows[0]).toEqual({ projected_hrs: j.projectedHrs + 40, val: String(j.contractCents + 1200000), logged: 1 });
  });
});

describe("money fixes from the demo review", () => {
  it("bid and current margin match the screens for every job", async () => {
    for (const j of sample.jobs) {
      const { rows } = await db.query("select app.gp_bid(j) bid from public.jobs j where id = $1", [j.id]);
      expect(Number(rows[0].bid), j.number).toBeCloseTo(money.gpBid(j), 6);
    }
  });
  it("a new burdened rate leaves existing jobs' margins alone", async () => {
    const j = sample.jobs.find((x) => x.status === "active")!;
    const r = await as(user("admin"), async (q) => {
      await q("update public.settings set value = '7000' where key = 'burdenedRateCents'");
      await attempt(q, "update public.jobs set burdened_rate_cents = 1 where id = $1", [j.id]);
      await q("reset role");
      const before = { g: String(money.gpBid(j)), r: String(j.burdenedRateCents) };
      const after = (await q("select app.gp_bid(j) g, burdened_rate_cents r from public.jobs j where id = $1", [j.id])).rows[0];
      return { rows: { before, after } } as never;
    });
    expect(r.ok ? "" : r.error).toBe("");
    const x = r.ok ? (r.rows as unknown as { before: { g: string; r: string }; after: { g: string; r: string } }) : null;
    expect(Number(x!.after.g)).toBeCloseTo(Number(x!.before.g), 6);
    expect(Number(x!.after.r)).toBe(Number(x!.before.r));
  });
  it("change-order materials carry their own cost, not their price", async () => {
    const pm = user("pm");
    const j = sample.jobs.find((x) => x.pmCode === pm.pmCode && x.status === "active")!;
    const r = await as(pm, async (q) => {
      await q("select public.add_change_order($1)", [{ jobId: j.id, number: "CO-7", amountCents: 500000, materialCents: 300000, materialCostCents: 180000, hours: 0, approvedBy: "Owner" }]);
      const noBy = await attempt(q, "select public.add_change_order($1)", [{ jobId: j.id, number: "CO-8", amountCents: 1, hours: 0 }]);
      await q("reset role");
      const after = Number((await q("select app.material_cost_cents(j) c from public.jobs j where id = $1", [j.id])).rows[0].c);
      return { rows: { added: after - money.materialCost(j), noBy } } as never;
    });
    expect(r.ok ? "" : r.error).toBe("");
    expect(r.ok && r.rows).toEqual({ added: 180000, noBy: "Enter who approved the change order" });
  });
  it("retainage is held per invoice, so a later % change doesn't restate it", async () => {
    const j = sample.jobs.find((x) => sample.invoices.some((i) => i.jobId === x.id && i.retainageCents > 0))!;
    const r = await as(user("admin"), async (q) => {
      await q("update public.jobs set retainage_pct = 10 where id = $1", [j.id]);
      await q("reset role");
      const before = String(money.retainageOutstanding(j));
      const after = (await q("select app.retainage_outstanding_cents(j) o from public.jobs j where id = $1", [j.id])).rows[0].o;
      return { rows: { before, after } } as never;
    });
    expect(r.ok ? "" : r.error).toBe("");
    const x = r.ok ? (r.rows as unknown as { before: string; after: string }) : null;
    expect(Number(x!.after)).toBe(Number(x!.before));
  });
  it("an invoice can't be empty or bill more than is left on the contract", async () => {
    const j = sample.jobs.find((x) => x.billingMethod === "monthly" && x.status !== "complete" && money.progressDue(x).length)!;
    const p = money.progressDue(j)[0];
    const r = await as(user("accounting"), async (q) => ({ rows: {
      zero: await attempt(q, "select public.record_invoice($1)", [{ jobId: j.id, kind: "progress", period: p, number: "26-9001", amountCents: 0 }]),
      over: await attempt(q, "select public.record_invoice($1)", [{ jobId: j.id, kind: "progress", period: p, number: "26-9002", amountCents: money.contract(j) * 2 }]),
    } }) as never);
    expect(r.ok ? "" : r.error).toBe("");
    expect(r.ok && (r.rows as unknown as { zero: string }).zero).toBe("Enter the invoice amount in dollars");
    expect(r.ok && (r.rows as unknown as { over: string }).over).toMatch(/^That's more than the \$.* left to bill on this job$/);
  });
  it("billing alerts go to the CFO role, with the demo's detail", async () => {
    const { rows } = await db.query("select title, body, recipients from public.alerts where rule = 'bill' order by title");
    expect(rows.length).toBeGreaterThan(0);
    for (const a of rows) expect(a.recipients, a.title).not.toContain("Jared");
    const period = rows.find((a) => a.title.startsWith("Progress billing for"));
    if (period) expect(period.body).toMatch(/suggested \$/);
    const late = rows.find((a) => a.title.startsWith("Progress invoice late"));
    if (late) expect(late.body).toMatch(/recognized but not billed\.$/);
  });
});

describe("finance views", () => {
  it("the database's WIP lines match the screen's for every job", async () => {
    const { wipRows } = await import("../../src/domain/money");
    const month = TEST_TODAY.slice(0, 7);
    const ts = wipRows(sample, money, month);
    const { rows } = await db.query("select * from app.wip_rows($1)", [month]);
    expect(rows.map((r) => r.number)).toEqual(ts.map((r) => r.number));
    for (const r of rows) {
      const t = ts.find((x) => x.number === r.number)!;
      expect(Number(r.contract_cents), r.number).toBe(t.contractCents);
      expect(r.materials_pct, r.number).toBe(t.materialsPct);
      expect(r.labor_pct, r.number).toBe(t.laborPct);
      expect(Number(r.recognized_cents), r.number).toBeCloseTo(t.recognizedCents, -1);
      expect(Number(r.billed_cents), r.number).toBe(t.billedCents);
      expect(Number(r.over_under_cents), r.number).toBeCloseTo(t.overUnderCents, -1);
      expect(Number(r.cost_to_complete_cents), r.number).toBeCloseTo(t.costToCompleteCents, -1);
      expect(Number(r.gp_now), r.number).toBeCloseTo(t.gpNow, 6);
      expect(Number(r.retainage_cents), r.number).toBe(t.retainageCents);
    }
  });
  it("accounting locks the month-end WIP once; PMs can't take or read it", async () => {
    const month = TEST_TODAY.slice(0, 7);
    const r = await as(user("accounting"), async (q) => ({
      rows: {
        n: (await q("select public.take_wip_snapshot($1) n", [month])).rows[0].n,
        again: await attempt(q, "select public.take_wip_snapshot($1)", [month]),
        old: await attempt(q, "select public.take_wip_snapshot('2025-01')"),
        seen: (await q("select count(*)::int n from public.wip_snapshots")).rows[0].n,
      },
    }) as never);
    expect(r.ok ? "" : r.error).toBe("");
    const x = r.ok ? (r.rows as unknown as { n: number; again: string; old: string; seen: number }) : null;
    expect(x!.n).toBeGreaterThan(0);
    expect(x!.seen).toBe(x!.n);
    expect(x!.again).toBe("That month is already locked");
    expect(x!.old).toBe("Take the snapshot for this month or last month");
    const pm = await as(user("pm"), (q) => q("select public.take_wip_snapshot($1)", [month]));
    expect(pm.ok).toBe(false);
  });
  it("accounting marks an invoice paid, once, on a sensible date", async () => {
    const inv = sample.invoices.find((i) => i.kind !== "skip" && !i.paidOn)!;
    const r = await as(user("accounting"), async (q) => ({
      rows: {
        early: await attempt(q, "select public.record_payment($1, '2020-01-01')", [inv.id]),
        ok: await attempt(q, "select public.record_payment($1)", [inv.id]),
        twice: await attempt(q, "select public.record_payment($1)", [inv.id]),
      },
    }) as never);
    expect(r.ok && r.rows).toEqual({ early: "The payment date has to be between the invoice date and today", ok: "ok", twice: "Already marked paid" });
    const rep = await as(user("sales_rep"), (q) => q("select public.record_payment($1)", [inv.id]));
    expect(rep.ok).toBe(false);
  });
});
