import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { JOB_FIELD_RULES, type JobField, canEditJob, canSeeJob } from "../../src/domain/permissions";
import type { Job, Viewer } from "../../src/domain/types";
import { buildSample } from "../../src/sample/seed";
import { asUser, freshDatabase, TEST_WEEK } from "./harness";

const sample = buildSample(TEST_WEEK);
const user = (role: string) => sample.users.find((u) => u.role === role)!;
const admin = user("admin");

let db: pg.Client;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await freshDatabase());
  // Extra users the sample doesn't carry: a field crew member and a second PM who owns nothing here.
  await db.query(`insert into auth.users (id, email) values
    ('00000000-0000-4000-8fff-000000000001', 'crew@example.com'),
    ('00000000-0000-4000-8fff-000000000002', 'otherpm@example.com')`);
  const crewPerson = sample.people.find((p) => p.kind === "field")!.id;
  await db.query(
    `insert into public.app_users (id, auth_user_id, email, name, role, pm_code, person_id) values
    ('00000000-0000-4000-8fff-000000000001', '00000000-0000-4000-8fff-000000000001', 'crew@example.com', 'Crew', 'field_crew', null, $1),
    ('00000000-0000-4000-8fff-000000000002', '00000000-0000-4000-8fff-000000000002', 'otherpm@example.com', 'Other PM', 'pm', 'SS', null)`,
    [crewPerson],
  );
});
afterAll(async () => close?.());

const as = (v: Viewer, fn: Parameters<typeof asUser>[3]) => asUser(db, v.userId, v.email, fn);

describe("reading jobs", () => {
  it("each role sees exactly the jobs permissions.ts says", async () => {
    const extra: Viewer[] = [
      { userId: "00000000-0000-4000-8fff-000000000001", email: "crew@example.com", name: "Crew", role: "field_crew", personId: null, repCode: null, pmCode: null },
    ];
    for (const v of [...sample.users, ...extra]) {
      const r = await as(v, (q) => q("select number from public.jobs order by number"));
      expect(r.ok, v.role).toBe(true);
      const expected = sample.jobs.filter((j) => canSeeJob(v, j)).map((j) => j.number).sort();
      expect(r.ok && r.rows.map((x) => x.number), v.role).toEqual(expected);
    }
  });
  it("anonymous visitors get nothing", async () => {
    const r = await asUser(db, null, "", (q) => q("select * from public.jobs"));
    expect(r.ok).toBe(false);
  });
  it("only the crew office reads phone, DOT expiry and time off", async () => {
    for (const role of ["admin", "ceo", "cfo", "scheduler"]) {
      const r = await as(user(role), (q) => q("select (select count(*) from public.people_private) a, (select count(*) from public.time_off) b"));
      expect(r.ok && Number(r.rows[0].a) > 0 && Number(r.rows[0].b) > 0, role).toBe(true);
    }
    for (const role of ["sales_rep", "pm", "superintendent", "accounting", "estimator"]) {
      const r = await as(user(role), (q) => q("select (select count(*) from public.people_private) a, (select count(*) from public.time_off) b"));
      expect(r.ok && r.rows[0], role).toEqual({ a: "0", b: "0" });
    }
  });
});

// ---------------------------------------------------------------- the parity check
type Stmt = (q: (sql: string, p?: unknown[]) => Promise<pg.QueryResult>, j: Job) => Promise<pg.QueryResult>;
const otherLeader = sample.people.find((p) => p.kind === "leader" && p.name === "Travis Moe")!.id;
const fieldPerson = sample.people.find((p) => p.kind === "field")!.id;

