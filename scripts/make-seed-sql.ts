/**
 * Writes supabase/seed.sql from the sample data (sample data only, hard rule 1).
 * The dates line up with the week it is run in:  npm run db:seed-sql
 */
import { writeFileSync } from "node:fs";
import { buildSample } from "../src/sample/seed";
import { currentWeek } from "../src/domain/weeks";

export function seedSql(week: string): string {
  const s = buildSample(week);
  const q = (v: unknown): string => {
    if (v === null || v === undefined) return "null";
    if (typeof v === "number") return String(v);
    if (typeof v === "boolean") return v ? "true" : "false";
    return "'" + String(v).replace(/'/g, "''") + "'";
  };
  const rows = (table: string, cols: string[], data: unknown[][]) =>
    data.length ? `insert into public.${table} (${cols.join(", ")}) values\n${data.map((r) => "  (" + r.map(q).join(", ") + ")").join(",\n")};\n` : "";

  const out: string[] = [`-- Sample data generated for the week ending ${week}. Invented names and numbers only.\n`, "set app.seeding = 'on';\n"];
  out.push(rows("sales_reps", ["code", "name"], s.reps.map((r) => [r.code, r.name])));
  out.push(rows("project_managers", ["code", "name"], s.pms.map((r) => [r.code, r.name])));
  out.push(rows("qualifications", ["name"], s.qualifications.map((n) => [n])));
  out.push(rows("people", ["id", "name", "kind", "state", "driver", "active"], s.people.map((p) => [p.id, p.name, p.kind, p.state, p.driver, p.active])));
  out.push(rows("people_private", ["person_id", "phone", "dot_expires"], s.people.map((p) => [p.id, p.phone, p.dotExpires])));
  out.push(
    rows(
      "person_qualifications",
      ["person_id", "qualification", "expires"],
      s.people.flatMap((p) => Object.entries(p.quals).map(([k, v]) => [p.id, k, v])),
    ),
  );
  out.push(rows("time_off", ["id", "person_id", "first_day", "last_day", "type"], s.timeOff.map((t) => [t.id, t.personId, t.firstDay, t.lastDay, t.type])));
  const jobCols = [
    "id", "number", "customer", "job_type", "location", "rep_code", "pm_code", "estimator", "leader_id", "crew_size",
    "estimate_hrs", "projected_hrs", "contract_cents", "material_cost_cents", "material_revenue_cents", "start",
    "projected_finish", "baseline_finish", "must_finish", "must_finish_reason", "status", "firmness", "waits_on_job_id",
    "hold_reason", "hold_until", "exterior", "billing_method", "retainage_pct", "retainage_release",
    "site_address", "site_start_time", "site_contact", "site_orientation", "site_ppe",
    "actual_finish", "customer_po", "bill_to", "lien_waivers", "certified_payroll",
  ];
  // Predecessors first so waits_on_job_id resolves.
  const jobs = [...s.jobs].sort((a, b) => (a.waitsOnJobId ? 1 : 0) - (b.waitsOnJobId ? 1 : 0));
  out.push(
    rows(
      "jobs",
      jobCols,
      jobs.map((j) => [
        j.id, j.number, j.customer, j.jobType, j.location, j.repCode, j.pmCode, j.estimator, j.leaderId, j.crewSize,
        j.estimateHrs, j.projectedHrs, j.contractCents, j.materialCostCents, j.materialRevenueCents, j.start,
        j.projectedFinish, j.baselineFinish, j.mustFinish, j.mustFinishReason, j.status, j.firmness, j.waitsOnJobId,
        j.holdReason, j.holdUntil, j.exterior, j.billingMethod, j.retainagePct, j.retainageRelease,
        j.siteAddress, j.siteStartTime, j.siteContact, j.siteOrientation, j.sitePpe,
        j.actualFinish, j.customerPo, j.billTo, j.lienWaivers, j.certifiedPayroll,
      ]),
    ),
  );
  out.push(rows("job_requirements", ["job_id", "qualification"], s.jobs.flatMap((j) => j.requirements.map((r) => [j.id, r]))));
  out.push(
    rows(
      "job_notes",
      ["id", "job_id", "body", "pinned", "crew_visible", "author_name"],
      s.notes.map((n) => [n.id, n.jobId, n.text, n.pinned, n.crewVisible, n.author]),
    ),
  );
  out.push(rows("actual_hours", ["job_id", "week", "hours", "source"], s.actuals.map((a) => [a.jobId, a.week, a.hours, "import"])));
  out.push(rows("assignments", ["id", "job_id", "person_id", "week"], s.assignments.map((a) => [a.id, a.jobId, a.personId, a.week])));
  out.push(
    rows(
      "app_users",
      ["id", "email", "name", "role", "person_id", "rep_code", "pm_code"],
      s.users.map((u) => [u.userId, u.email, u.name, u.role, u.personId, u.repCode, u.pmCode]),
    ),
  );
  out.push(
    rows(
      "week_closes",
      ["week", "entered", "total_hrs"],
      s.closes.map((c) => [c.week, c.entered, c.totalHrs]),
    ),
  );
  out.push(
    rows(
      "weekly_metrics",
      ["week", "utilization", "utilization_roster", "backlog_weeks", "accuracy", "on_time", "illustrative"],
      s.metrics.map((m) => [m.week, m.utilization, m.utilizationRoster, m.backlogWeeks, m.accuracy, m.onTime, m.illustrative]),
    ),
  );
  out.push(rows("forecast_snapshots", ["made_week", "target_week", "job_id", "hours"], s.snapshots.map((x) => [x.madeWeek, x.targetWeek, x.jobId, x.hours])));
  // Work orders were opened by the job trigger; set them to the sample's states.
  for (const w of s.workOrders) {
    out.push(
      `update public.work_orders set version = ${w.version}, current_step = ${w.currentStep}, since = ${q(w.since)}, final = ${w.final}, filed = ${w.filed}, ` +
        `file_name = ${q(w.fileName)}, returned_by = ${q(w.returned?.by)}, returned_role = ${q(w.returned?.role)}, returned_comment = ${q(w.returned?.comment)}, ` +
        `returned_at = ${q(w.returned?.at)} where job_id = ${q(w.jobId)};`,
    );
  }
  out.push(
    rows(
      "work_order_signoffs",
      ["job_id", "version", "step", "by_name", "at"],
      s.workOrders.flatMap((w) => w.signoffs.map((x) => [w.jobId, w.version, x.step, x.by, x.at])),
    ),
  );
  out.push(
    rows(
      "work_order_events",
      ["job_id", "at", "who", "action", "note"],
      s.workOrders.flatMap((w) => w.history.map((h) => [w.jobId, h.at, h.who, h.action, h.note])),
    ),
  );
  out.push(rows("job_checkpoints", ["job_id", "checkpoint_key", "done_by", "done_at"], s.jobCheckpoints.map((c) => [c.jobId, c.key, c.by, c.at])));
  out.push(rows("percent_complete", ["job_id", "week", "materials_pct", "labor_pct", "entered_by"], s.percents.map((x) => [x.jobId, x.week, x.materialsPct, x.laborPct, x.enteredBy])));
  out.push(
    rows(
      "milestones",
      ["id", "job_id", "label", "pct", "sort", "reached_on", "reached_by"],
      s.milestones.map((m) => [m.id, m.jobId, m.label, m.pct, m.sort, m.reachedOn, m.reachedBy]),
    ),
  );
  out.push(
    rows(
      "invoices",
      ["id", "job_id", "kind", "period", "milestone_id", "number", "amount_cents", "retainage_cents", "invoiced_on", "recorded_by"],
      s.invoices.map((i) => [i.id, i.jobId, i.kind, i.period, i.milestoneId, i.number, i.amountCents, i.retainageCents, i.invoicedOn, i.recordedBy]),
    ),
  );
  out.push(rows("retainage_receipts", ["id", "job_id", "amount_cents", "received_on", "recorded_by"], s.retainageReceipts.map((r) => [r.id, r.jobId, r.amountCents, r.receivedOn, "Accounting"])));
  out.push(
    rows(
      "closeout_outcomes",
      ["id", "job_id", "number", "customer", "job_type", "leader_id", "pm_code", "finished_on", "estimate_hrs", "actual_hrs", "contract_cents", "gp_bid", "gp_final", "on_time", "cause", "illustrative"],
      s.outcomes.map((o) => [o.id, o.jobId, o.number, o.customer, o.jobType, o.leaderId, o.pmCode, o.finishedOn, o.estimateHrs, o.actualHrs, o.contractCents, Math.round(o.gpBid * 10000) / 10000, Math.round(o.gpFinal * 10000) / 10000, o.onTime, o.cause, o.illustrative]),
    ),
  );
  out.push("reset app.seeding;\nselect app.capacity_check();\nselect app.cert_reminders();\nselect app.wo_check();\nselect app.bill_check();\n");
  return out.join("\n");
}

if (process.argv[1]?.endsWith("make-seed-sql.ts")) {
  const week = process.argv[2] ?? currentWeek();
  writeFileSync(new URL("../supabase/seed.sql", import.meta.url), seedSql(week));
  console.log(`Wrote supabase/seed.sql for the week ending ${week}`);
}
