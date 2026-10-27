/**
 * Live mode: reads and writes the Supabase database. Row-level security decides what each
 * request may see or change; this file only maps between the database and the screens.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { can, seesCompanyTotals } from "../domain/permissions";
import type { CloseInput, CloseResult } from "../domain/close";
import type { CheckpointDef, JourneyStage } from "../domain/journey";
import type { WorkOrder } from "../domain/workOrders";
import type { ChangeOrder, InvoiceKind, WipSnapshotRow } from "../domain/money";
import type { Alert, AlertRule, ChangeLogEntry, Dataset, IsoDate, Job, MyWeek, Person, Settings, TimeOff, Viewer } from "../domain/types";
import { DEFAULT_SETTINGS } from "../domain/types";
import type { AccessUser, LoadResult, NewJobInput, Repo } from "./repo";

type Row = Record<string, any>;

const JOB_MAP: Record<keyof Omit<Job, "requirements">, string> = {
  id: "id",
  number: "number",
  customer: "customer",
  jobType: "job_type",
  location: "location",
  repCode: "rep_code",
  pmCode: "pm_code",
  estimator: "estimator",
  leaderId: "leader_id",
  crewSize: "crew_size",
  estimateHrs: "estimate_hrs",
  projectedHrs: "projected_hrs",
  contractCents: "contract_cents",
  materialCostCents: "material_cost_cents",
  materialRevenueCents: "material_revenue_cents",
  burdenedRateCents: "burdened_rate_cents",
  start: "start",
  projectedFinish: "projected_finish",
  baselineFinish: "baseline_finish",
  mustFinish: "must_finish",
  mustFinishReason: "must_finish_reason",
  actualFinish: "actual_finish",
  status: "status",
  firmness: "firmness",
  waitsOnJobId: "waits_on_job_id",
  firmnessReason: "firmness_reason",
  holdReason: "hold_reason",
  holdUntil: "hold_until",
  exterior: "exterior",
  billingMethod: "billing_method",
  retainagePct: "retainage_pct",
  retainageRelease: "retainage_release",
  retainageReleaseNote: "retainage_release_note",
  customerPo: "customer_po",
  billTo: "bill_to",
  lienWaivers: "lien_waivers",
  certifiedPayroll: "certified_payroll",
  siteAddress: "site_address",
  siteStartTime: "site_start_time",
  siteContact: "site_contact",
  siteOrientation: "site_orientation",
  sitePpe: "site_ppe",
  active: "active",
};
const NUMERIC: (keyof Job)[] = ["contractCents", "materialCostCents", "materialRevenueCents", "burdenedRateCents", "retainagePct"];
/** Dollar columns on jobs. The database only serves them through job_money(), to the roles that see money. */
const MONEY_COLS = ["contract_cents", "material_cost_cents", "material_revenue_cents", "burdened_rate_cents"];
const JOB_SELECT = Object.values(JOB_MAP)
  .filter((c) => !MONEY_COLS.includes(c))
  .join(", ");

function rowToJob(r: Row, reqs: string[]): Job {
  const j = Object.fromEntries(Object.entries(JOB_MAP).map(([k, col]) => [k, r[col]])) as unknown as Job;
  for (const k of NUMERIC) (j as unknown as Record<string, number>)[k] = Number(r[JOB_MAP[k as keyof typeof JOB_MAP]] ?? 0);
  j.requirements = reqs;
  return j;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function check<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data;
}

export class SupabaseRepo implements Repo {
  readonly mode = "live" as const;
  private viewerName = "";
  private viewer: Viewer | null = null;
  constructor(private sb: SupabaseClient) {}