const UPDATE: Record<JobField, Stmt> = {
  start: (q, j) => q("update public.jobs set start = start - 7 where id = $1", [j.id]),
  projectedFinish: (q, j) => q("update public.jobs set projected_finish = projected_finish + 7 where id = $1", [j.id]),
  crewSize: (q, j) => q("update public.jobs set crew_size = crew_size + 1 where id = $1", [j.id]),
  leaderId: (q, j) => q("update public.jobs set leader_id = $2 where id = $1", [j.id, otherLeader]),
  projectedHrs: (q, j) => q("update public.jobs set projected_hrs = projected_hrs + 10 where id = $1", [j.id]),
  mustFinish: (q, j) =>
    q(
      `update public.jobs set must_finish = case when must_finish is null then projected_finish end,
         must_finish_reason = case when must_finish is null then 'shutdown'::must_finish_reason end where id = $1`,
      [j.id],
    ),
  firmness: (q, j) =>
    q(`update public.jobs set firmness = case when firmness = 'flexible' then 'confirmed' else 'flexible' end::firmness,
         waits_on_job_id = null, firmness_reason = 'Customer moved the shutdown' where id = $1`, [j.id]),
  status: (q, j) =>
    q(
      `update public.jobs set status = case when status = 'on_hold' then 'scheduled' else 'on_hold' end::job_status,
         hold_reason = case when status = 'on_hold' then null else 'Customer delay' end,
         hold_until = case when status = 'on_hold' then null else projected_finish end where id = $1`,
      [j.id],
    ),
  actualFinish: (q, j) => q("update public.jobs set actual_finish = projected_finish where id = $1", [j.id]),
  site: (q, j) => q("update public.jobs set site_contact = 'New contact' where id = $1", [j.id]),
  intake: (q, j) => q("update public.jobs set customer = customer || ' Inc' where id = $1", [j.id]),
  plan: (q, j) => q("insert into public.plan_overrides (job_id, week, hours) values ($1, $2, 50)", [j.id, TEST_WEEK]),
  crew: (q, j) => q("insert into public.assignments (job_id, person_id, week) values ($1, $2, '2027-03-05')", [j.id, fieldPerson]),
  notes: (q, j) => q("insert into public.job_notes (job_id, body) values ($1, 'Test note')", [j.id]),
  pinNotes: (q, j) => q("update public.job_notes set pinned = not pinned where job_id = $1", [j.id]),
  actuals: (q, j) => q("insert into public.hour_entries (job_id, week, hours) values ($1, $2, 40)", [j.id, TEST_WEEK]),
  percent: (q, j) => q("select public.record_percent($1, 50, 40)", [j.id]),
  changeOrders: (q, j) => q("select public.add_change_order($1)", [{ jobId: j.id, number: "CO-9", amountCents: 100000, hours: 10, approvedBy: "Customer" }]),
  milestones: (q, j) => q("select public.mark_milestone_reached((select id from public.milestones where job_id = $1 and label = 'Test milestone'))", [j.id]),
};

describe("editing jobs: the database allows exactly what permissions.ts allows", () => {
  const rep = user("sales_rep");
  const pm = user("pm");
  const supt = user("superintendent");
  const owned = (pred: (j: Job) => boolean) => sample.jobs.find(pred)!;
  const targets: Job[] = [
    owned((j) => j.repCode === rep.repCode),
    owned((j) => j.pmCode === pm.pmCode && j.repCode !== rep.repCode),
    owned((j) => j.leaderId === supt.personId),
    owned((j) => j.repCode !== rep.repCode && j.pmCode !== pm.pmCode && j.leaderId !== supt.personId && !j.waitsOnJobId),
  ];
  const otherPm: Viewer = { userId: "00000000-0000-4000-8fff-000000000002", email: "otherpm@example.com", name: "Other PM", role: "pm", personId: null, repCode: null, pmCode: "SS" };

  beforeAll(async () => {
    for (const j of new Set(targets)) {
      await db.query("insert into public.job_notes (job_id, body) values ($1, 'Seed note')", [j.id]);
      await db.query("insert into public.milestones (job_id, label, pct) values ($1, 'Test milestone', 10)", [j.id]);
    }
  });

  for (const field of Object.keys(JOB_FIELD_RULES) as JobField[]) {
    it(field, async () => {
      for (const v of [...sample.users, otherPm]) {
        for (const j of targets) {
          const expected = canSeeJob(v, j) && canEditJob(v, j, field);
          const r = await as(v, (q) => UPDATE[field](q, j));
          const worked = r.ok && r.rowCount > 0;
          expect(worked, `${v.role} ${field} on job ${j.number}: ${r.ok ? "" : r.error}`).toBe(expected);
        }
      }
    });
  }
});

