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
      await q("select public.add_change_order($1)", [{ jobId: j.id, number: "CO-1", description: "Third boom lift", amountCents: 1200000, hours: 40 }]);
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