  async load(viewer: Viewer): Promise<LoadResult> {
    const sb = this.sb;
    this.viewerName = viewer.name;
    this.viewer = viewer;
    const officeRole = can.editCrewRecords(viewer.role);
    const [jobs, reqs, people, priv, quals, timeOff, overrides, actuals, assignments, notes, settings, reps, pms, qualList] = await Promise.all([
      sb.from("jobs").select(JOB_SELECT).eq("active", true),
      sb.from("job_requirements").select("job_id, qualification").eq("active", true),
      sb.from("people").select("id, name, kind, state, driver, active").order("name"),
      officeRole ? sb.from("people_private").select("person_id, phone, dot_expires") : Promise.resolve({ data: [], error: null }),
      sb.from("person_qualifications").select("person_id, qualification, expires").eq("active", true),
      officeRole ? sb.from("time_off").select("id, person_id, first_day, last_day, type, active").eq("active", true) : Promise.resolve({ data: [], error: null }),
      sb.from("plan_overrides").select("job_id, week, hours").eq("active", true),
      sb.from("actual_hours").select("job_id, week, hours").eq("active", true),
      sb.from("assignments").select("id, job_id, person_id, week").eq("active", true),
      sb.from("job_notes").select("id, job_id, body, pinned, crew_visible, author_name, created_at").eq("active", true).order("created_at"),
      sb.from("settings").select("key, value"),
      sb.from("sales_reps").select("code, name").eq("active", true).order("name"),
      sb.from("project_managers").select("code, name").eq("active", true).order("name"),
      sb.from("qualifications").select("name").eq("active", true).order("name"),
    ]);
    const office = can.editCrewRecords(viewer.role);
    const [closes, entries, confirmations, metrics, weeks] = await Promise.all([
      viewer.role === "field_crew" ? Promise.resolve({ data: [], error: null }) : sb.from("week_closes").select("week, entered, total_hrs, missing_job_ids, completed_job_ids").order("week"),
      sb.from("hour_entries").select("job_id, week, hours, source").eq("active", true),
      sb.from("crew_confirmations").select("job_id, week").eq("active", true),
      office ? sb.from("weekly_metrics").select("*").order("week") : Promise.resolve({ data: [], error: null }),
      sb.rpc("schedule_weeks"),
    ]);
    const [wos, signoffs, woEvents, stages, defs, marks, staff] = await Promise.all([
      sb.from("work_orders").select("*").eq("active", true),
      sb.from("work_order_signoffs").select("job_id, version, step, by_name, at"),
      sb.from("work_order_events").select("job_id, at, who, action, note").order("at", { ascending: false }),
      sb.from("journey_stages").select("*").order("sort"),
      sb.from("journey_checkpoints").select("*").order("sort"),
      sb.from("job_checkpoints").select("job_id, checkpoint_key, done_by, done_at").eq("active", true),
      sb.rpc("staff_names"),
    ]);
    const money = can.seeMoney(viewer.role);
    const none = Promise.resolve({ data: [], error: null });
    const [pcts, cos, mss, invs, rets] = await Promise.all([
      money ? sb.from("percent_complete").select("job_id, week, materials_pct, labor_pct, entered_by").order("week") : none,
      money ? sb.from("change_orders").select("*").eq("active", true).order("approved_on") : none,
      money ? sb.from("milestones").select("*").eq("active", true).order("sort") : none,
      money ? sb.from("invoices").select("*").eq("active", true).order("invoiced_on") : none,
      money ? sb.from("retainage_receipts").select("*").eq("active", true) : none,
    ]);
    const outs = ["admin", "ceo", "cfo", "scheduler", "pm", "superintendent"].includes(viewer.role)
      ? await sb.from("closeout_outcomes").select("*").order("finished_on", { ascending: false })
      : { data: [], error: null };
    const signBy = new Map<string, Row[]>();
    for (const r of check(signoffs) as Row[]) signBy.set(r.job_id, [...(signBy.get(r.job_id) ?? []), r]);
    const evBy = new Map<string, Row[]>();
    for (const r of check(woEvents) as Row[]) evBy.set(r.job_id, [...(evBy.get(r.job_id) ?? []), r]);
    const moneyBy = new Map<string, Row>(
      can.seeMoney(viewer.role) ? ((check(await sb.rpc("job_money")) as Row[]) ?? []).map((r) => [r.job_id, r]) : [],
    );
    const reqsBy = new Map<string, string[]>();
    for (const r of check(reqs) as Row[]) reqsBy.set(r.job_id, [...(reqsBy.get(r.job_id) ?? []), r.qualification]);
    const privBy = new Map((check(priv) as Row[]).map((r) => [r.person_id, r]));
    const qualsBy = new Map<string, Record<string, string | null>>();
    for (const r of check(quals) as Row[]) qualsBy.set(r.person_id, { ...(qualsBy.get(r.person_id) ?? {}), [r.qualification]: r.expires });
    const s: Settings = { ...DEFAULT_SETTINGS };
    for (const r of check(settings) as Row[]) if (r.key in s) (s as unknown as Record<string, unknown>)[r.key] = r.value;

    const ds: Dataset = {
      jobs: (check(jobs) as Row[]).map((r) => rowToJob({ ...r, ...moneyBy.get(r.id) }, reqsBy.get(r.id) ?? [])),
      people: (check(people) as Row[]).map(
        (r): Person => ({
          id: r.id,
          name: r.name,
          kind: r.kind,
          state: r.state,
          driver: r.driver,
          active: r.active,
          phone: privBy.get(r.id)?.phone ?? "",
          dotExpires: privBy.get(r.id)?.dot_expires ?? null,
          quals: qualsBy.get(r.id) ?? {},
        }),
      ),
      timeOff: (check(timeOff) as Row[]).map((r): TimeOff => ({ id: r.id, personId: r.person_id, firstDay: r.first_day, lastDay: r.last_day, type: r.type, active: r.active })),
      overrides: (check(overrides) as Row[]).map((r) => ({ jobId: r.job_id, week: r.week, hours: r.hours })),
      actuals: (check(actuals) as Row[]).map((r) => ({ jobId: r.job_id, week: r.week, hours: Number(r.hours) })),
      assignments: (check(assignments) as Row[]).map((r) => ({ id: r.id, jobId: r.job_id, personId: r.person_id, week: r.week })),
      notes: (check(notes) as Row[]).map((r) => ({ id: r.id, jobId: r.job_id, text: r.body, pinned: r.pinned, crewVisible: r.crew_visible, author: r.author_name, createdAt: r.created_at })),
      settings: s,
      qualifications: (check(qualList) as Row[]).map((r) => r.name),
      reps: (check(reps) as Row[]).map((r) => ({ code: r.code, name: r.name })),
      pms: (check(pms) as Row[]).map((r) => ({ code: r.code, name: r.name })),
      closes: (check(closes) as Row[]).map((r) => ({ week: r.week, entered: r.entered, totalHrs: Number(r.total_hrs), missingJobIds: r.missing_job_ids ?? [], completedJobIds: r.completed_job_ids ?? [] })),
      hourEntries: (check(entries) as Row[]).map((r) => ({ jobId: r.job_id, week: r.week, hours: Number(r.hours), source: r.source })),
      confirmations: (check(confirmations) as Row[]).map((r) => ({ jobId: r.job_id, week: r.week })),
      metrics: (check(metrics) as Row[]).map((r) => ({
        week: r.week,
        utilization: num(r.utilization),
        utilizationRoster: num(r.utilization_roster),
        backlogWeeks: num(r.backlog_weeks),
        backlogCents: num(r.backlog_cents),
        accuracy: num(r.accuracy),
        onTime: num(r.on_time),
        illustrative: r.illustrative,
      })),
      workOrders: (check(wos) as Row[]).map(
        (r): WorkOrder => ({
          jobId: r.job_id,
          version: r.version,
          currentStep: r.current_step,
          since: r.since,
          final: r.final,
          filed: r.filed,
          fileName: r.file_name,
          filePath: r.file_path,
          returned: r.returned_comment ? { by: r.returned_by, role: r.returned_role, comment: r.returned_comment, at: r.returned_at } : null,
          signoffs: (signBy.get(r.job_id) ?? []).filter((x) => x.version === r.version).map((x) => ({ step: x.step, by: x.by_name, at: x.at })),
          history: (evBy.get(r.job_id) ?? []).map((x) => ({ at: x.at, who: x.who, action: x.action, note: x.note })),
        }),
      ),
      stages: (check(stages) as Row[]).map((r) => ({ key: r.key, label: r.label, sort: r.sort, startup: r.startup, active: r.active })),
      checkpointDefs: (check(defs) as Row[]).map((r) => ({
        key: r.key,
        stageKey: r.stage_key,
        label: r.label,
        owner: r.owner,
        offsetDays: r.offset_days,
        anchor: r.anchor,
        autoSource: r.auto_source,
        sort: r.sort,
        active: r.active,
        appliesFrom: r.applies_from ?? null,
      })),
      jobCheckpoints: (check(marks) as Row[]).map((r) => ({ jobId: r.job_id, key: r.checkpoint_key, by: r.done_by, at: r.done_at })),
      staff: { schedulers: [], jobSetup: [], estimators: [], ...((check(staff) as Partial<Dataset["staff"]> | null) ?? {}) },
      percents: (check(pcts) as Row[]).map((r) => ({ jobId: r.job_id, week: r.week, materialsPct: Number(r.materials_pct), laborPct: Number(r.labor_pct), enteredBy: r.entered_by })),
      changeOrders: (check(cos) as Row[]).map((r) => ({
        id: r.id,
        jobId: r.job_id,
        number: r.number,
        description: r.description,
        amountCents: Number(r.amount_cents),
        materialCents: Number(r.material_cents),
        materialCostCents: Number(r.material_cost_cents),
        hours: r.hours,
        approvedOn: r.approved_on,
        approvedBy: r.approved_by ?? "",
      })),
      milestones: (check(mss) as Row[]).map((r) => ({ id: r.id, jobId: r.job_id, label: r.label, pct: Number(r.pct), sort: r.sort, reachedOn: r.reached_on, reachedBy: r.reached_by })),
      invoices: (check(invs) as Row[]).map((r) => ({
        id: r.id,
        jobId: r.job_id,
        kind: r.kind,
        period: r.period,
        milestoneId: r.milestone_id,
        number: r.number,
        amountCents: Number(r.amount_cents),
        retainageCents: Number(r.retainage_cents),
        paidOn: r.paid_on ?? null,
        invoicedOn: r.invoiced_on,
        recordedBy: r.recorded_by,
      })),
      retainageReceipts: (check(rets) as Row[]).map((r) => ({ id: r.id, jobId: r.job_id, amountCents: Number(r.amount_cents), receivedOn: r.received_on })),
      outcomes: (check(outs) as Row[]).map((r) => ({
        id: r.id,
        jobId: r.job_id,
        number: r.number,
        customer: r.customer,
        jobType: r.job_type,
        leaderId: r.leader_id,
        pmCode: r.pm_code,
        finishedOn: r.finished_on,
        estimateHrs: Number(r.estimate_hrs),
        actualHrs: Number(r.actual_hrs),
        contractCents: Number(r.contract_cents),
        gpBid: Number(r.gp_bid),
        gpFinal: Number(r.gp_final),
        onTime: r.on_time,
        cause: r.cause,
        illustrative: r.illustrative,
      })),
    };
    const w = check(weeks) as { planningWeek: string; weekToClose: string | null };

    let totals: Dataset | null = null;
    // Roles that can't read the crew's time off get capacity from the anonymous company totals.
    if (seesCompanyTotals(viewer.role) && !office) {
      totals = totalsDataset(check(await sb.rpc("company_load_inputs")) as CompanyInputs, s);
    }
    return { ds, totals, week: w.planningWeek, weekToClose: w.weekToClose };
  }