describe("history rules", () => {
  it("nobody can delete, not even admin", async () => {
    for (const t of ["jobs", "people", "time_off", "assignments", "plan_overrides", "job_notes", "change_log"]) {
      const r = await as(admin, (q) => q(`delete from public.${t}`));
      expect(r.ok, t).toBe(false);
    }
  });
  it("logs who, when, what, old and new for every changed field", async () => {
    const j = sample.jobs[0];
    const r = await as(admin, async (q) => {
      await q("update public.jobs set start = '2026-10-05', crew_size = 9 where id = $1", [j.id]);
      return q("select user_name, field, old_value, new_value, record_label from public.change_log where job_id = $1 and field <> 'added' order by field", [j.id]);
    });
    expect(r.ok && r.rows).toEqual([
      { user_name: "Austin Lewis", field: "crew_size", old_value: String(j.crewSize), new_value: "9", record_label: "Job " + j.number },
      { user_name: "Austin Lewis", field: "start", old_value: j.start, new_value: "2026-10-05", record_label: "Job " + j.number },
    ]);
  });
  it("logs changes to crew records, assignments and settings too", async () => {
    const r = await as(user("scheduler"), async (q) => {
      await q("insert into public.time_off (person_id, first_day, last_day, type) values ($1, '2026-11-02', '2026-11-03', 'PTO')", [fieldPerson]);
      await q("update public.time_off set active = false where person_id = $1 and first_day = '2026-11-02'", [fieldPerson]);
      return q("select table_name, field, new_value from public.change_log where table_name = 'time_off' and user_name = 'Nicole' order by id");
    });
    expect(r.ok && r.rows.map((x: any) => x.field)).toEqual(["added", "active"]);
  });
  it("users can't write the change log directly", async () => {
    const r = await as(admin, (q) => q("insert into public.change_log (table_name, record_id, field) values ('jobs', 'x', 'y')"));
    expect(r.ok).toBe(false);
  });
  it("the baseline finish never moves", async () => {
    const j = sample.jobs[0];
    const r = await as(admin, async (q) => {
      await q("update public.jobs set baseline_finish = '2030-01-04' where id = $1", [j.id]);
      return q("select baseline_finish::text b from public.jobs where id = $1", [j.id]);
    });
    expect(r.ok && r.rows[0].b).toBe(j.baselineFinish);
  });
});

describe("business rules held in the database", () => {
  it("moving a job off Locked needs a reason, and the reason lands in pinned notes", async () => {
    const j = sample.jobs.find((x) => x.firmness === "locked")!;
    const noReason = await as(admin, (q) => q("update public.jobs set firmness = 'confirmed' where id = $1", [j.id]));
    expect(noReason.ok).toBe(false);
    const r = await as(admin, async (q) => {
      await q("update public.jobs set firmness = 'confirmed', firmness_reason = 'Shutdown moved a week' where id = $1", [j.id]);
      return q("select body, pinned from public.job_notes where job_id = $1 and body like 'Firmness%'", [j.id]);
    });
    expect(r.ok && r.rows).toEqual([{ body: "Firmness Locked → Confirmed, some flexibility: Shutdown moved a week", pinned: true }]);
  });
  it("on hold needs a reason and a restart date", async () => {
    const j = sample.jobs[3];
    const r = await as(admin, (q) => q("update public.jobs set status = 'on_hold' where id = $1", [j.id]));
    expect(r.ok).toBe(false);
  });
  it("weeks must be Fridays and job numbers four digits", async () => {
    const j = sample.jobs[0];
    const badWeek = await as(admin, (q) => q("insert into public.plan_overrides (job_id, week, hours) values ($1, '2026-10-29', 10)", [j.id]));
    expect(badWeek.ok).toBe(false);
    const badNumber = await as(admin, (q) => q("update public.jobs set number = '41120' where id = $1", [j.id]));
    expect(badNumber.ok).toBe(false);
  });
  it("only admin and CEO change who is on the active roster", async () => {
    const r1 = await as(user("scheduler"), (q) => q("update public.people set active = false where id = $1", [fieldPerson]));
    expect(r1.ok).toBe(false);
    const r2 = await as(user("scheduler"), (q) => q("update public.people set state = 'WI' where id = $1", [fieldPerson]));
    expect(r2.ok && r2.rowCount).toBe(1);
    const r3 = await as(user("ceo"), (q) => q("update public.people set active = false where id = $1", [fieldPerson]));
    expect(r3.ok && r3.rowCount).toBe(1);
  });
  it("the CFO has full rights: settings, access and the roster", async () => {
    const r = await as(user("cfo"), async (q) => {
      await q("update public.settings set value = '11' where key = 'absencePct'");
      await q("insert into public.app_users (email, name, role) values ('new.est@example.com', 'New Estimator', 'estimator')");
      await q("update public.people set active = false where id = $1", [fieldPerson]);
      return q("select (select value::text from public.settings where key = 'absencePct') v, (select count(*) from public.app_users where email = 'new.est@example.com') u");
    });
    expect(r.ok && r.rows[0]).toEqual({ v: "11", u: "1" });
  });
  it("only admin, CEO and CFO change settings", async () => {
    const r1 = await as(user("scheduler"), (q) => q("update public.settings set value = '12' where key = 'absencePct'"));
    expect(r1.ok && r1.rowCount).toBe(0);
    const r2 = await as(admin, (q) => q("update public.settings set value = '12' where key = 'absencePct'"));
    expect(r2.ok && r2.rowCount).toBe(1);
  });
});