  async setPlanCell(jobId: string, week: IsoDate, hours: number | null) {
    if (hours === null) check(await this.sb.from("plan_overrides").update({ active: false }).eq("job_id", jobId).eq("week", week));
    else check(await this.sb.from("plan_overrides").upsert({ job_id: jobId, week, hours, active: true }));
  }

  async updateJob(jobId: string, patch: Partial<Job>) {
    const row: Row = {};
    for (const [k, v] of Object.entries(patch)) {
      if (k === "requirements" || k === "id" || k === "baselineFinish") continue;
      row[JOB_MAP[k as keyof typeof JOB_MAP]] = v;
    }
    if (Object.keys(row).length) {
      const res = check(await this.sb.from("jobs").update(row).eq("id", jobId).select("id"));
      if (!res?.length) throw new Error("You don't have permission to make that change.");
    }
    if (patch.requirements) {
      const cur = check(await this.sb.from("job_requirements").select("qualification, active").eq("job_id", jobId)) as Row[];
      for (const q of new Set([...patch.requirements, ...cur.map((r) => r.qualification)])) {
        const want = patch.requirements.includes(q);
        const have = cur.find((r) => r.qualification === q);
        if (want && !have) check(await this.sb.from("job_requirements").insert({ job_id: jobId, qualification: q }));
        else if (have && have.active !== want) check(await this.sb.from("job_requirements").update({ active: want }).eq("job_id", jobId).eq("qualification", q));
      }
    }
  }

  async createJob(input: NewJobInput): Promise<string> {
    return check(await this.sb.rpc("create_job", { p: input })) as string;
  }

  async assign(jobId: string, personId: string, week: IsoDate) {
    check(await this.sb.from("assignments").upsert({ job_id: jobId, person_id: personId, week, active: true }, { onConflict: "job_id,person_id,week" }));
  }

  async unassign(jobId: string, personId: string, week: IsoDate) {
    check(await this.sb.from("assignments").update({ active: false }).eq("job_id", jobId).eq("person_id", personId).eq("week", week));
  }

  async addNote(jobId: string, text: string, pinned: boolean, crewVisible: boolean) {
    check(await this.sb.from("job_notes").insert({ job_id: jobId, body: text, pinned, crew_visible: crewVisible, author_name: this.viewerName }));
  }

  async setNotePinned(noteId: string, pinned: boolean) {
    check(await this.sb.from("job_notes").update({ pinned }).eq("id", noteId));
  }

  async addTimeOff(personId: string, firstDay: IsoDate, lastDay: IsoDate, type: TimeOff["type"]) {
    check(await this.sb.from("time_off").insert({ person_id: personId, first_day: firstDay, last_day: lastDay, type }));
  }

  async removeTimeOff(id: string) {
    check(await this.sb.from("time_off").update({ active: false }).eq("id", id));
  }