describe("functions", () => {
  const payload = {
    number: "4291",
    customer: "Valley Malt House",
    jobType: "Floor system",
    location: "Shakopee, MN",
    repCode: "GD",
    pmCode: "JM",
    estimator: "Stephen Bazant",
    crewSize: 6,
    estimateHrs: 610,
    contractCents: 9_650_000,
    materialCostCents: 2_180_000,
    start: "2026-11-30",
    projectedFinish: "2026-12-11",
    firmness: "confirmed",
    retainagePct: 5,
    retainageRelease: "final_completion",
    requirements: ["Confined space"],
    note: "Food-safety orientation the first morning.",
  };
  it("job setup adds a job with its requirements and note; the contract split is frozen at the current rate", async () => {
    const r = await as(user("job_setup"), async (q) => {
      const { rows } = await q("select public.create_job($1) id", [payload]);
      return q(
        `select (select m.material_revenue_cents from public.job_money() m where m.job_id = j.id) material_revenue_cents, j.baseline_finish::text, j.projected_hrs,
                (select count(*) from public.job_requirements where job_id = j.id) reqs,
                (select pinned from public.job_notes where job_id = j.id) pinned
           from public.jobs j where j.id = $1`,
        [rows[0].id],
      );
    });
    expect(r.ok && r.rows[0]).toEqual({
      material_revenue_cents: String(Math.round((9_650_000 * 2_180_000) / (2_180_000 + 610 * 5500))),
      baseline_finish: "2026-12-11",
      projected_hrs: 610,
      reqs: "1",
      pinned: true,
    });
  });
  it("a sales rep can't add jobs", async () => {
    const r = await as(user("sales_rep"), (q) => q("select public.create_job($1)", [payload]));
    expect(r.ok).toBe(false);
  });
  it("retainage needs release terms", async () => {
    const r = await as(user("job_setup"), (q) => q("select public.create_job($1)", [{ ...payload, retainageRelease: null }]));
    expect(r.ok).toBe(false);
  });
  it("reps and PMs get company totals inputs with no names or money; leaders don't", async () => {
    const r = await as(user("sales_rep"), (q) => q("select public.company_load_inputs() x"));
    expect(r.ok).toBe(true);
    const x = r.ok && r.rows[0].x;
    expect(x.jobs).toHaveLength(sample.jobs.filter((j) => j.status !== "complete").length);
    expect(Object.keys(x.jobs[0]).sort()).toEqual(["actuals", "firmness", "overrides", "projectedFinish", "projectedHrs", "start", "status"]);
    expect(JSON.stringify(x)).not.toMatch(/customer|cents|name/i);
    const s = await as(user("superintendent"), (q) => q("select public.company_load_inputs()"));
    expect(s.ok).toBe(false);
  });
  it("first sign-in links a Microsoft account to the access an admin set up, by email", async () => {
    await db.query("insert into auth.users (id, email) values ('00000000-0000-4000-8fff-0000000000aa', 'new.pm@example.com')");
    await db.query("insert into public.app_users (email, name, role, pm_code) values ('new.pm@example.com', 'New PM', 'pm', 'LK')");
    const r = await asUser(db, "00000000-0000-4000-8fff-0000000000aa", "New.PM@example.com", (q) => q("select name, role from public.claim_app_user()"));
    expect(r.ok && r.rows).toEqual([{ name: "New PM", role: "pm" }]);
    const stranger = await asUser(db, "00000000-0000-4000-8fff-0000000000bb", "stranger@example.com", (q) => q("select * from public.claim_app_user()"));
    expect(stranger.ok && stranger.rows).toEqual([]);
  });
});