  async addPerson(p: Parameters<Repo["addPerson"]>[0]) {
    const row = check(await this.sb.from("people").insert({ name: p.name, kind: p.kind, state: p.state, driver: p.driver }).select("id").single()) as Row;
    check(await this.sb.from("people_private").insert({ person_id: row.id, phone: p.phone, dot_expires: p.dotExpires }));
  }

  async updatePerson(id: string, patch: Parameters<Repo["updatePerson"]>[1]) {
    const { phone, dotExpires, ...rest } = patch;
    if (Object.keys(rest).length) check(await this.sb.from("people").update(rest).eq("id", id));
    if (phone !== undefined || dotExpires !== undefined) {
      const priv: Row = { person_id: id };
      if (phone !== undefined) priv.phone = phone;
      if (dotExpires !== undefined) priv.dot_expires = dotExpires;
      check(await this.sb.from("people_private").upsert(priv));
    }
  }

  async setQualification(personId: string, qualification: string, has: boolean, expires: IsoDate | null) {
    check(await this.sb.from("person_qualifications").upsert({ person_id: personId, qualification, expires, active: has }));
  }

  async updateSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    const res = check(await this.sb.from("settings").update({ value }).eq("key", key).select("key"));
    if (!res?.length) throw new Error("You don't have permission to make that change.");
  }

  async listUsers(): Promise<AccessUser[]> {
    const rows = check(await this.sb.from("app_users").select("*").order("name")) as Row[];
    return rows.map((r) => ({ id: r.id, email: r.email, name: r.name, role: r.role, personId: r.person_id, repCode: r.rep_code, pmCode: r.pm_code, active: r.active, linked: !!r.auth_user_id, alsoEstimator: !!r.also_estimator }));
  }

  async saveUser(u: Parameters<Repo["saveUser"]>[0]) {
    const row = { email: u.email.trim().toLowerCase(), name: u.name, role: u.role, person_id: u.personId, rep_code: u.repCode, pm_code: u.pmCode, active: u.active, also_estimator: u.alsoEstimator };
    if (u.id) check(await this.sb.from("app_users").update(row).eq("id", u.id));
    else check(await this.sb.from("app_users").insert(row));
  }

  async changeLog(jobId?: string): Promise<ChangeLogEntry[]> {
    let q = this.sb.from("change_log").select("*").order("at", { ascending: false }).limit(jobId ? 50 : 300);
    if (jobId) q = q.eq("job_id", jobId);
    return (check(await q) as Row[]).map((r) => ({
      id: String(r.id),
      at: r.at,
      who: r.user_name,
      table: r.table_name,
      recordId: r.record_id,
      recordLabel: r.record_label,
      field: r.field,
      oldValue: r.old_value,
      newValue: r.new_value,
    }));
  }

  async saveHourEntry(jobId: string, week: IsoDate, hours: number | null, source: "typed" | "csv" | "import") {
    if (hours === null) check(await this.sb.from("hour_entries").update({ active: false }).eq("job_id", jobId).eq("week", week));
    else check(await this.sb.from("hour_entries").upsert({ job_id: jobId, week, hours, source, active: true }));
  }

  async closeWeek(input: CloseInput): Promise<CloseResult> {
    return check(await this.sb.rpc("close_week", { p: input })) as CloseResult;
  }

  async alerts(): Promise<Alert[]> {
    const rows = check(await this.sb.from("alerts").select("*").order("at", { ascending: false }).limit(200)) as Row[];
    return rows.map((r) => ({ id: r.id, at: r.at, rule: r.rule, title: r.title, body: r.body, recipients: r.recipients, jobId: r.job_id, personId: r.person_id }));
  }

  async mutedRules(): Promise<AlertRule[]> {
    return (check(await this.sb.from("alert_mutes").select("rule, muted")) as Row[]).filter((r) => r.muted).map((r) => r.rule);
  }

  async setMuted(rule: AlertRule, muted: boolean) {
    check(await this.sb.from("alert_mutes").upsert({ user_id: this.viewer?.userId, rule, muted }));
  }

  async postDigest(title: string, body: string) {
    check(await this.sb.rpc("post_digest", { p_title: title, p_body: body }));
  }

  async nudgeHours(pmCode: string, week: IsoDate) {
    return check(await this.sb.rpc("nudge_hours", { p_pm: pmCode, p_week: week })) as number;
  }

  async confirmMyCrews(): Promise<number> {
    return check(await this.sb.rpc("confirm_my_crews")) as number;
  }

  async myWeek(): Promise<MyWeek | null> {
    return check(await this.sb.rpc("my_week")) as MyWeek | null;
  }

  async acknowledgeWeek(week: IsoDate) {
    check(await this.sb.rpc("acknowledge_week", { p_week: week }));
  }

  async woUpload(jobId: string, file: File | null, fileName: string) {
    let path: string | null = null;
    if (file) {
      path = `${jobId}/${Date.now()}-${fileName.replace(/[^\w.\- ]+/g, "_")}`;
      const up = await this.sb.storage.from("work-orders").upload(path, file, { upsert: false, contentType: file.type || undefined });
      if (up.error) throw up.error;
    }
    check(await this.sb.rpc("wo_upload", { p_job: jobId, p_file_name: fileName, p_file_path: path }));
  }

  async woApprove(jobId: string) {
    check(await this.sb.rpc("wo_approve", { p_job: jobId }));
  }

  async woReturn(jobId: string, comment: string) {
    check(await this.sb.rpc("wo_return", { p_job: jobId, p_comment: comment }));
  }

  async woRemind(jobId: string) {
    check(await this.sb.rpc("wo_remind", { p_job: jobId }));
  }

  async woMarkFiled(jobId: string) {
    check(await this.sb.rpc("wo_mark_filed", { p_job: jobId }));
  }

  async woFileUrl(jobId: string): Promise<string | null> {
    const row = check(await this.sb.from("work_orders").select("file_path").eq("job_id", jobId).maybeSingle()) as Row | null;
    if (!row?.file_path) return null;
    const { data, error } = await this.sb.storage.from("work-orders").createSignedUrl(row.file_path, 300);
    if (error) throw error;
    return data.signedUrl;
  }

  async setCheckpoint(jobId: string, key: string, done: boolean) {
    check(await this.sb.rpc("set_checkpoint", { p_job: jobId, p_key: key, p_done: done }));
  }

  async saveStage(s: JourneyStage, isNew: boolean) {
    const row = { key: s.key, label: s.label, sort: s.sort, startup: s.startup, active: s.active };
    if (isNew) check(await this.sb.from("journey_stages").insert(row));
    else check(await this.sb.from("journey_stages").update(row).eq("key", s.key));
  }

  async saveCheckpointDef(d: CheckpointDef, isNew: boolean) {
    const row = { key: d.key, stage_key: d.stageKey, label: d.label, owner: d.owner, offset_days: d.offsetDays, anchor: d.anchor, sort: d.sort, active: d.active };
    if (isNew) check(await this.sb.from("journey_checkpoints").insert(row));
    else check(await this.sb.from("journey_checkpoints").update(row).eq("key", d.key));
  }

  async recordPercent(jobId: string, materialsPct: number, laborPct: number) {
    check(await this.sb.rpc("record_percent", { p_job: jobId, p_materials: materialsPct, p_labor: laborPct }));
  }

  async addChangeOrder(co: Omit<ChangeOrder, "id">) {
    check(await this.sb.rpc("add_change_order", { p: co }));
  }

  async setBillingMethod(jobId: string, method: Job["billingMethod"]) {
    check(await this.sb.rpc("set_billing_method", { p_job: jobId, p_method: method }));
  }

  async saveMilestones(jobId: string, items: { id?: string; label: string; pct: number }[]) {
    check(await this.sb.rpc("save_milestones", { p_job: jobId, p_items: items }));
  }

  async markMilestoneReached(milestoneId: string) {
    check(await this.sb.rpc("mark_milestone_reached", { p_milestone: milestoneId }));
  }

  async recordInvoice(inv: { jobId: string; kind: InvoiceKind; period?: string; milestoneId?: string; number?: string; amountCents?: number }) {
    check(await this.sb.rpc("record_invoice", { p: inv }));
  }

  async recordPayment(invoiceId: string, paidOn?: IsoDate) {
    check(await this.sb.rpc("record_payment", { p_invoice: invoiceId, p_paid_on: paidOn ?? null }));
  }

  async wipSnapshots(): Promise<WipSnapshotRow[]> {
    const rows = check(await this.sb.from("wip_snapshots").select("*").order("month", { ascending: false }).order("number")) as Row[];
    return rows.map((r) => ({
      month: r.month,
      jobId: r.job_id,
      number: r.number,
      customer: r.customer,
      pmCode: r.pm_code,
      contractCents: Number(r.contract_cents),
      materialsPct: r.materials_pct,
      laborPct: r.labor_pct,
      recognizedCents: Number(r.recognized_cents),
      billedCents: Number(r.billed_cents),
      overUnderCents: Number(r.over_under_cents),
      costToCompleteCents: Number(r.cost_to_complete_cents),
      gpBid: Number(r.gp_bid),
      gpNow: Number(r.gp_now),
      retainageCents: Number(r.retainage_cents),
      takenAt: r.taken_at,
      takenBy: r.taken_by,
    }));
  }

  async takeWipSnapshot(month: string) {
    return check(await this.sb.rpc("take_wip_snapshot", { p_month: month })) as number;
  }

  async recordRetainageReceived(jobId: string, amountCents?: number) {
    check(await this.sb.rpc("record_retainage_received", { p_job: jobId, p_amount: amountCents ?? null }));
  }

  async companyRevenueTotals() {
    return check(await this.sb.rpc("company_revenue_totals")) as { remainingCents: number; netBillingCents: number; reviewCount: number };
  }

  async tagCause(outcomeId: string, cause: string | null) {
    check(await this.sb.rpc("tag_closeout_cause", { p_outcome: outcomeId, p_cause: cause }));
  }

  async boardCounts() {
    return check(await this.sb.rpc("board_counts")) as { changes: number; alerts: number; digests: number; closes: number; acknowledgments: number };
  }
}

interface CompanyInputs {
  jobs: { projectedHrs: number; start: string; projectedFinish: string; status: Job["status"]; firmness: Job["firmness"]; actuals: { week: string; hours: number }[]; overrides: { week: string; hours: number }[] }[];
  people: { kind: Person["kind"]; timeOff: [string, string][] }[];
}

/** Rebuild just enough of a dataset from the anonymous company inputs to run the totals math. */
export function totalsDataset(x: CompanyInputs, settings: Settings): Dataset {
  const jobs: Job[] = x.jobs.map((j, i) => ({
    ...blankJob,
    id: "t" + i,
    number: "0000",
    projectedHrs: j.projectedHrs,
    start: j.start,
    projectedFinish: j.projectedFinish,
    baselineFinish: j.projectedFinish,
    status: j.status,
    firmness: j.firmness,
  }));
  return {
    jobs,
    actuals: x.jobs.flatMap((j, i) => j.actuals.map((a) => ({ jobId: "t" + i, week: a.week, hours: Number(a.hours) }))),
    overrides: x.jobs.flatMap((j, i) => j.overrides.map((o) => ({ jobId: "t" + i, week: o.week, hours: o.hours }))),
    people: x.people.map((p, i) => ({ id: "p" + i, name: "", kind: p.kind, state: "", phone: "", driver: false, dotExpires: null, active: true, quals: {} })),
    timeOff: x.people.flatMap((p, i) => p.timeOff.map(([a, b], k) => ({ id: `t${i}-${k}`, personId: "p" + i, firstDay: a, lastDay: b, type: "Other" as const, active: true }))),
    assignments: [],
    notes: [],
    settings,
    qualifications: [],
    reps: [],
    pms: [],
    closes: [],
    hourEntries: [],
    confirmations: [],
    metrics: [],
    workOrders: [],
    stages: [],
    checkpointDefs: [],
    jobCheckpoints: [],
    staff: { schedulers: [], jobSetup: [], estimators: [] },
    percents: [],
    changeOrders: [],
    milestones: [],
    invoices: [],
    retainageReceipts: [],
    outcomes: [],
  };
}

const blankJob: Omit<Job, "id" | "number" | "projectedHrs" | "start" | "projectedFinish" | "baselineFinish" | "status"> = {
  customer: "",
  jobType: "",
  location: "",
  repCode: "",
  pmCode: "",
  estimator: "",
  leaderId: null,
  crewSize: 1,
  estimateHrs: 0,
  contractCents: 0,
  materialCostCents: 0,
  materialRevenueCents: 0,
  burdenedRateCents: 0,
  mustFinish: null,
  mustFinishReason: null,
  actualFinish: null,
  firmness: "confirmed",
  waitsOnJobId: null,
  firmnessReason: null,
  holdReason: null,
  holdUntil: null,
  exterior: false,
  billingMethod: "final",
  retainagePct: 0,
  retainageRelease: null,
  retainageReleaseNote: null,
  customerPo: "",
  billTo: "",
  lienWaivers: false,
  certifiedPayroll: false,
  requirements: [],
  siteAddress: "",
  siteStartTime: "",
  siteContact: "",
  siteOrientation: "",
  sitePpe: "",
  active: true,
};
