/**
 * Sample mode: the app on invented data held in this browser, with a "Viewing as" picker.
 * It applies the same permission rules as the database, so what a role can do here is what
 * it can do in production. It never talks to a server.
 */
import { JOB_COLUMNS, can, canEditJob, canSeeJob, seesCompanyTotals, type JobField } from "../domain/permissions";
import { jobProblem } from "../domain/jobRules";
import { canSeeAlert, capacityAlerts, certAlerts, jobChangeAlerts, overrunAlert, type NewAlert } from "../domain/alerts";
import { closeRows, forecastAccuracy, type CloseInput, type CloseResult } from "../domain/close";
import { allPlans, buildIndex, capacity, hoursLeft, inWindow, isSold, materialRevenueCents } from "../domain/schedule";
import { backlogCents, digestLines, digestTitle } from "../domain/insights";
import { canCheck, type CheckpointDef } from "../domain/journey";
import { WO_STEPS, stepWho, woCanFile, woCanSign, woCanUpload, woIsMine, woStatus, type Names, type WorkOrder } from "../domain/workOrders";
import type { Alert, AlertRule, ChangeLogEntry, Dataset, IsoDate, Job, MyWeek, Settings, Viewer } from "../domain/types";
import { addDays, currentWeek, fmtShort, mondayOf, planningWeek, todayIn, weekList, weekToClose } from "../domain/weeks";
import { buildSample, type SampleData } from "../sample/seed";
import type { AccessUser, LoadResult, NewJobInput, Repo } from "./repo";

const KEY = "tmi-ops-sample-v2";

const uid = () => crypto.randomUUID();
const denied = () => new Error("You don't have permission to make that change.");
const show = (v: unknown) => (v === null || v === undefined || v === "" ? null : Array.isArray(v) ? v.join(", ") : String(v));

interface Stored {
  week: IsoDate;
  data: SampleData;
  log: ChangeLogEntry[];
  alerts: Alert[];
  alertState: Record<string, string>;
  mutes: Record<string, AlertRule[]>;
  acks: Record<string, string>;
}

export class SampleRepo implements Repo {
  readonly mode = "sample" as const;
  private s: Stored;
  private viewer: Viewer | null = null;

  constructor(private storage: Storage | null = safeStorage()) {
    this.s = this.read() ?? this.fresh();
  }

  /** Who is "signed in" for the sample. */
  users(): Viewer[] {
    return this.s.data.users.filter((u) => u.active);
  }
  setViewer(v: Viewer) {
    this.viewer = v;
  }
  reset() {
    this.s = this.fresh();
    this.save();
  }

  private fresh(): Stored {
    const week = currentWeek();
    const s: Stored = { week, data: buildSample(week, todayIn(new Date())), log: [], alerts: [], alertState: {}, mutes: {}, acks: {} };
    this.s = s;
    this.checks();
    this.push(certAlerts(s.data, this.week(), s.alertState));
    const ds = s.data;
    const idx = buildIndex(ds);
    this.push([{ rule: "digest", title: digestTitle(this.week()), body: digestLines(ds, idx, allPlans(ds, idx, this.week()), this.week()).join("\n"), recipients: ["Leadership team"], jobId: null, personId: null }]);
    for (const a of s.alerts) a.at = mondayOf(this.week()) + "T11:00:00Z";
    return s;
  }
  /** The week the schedule plans from: after a close it moves on even if the calendar hasn't. */
  week(): IsoDate {
    return planningWeek(this.s.data.closes.map((c) => c.week), todayIn(new Date()));
  }
  private push(list: NewAlert[]) {
    const at = new Date().toISOString();
    this.s.alerts.unshift(...list.map((a) => ({ ...a, id: uid(), at })));
  }
  /** Capacity gap and open-capacity checks after every change, as the database triggers do. */
  private checks() {
    const ds = this.s.data;
    const idx = buildIndex(ds);
    this.push(capacityAlerts(ds, idx, allPlans(ds, idx, this.week()), this.week(), this.s.alertState));
    this.woCheck();
  }
  private names(): Names {
    const d = this.s.data;
    return {
      rep: (c) => d.reps.find((r) => r.code === c)?.name ?? c,
      pm: (c) => d.pms.find((r) => r.code === c)?.name ?? c,
      schedulers: d.staff.schedulers,
      jobSetup: d.staff.jobSetup,
    };
  }
  /** A work order step past its deadline pings the PM, once per step (the database's wo_check). */
  private woCheck() {
    const d = this.s.data;
    const today = todayIn(new Date());
    const n = this.names();
    for (const w of d.workOrders) {
      const j = d.jobs.find((x) => x.id === w.jobId);
      if (!j || j.status === "complete" || w.final) continue;
      const days = Math.round((Date.parse(today) - Date.parse(w.since)) / 864e5);
      if (days <= d.settings.woReviewDays) continue;
      const st = woStatus(w);
      const key = `wo|${j.id}|${w.since}|${st}|${w.currentStep}`;
      if (this.s.alertState[key]) continue;
      this.s.alertState[key] = "sent";
      const lori = st === "Awaiting draft" || st === "Returned";
      const who = lori ? n.jobSetup.join(", ") : stepWho(j, w.currentStep, n);
      const what = st === "Awaiting draft" ? "the draft" : st === "Returned" ? "the revised draft" : WO_STEPS[w.currentStep].what.toLowerCase();
      this.push([
        {
          rule: "wo",
          title: `Work order review late: ${j.number} ${j.customer}`,
          body: `Waiting ${days} days on ${who} for ${what}. The review deadline is ${d.settings.woReviewDays} days.\nJob starts ${fmtShort(j.start)}. PM ${n.pm(j.pmCode)} pinged.`,
          recipients: [n.pm(j.pmCode), ...(lori ? n.jobSetup : [who])],
          jobId: j.id,
          personId: null,
        },
      ]);
    }
  }
  private woEvent(w: WorkOrder, action: string, note = "") {
    w.history.unshift({ at: new Date().toISOString(), who: this.me().name, action, note });
  }
  private wo(jobId: string): { j: Job; w: WorkOrder } {
    const j = this.job(jobId);
    const w = this.d.workOrders.find((x) => x.jobId === jobId);
    if (!w) throw new Error("This job has no work order.");
    return { j, w };
  }
  private read(): Stored | null {
    try {
      const raw = this.storage?.getItem(KEY);
      if (!raw) return null;
      const s = JSON.parse(raw) as Stored;
      // Sample dates are built around the week they were made; start over when the week rolls.
      return s.week === currentWeek() ? s : null;
    } catch {
      return null;
    }
  }
  private save() {
    this.checks();
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.s));
    } catch {
      /* private window or storage full: the sample still works for this visit */
    }
  }
  private me(): Viewer {
    if (!this.viewer) throw new Error("Pick who you're viewing as.");
    return this.viewer;
  }
  private get d() {
    return this.s.data;
  }
  private job(id: string) {
    const j = this.d.jobs.find((x) => x.id === id);
    if (!j || !canSeeJob(this.me(), j)) throw denied();
    return j;
  }
  private log(table: string, recordId: string, recordLabel: string, field: string, oldValue: unknown, newValue: unknown) {
    this.s.log.unshift({
      id: uid(),
      at: new Date().toISOString(),
      who: this.me().name,
      table,
      recordId,
      recordLabel,
      field,
      oldValue: show(oldValue),
      newValue: show(newValue),
    });
  }
  private personName(id: string) {
    return this.d.people.find((p) => p.id === id)?.name ?? "";
  }

  async load(viewer: Viewer): Promise<LoadResult> {
    this.viewer = viewer;
    const d = structuredClone(this.d);
    const office = can.editCrewRecords(viewer.role);
    const visible = new Set(d.jobs.filter((j) => canSeeJob(viewer, j)).map((j) => j.id));
    const ds: Dataset = {
      ...d,
      jobs: d.jobs.filter((j) => visible.has(j.id)),
      overrides: d.overrides.filter((o) => visible.has(o.jobId)),
      actuals: d.actuals.filter((a) => visible.has(a.jobId)),
      assignments: d.assignments.filter((a) => visible.has(a.jobId)),
      notes: d.notes.filter((n) => visible.has(n.jobId)),
      timeOff: office ? d.timeOff : [],
      people: viewer.role === "field_crew" ? [] : d.people.map((p) => (office ? p : { ...p, phone: "", dotExpires: null })),
    };
    const office2 = ["admin", "ceo", "cfo", "scheduler"].includes(viewer.role);
    ds.hourEntries = d.hourEntries.filter((e) => visible.has(e.jobId));
    ds.confirmations = d.confirmations.filter((c) => visible.has(c.jobId));
    ds.metrics = office2 ? d.metrics : [];
    ds.workOrders = d.workOrders.filter((w) => visible.has(w.jobId));
    ds.jobCheckpoints = d.jobCheckpoints.filter((c) => visible.has(c.jobId));
    if (viewer.role === "field_crew") ds.closes = [];
    const sawAll = visible.size === d.jobs.length;
    const totals = seesCompanyTotals(viewer.role) && !sawAll ? { ...d, jobs: d.jobs.filter((j) => j.status !== "complete") } : null;
    const closed = this.d.closes.map((c) => c.week);
    const today = todayIn(new Date());
    return { ds, totals, week: planningWeek(closed, today), weekToClose: weekToClose(closed, today) };
  }

  async setPlanCell(jobId: string, week: IsoDate, hours: number | null) {
    const j = this.job(jobId);
    if (!canEditJob(this.me(), j, "plan")) throw denied();
    const i = this.d.overrides.findIndex((o) => o.jobId === jobId && o.week === week);
    const old = i >= 0 ? this.d.overrides[i].hours : null;
    if (hours === null) {
      if (i >= 0) this.d.overrides.splice(i, 1);
    } else if (i >= 0) this.d.overrides[i].hours = hours;
    else this.d.overrides.push({ jobId, week, hours });
    this.log("plan_overrides", jobId + "|" + week, "Job " + j.number, "hours, week ending " + week, old ?? "auto", hours ?? "auto");
    this.save();
  }

  async updateJob(jobId: string, patch: Partial<Job>) {
    const v = this.me();
    const j = this.job(jobId);
    const next: Job = { ...j, ...patch, baselineFinish: j.baselineFinish };
    const changed = (Object.keys(patch) as (keyof Job)[]).filter((k) => JSON.stringify(j[k]) !== JSON.stringify(next[k]));
    for (const k of changed) {
      const group = (Object.keys(JOB_COLUMNS) as (keyof typeof JOB_COLUMNS)[]).find((g) => JOB_COLUMNS[g].includes(k));
      if (!group || !canEditJob(v, j, group as JobField)) throw new Error(`You can't change ${k} on job ${j.number}.`);
    }
    const problem = jobProblem(j, next);
    if (problem) throw new Error(problem);
    if (changed.includes("number") && this.d.jobs.some((x) => x.id !== j.id && x.number === next.number)) throw new Error("That job number is already on the schedule.");
    for (const k of changed) this.log("jobs", j.id, "Job " + j.number, k, j[k], next[k]);
    if (changed.includes("firmness") && next.firmnessReason?.trim() && next.firmnessReason !== j.firmnessReason) {
      this.d.notes.push({
        id: uid(),
        jobId,
        text: `Firmness ${j.firmness} → ${next.firmness}: ${next.firmnessReason}`,
        pinned: j.firmness === "locked",
        crewVisible: false,
        author: v.name,
        createdAt: new Date().toISOString(),
      });
    }
    const before = { ...j };
    Object.assign(j, next);
    this.push(jobChangeAlerts(this.d, before, j, v.name));
    this.save();
  }

  async createJob(input: NewJobInput): Promise<string> {
    const v = this.me();
    if (!can.addJob(v.role)) throw denied();
    if (this.d.jobs.some((x) => x.number === input.number)) throw new Error("That job number is already on the schedule.");
    const job: Job = {
      ...input,
      id: uid(),
      projectedHrs: input.estimateHrs,
      materialRevenueCents: materialRevenueCents(input.contractCents, input.materialCostCents, input.estimateHrs, this.d.settings.burdenedRateCents),
      baselineFinish: input.projectedFinish,
      actualFinish: null,
      firmnessReason: null,
      holdReason: null,
      holdUntil: null,
      active: true,
    };
    delete (job as Partial<NewJobInput>).note;
    const problem = jobProblem(null, job);
    if (problem) throw new Error(problem);
    this.d.jobs.push(job);
    this.log("jobs", job.id, "Job " + job.number, "added", null, `${job.customer}, ${job.estimateHrs} hrs`);
    const today = todayIn(new Date());
    this.d.workOrders.push({ jobId: job.id, version: 0, currentStep: 0, since: today, final: false, filed: false, fileName: null, filePath: null, returned: null, signoffs: [], history: [] });
    this.woEvent(this.d.workOrders.at(-1)!, "Job booked on the schedule. Work order opened, awaiting a draft.");
    this.push([
      {
        rule: "wo",
        title: `New job booked, draft the work order: ${job.number} ${job.customer}`,
        body: `Booked on the schedule now for ${fmtShort(job.start)} to ${fmtShort(job.projectedFinish)}. The work order runs alongside it.\nDraft it in Claude from the estimate and the proposal or contract, using the TMI work order template, then upload it to the job. Estimator: ${job.estimator}.`,
        recipients: this.d.staff.jobSetup,
        jobId: job.id,
        personId: null,
      },
    ]);
    if (input.note.trim()) {
      this.d.notes.push({ id: uid(), jobId: job.id, text: input.note.trim(), pinned: true, crewVisible: false, author: v.name, createdAt: new Date().toISOString() });
    }
    this.save();
    return job.id;
  }

  async assign(jobId: string, personId: string, week: IsoDate) {
    const j = this.job(jobId);
    if (!canEditJob(this.me(), j, "crew")) throw denied();
    if (this.d.assignments.some((a) => a.jobId === jobId && a.personId === personId && a.week === week)) return;
    this.d.assignments.push({ id: uid(), jobId, personId, week });
    this.log("assignments", jobId, "Job " + j.number + " · " + this.personName(personId), "crew, week ending " + week, null, "added");
    this.save();
  }

  async unassign(jobId: string, personId: string, week: IsoDate) {
    const j = this.job(jobId);
    if (!canEditJob(this.me(), j, "crew")) throw denied();
    this.d.assignments = this.d.assignments.filter((a) => !(a.jobId === jobId && a.personId === personId && a.week === week));
    this.log("assignments", jobId, "Job " + j.number + " · " + this.personName(personId), "crew, week ending " + week, "assigned", "removed");
    this.save();
  }

  async addNote(jobId: string, text: string, pinned: boolean, crewVisible: boolean) {
    const v = this.me();
    const j = this.job(jobId);
    if (!canEditJob(v, j, "notes")) throw denied();
    if (pinned && !canEditJob(v, j, "pinNotes")) pinned = false;
    this.d.notes.push({ id: uid(), jobId, text, pinned, crewVisible, author: v.name, createdAt: new Date().toISOString() });
    this.log("job_notes", jobId, "Job " + j.number, "note added", null, text.length > 60 ? text.slice(0, 60) + "…" : text);
    this.save();
  }

  async setNotePinned(noteId: string, pinned: boolean) {
    const n = this.d.notes.find((x) => x.id === noteId);
    if (!n) throw denied();
    const j = this.job(n.jobId);
    if (!canEditJob(this.me(), j, "pinNotes")) throw denied();
    this.log("job_notes", noteId, "Job " + j.number, "pinned", n.pinned, pinned);
    n.pinned = pinned;
    this.save();
  }

  async addTimeOff(personId: string, firstDay: IsoDate, lastDay: IsoDate, type: Dataset["timeOff"][number]["type"]) {
    if (!can.editCrewRecords(this.me().role)) throw denied();
    if (lastDay < firstDay) throw new Error("Pick a first day and a last day on or after it.");
    this.d.timeOff.push({ id: uid(), personId, firstDay, lastDay, type, active: true });
    this.log("time_off", personId, this.personName(personId), "time off", null, `${firstDay} to ${lastDay} (${type})`);
    this.save();
  }

  async removeTimeOff(id: string) {
    if (!can.editCrewRecords(this.me().role)) throw denied();
    const t = this.d.timeOff.find((x) => x.id === id);
    if (!t) return;
    t.active = false;
    this.log("time_off", t.personId, this.personName(t.personId), "time off removed", `${t.firstDay} to ${t.lastDay}`, null);
    this.save();
  }

  async addPerson(p: Parameters<Repo["addPerson"]>[0]) {
    if (!can.addPerson(this.me().role)) throw denied();
    if (!p.name.trim()) throw new Error("Name is required.");
    const id = uid();
    this.d.people.push({ ...p, id, active: true, quals: {} });
    this.log("people", id, p.name, "added", null, p.kind);
    this.save();
  }

  async updatePerson(id: string, patch: Parameters<Repo["updatePerson"]>[1]) {
    const role = this.me().role;
    if (!can.editCrewRecords(role)) throw denied();
    if ("active" in patch && !can.setRosterActive(role)) throw new Error("Only an admin can change who is on the active roster.");
    const p = this.d.people.find((x) => x.id === id);
    if (!p) throw denied();
    for (const [k, v] of Object.entries(patch)) this.log("people", id, p.name, k, (p as unknown as Record<string, unknown>)[k], v);
    Object.assign(p, patch);
    this.save();
  }

  async setQualification(personId: string, qualification: string, has: boolean, expires: IsoDate | null) {
    if (!can.editCrewRecords(this.me().role)) throw denied();
    const p = this.d.people.find((x) => x.id === personId);
    if (!p) throw denied();
    const before = qualification in p.quals ? p.quals[qualification] ?? "held" : null;
    if (has) p.quals[qualification] = expires;
    else delete p.quals[qualification];
    this.log("person_qualifications", personId, p.name, qualification, before, has ? expires ?? "held" : null);
    this.save();
  }

  async updateSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    if (!can.editSettings(this.me().role)) throw denied();
    this.log("settings", key, "Setting " + key, "value", this.d.settings[key], value);
    this.d.settings[key] = value;
    this.save();
  }

  async listUsers(): Promise<AccessUser[]> {
    if (!can.manageAccess(this.me().role)) throw denied();
    return this.d.users.map((u) => ({ id: u.userId, email: u.email, name: u.name, role: u.role, personId: u.personId, repCode: u.repCode, pmCode: u.pmCode, active: u.active, linked: true }));
  }

  async saveUser(u: Parameters<Repo["saveUser"]>[0]) {
    if (!can.manageAccess(this.me().role)) throw denied();
    const email = u.email.trim().toLowerCase();
    if (!email.includes("@")) throw new Error("Enter the person's Microsoft email address.");
    if (u.role === "superintendent" && !u.personId) throw new Error("Link a leader to their person on the roster.");
    if (u.role === "sales_rep" && !u.repCode) throw new Error("Pick the rep code.");
    if (u.role === "pm" && !u.pmCode) throw new Error("Pick the PM code.");
    const existing = this.d.users.find((x) => x.userId === u.id);
    if (existing) {
      this.log("app_users", existing.userId, "User " + existing.email, "access", `${existing.role}${existing.active ? "" : " (off)"}`, `${u.role}${u.active ? "" : " (off)"}`);
      Object.assign(existing, { ...u, email, userId: existing.userId });
    } else {
      if (this.d.users.some((x) => x.email === email)) throw new Error("That email already has access.");
      const userId = uid();
      this.d.users.push({ ...u, email, userId });
      this.log("app_users", userId, "User " + email, "added", null, u.role);
    }
    this.save();
  }

  async changeLog(jobId?: string): Promise<ChangeLogEntry[]> {
    const v = this.me();
    if (jobId) {
      const j = this.job(jobId);
      return this.s.log.filter((e) => e.recordId === j.id || e.recordId.startsWith(j.id + "|") || e.recordLabel.startsWith("Job " + j.number)).slice(0, 50);
    }
    if (!can.readChangeLog(v.role)) throw denied();
    return this.s.log.slice(0, 300);
  }

  async saveHourEntry(jobId: string, week: IsoDate, hours: number | null, source: "typed" | "csv" | "import") {
    const j = this.job(jobId);
    if (!canEditJob(this.me(), j, "actuals")) throw denied();
    const i = this.d.hourEntries.findIndex((e) => e.jobId === jobId && e.week === week);
    const old = i >= 0 ? this.d.hourEntries[i].hours : null;
    if (hours === null) {
      if (i >= 0) this.d.hourEntries.splice(i, 1);
    } else if (i >= 0) this.d.hourEntries[i] = { jobId, week, hours, source };
    else this.d.hourEntries.push({ jobId, week, hours, source });
    this.log("hour_entries", jobId + "|" + week, "Job " + j.number, `hours, week ending ${week} (${source})`, old, hours);
    this.save();
  }

  async closeWeek(input: CloseInput): Promise<CloseResult> {
    const v = this.me();
    if (!["admin", "ceo", "cfo", "scheduler"].includes(v.role)) throw new Error("Only the scheduler or an admin closes the week.");
    const d = this.d;
    const expected = weekToClose(d.closes.map((c) => c.week), todayIn(new Date()));
    if (!expected) throw new Error("This week is already closed.");
    if (input.week !== expected) throw new Error(`The next week to close is the week ending ${expected}.`);
    const w = input.week;
    const before = this.s.alerts.length;
    let total = 0;
    for (const e of input.entries) {
      const hrs = Math.round(e.hours * 10) / 10;
      d.actuals.push({ jobId: e.jobId, week: w, hours: hrs });
      total += hrs;
      const j = d.jobs.find((x) => x.id === e.jobId);
      this.log("actual_hours", e.jobId + "|" + w, "Job " + (j?.number ?? ""), "added", null, `${hrs} hrs (${e.source})`);
    }
    const entered = new Set(input.entries.map((e) => e.jobId));
    const missing = closeRows(d, w).filter((j) => !entered.has(j.id)).map((j) => j.id);
    d.closes.push({ week: w, entered: input.entries.length, totalHrs: total, missingJobIds: missing, completedJobIds: input.finished });
    const done = d.jobs.filter((j) => input.finished.includes(j.id));
    const onTime = done.length ? done.filter((j) => w <= (j.mustFinish ?? j.baselineFinish)).length / done.length : null;
    for (const j of done) {
      this.log("jobs", j.id, "Job " + j.number, "status", j.status, "complete");
      Object.assign(j, { status: "complete", actualFinish: j.actualFinish ?? w, holdReason: null, holdUntil: null });
    }
    d.hourEntries = d.hourEntries.filter((e) => e.week !== w);
    const snap = this.d.snapshots.filter((x) => x.targetWeek === w && x.madeWeek === addDays(w, -28));
    const accuracy = forecastAccuracy(snap, total, missing);
    const nw = addDays(w, 7);
    const idx = buildIndex(d);
    const plans = allPlans(d, idx, nw);
    const cap = weekList(nw, 13).reduce((a, x) => a + capacity(d, idx, x), 0) / 13;
    const left = d.jobs.filter(isSold).reduce((a, j) => a + Math.max(0, hoursLeft(idx, j)), 0);
    const roster = d.people.filter((p) => p.active && p.kind !== "leadership").length;
    d.metrics.push({
      week: w,
      utilization: total / (d.settings.targetHeadcount * d.settings.hoursPerManWeek),
      utilizationRoster: total / (roster * d.settings.hoursPerManWeek),
      backlogWeeks: cap ? left / cap : null,
      backlogCents: backlogCents(d, idx),
      accuracy,
      onTime,
      illustrative: false,
    });
    for (const target of [nw, addDays(nw, 28)])
      for (const j of d.jobs) {
        const h = plans.get(j.id)?.get(target) ?? 0;
        if (h > 0 && j.status !== "on_hold" && !d.snapshots.some((x) => x.madeWeek === nw && x.targetWeek === target && x.jobId === j.id))
          d.snapshots.push({ madeWeek: nw, targetWeek: target, jobId: j.id, hours: h });
      }
    for (const j of d.jobs.filter((x) => isSold(x) && entered.has(x.id))) {
      const a = overrunAlert(d, idx, j, input.entries.find((e) => e.jobId === j.id)!.hours, hoursLeft(idx, j));
      if (a) this.push([a]);
    }
    this.log("week_closes", w, "Schedule", "week closed", `week ending ${w}`, `rolled to ${nw}`);
    this.push(certAlerts(d, nw, this.s.alertState));
    this.save();
    return { week: w, entered: input.entries.length, total, missing: missing.length, alerts: this.s.alerts.length - before, nextWeek: nw };
  }

  async alerts(): Promise<Alert[]> {
    const v = this.me();
    return this.s.alerts.filter((a) => canSeeAlert(v, a, this.d, this.week())).slice(0, 200);
  }

  async mutedRules(): Promise<AlertRule[]> {
    return this.s.mutes[this.me().userId] ?? [];
  }

  async setMuted(rule: AlertRule, muted: boolean) {
    const id = this.me().userId;
    const cur = new Set(this.s.mutes[id] ?? []);
    if (muted) cur.add(rule);
    else cur.delete(rule);
    this.s.mutes[id] = [...cur];
    this.save();
  }

  async postDigest(title: string, body: string) {
    if (!["admin", "ceo", "cfo", "scheduler"].includes(this.me().role)) throw new Error("Only the scheduler or an admin sends the digest.");
    this.push([{ rule: "digest", title, body, recipients: ["Leadership team"], jobId: null, personId: null }]);
    this.save();
  }

  async confirmMyCrews(): Promise<number> {
    const v = this.me();
    if (v.role !== "superintendent" || !v.personId) throw new Error("Only a job leader confirms crews.");
    const w = this.week();
    const mine = this.d.jobs.filter((j) => j.leaderId === v.personId && isSold(j) && j.status !== "on_hold" && inWindow(j, w));
    for (const j of mine) {
      if (!this.d.confirmations.some((c) => c.jobId === j.id && c.week === w)) {
        this.d.confirmations.push({ jobId: j.id, week: w });
        this.log("crew_confirmations", j.id + "|" + w, "Job " + j.number, "crew confirmed, week ending " + w, null, "confirmed");
      }
    }
    this.save();
    return mine.length;
  }

  async myWeek(): Promise<MyWeek | null> {
    const v = this.me();
    const me = this.d.people.find((p) => p.id === v.personId);
    if (!me) return null;
    const w0 = this.week();
    const name = (id: string | null) => this.d.people.find((p) => p.id === id)?.name ?? null;
    return {
      person: { id: me.id, name: me.name, driver: me.driver, dotExpires: me.dotExpires },
      certs: Object.entries(me.quals)
        .map(([n, e]) => ({ name: n, expires: e }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      weeks: [w0, addDays(w0, 7)].map((wk) => ({
        week: wk,
        acknowledged: this.s.acks[me.id + "|" + wk] ?? null,
        timeOff: this.d.timeOff.filter((t) => t.active && t.personId === me.id && t.firstDay <= wk && t.lastDay >= mondayOf(wk)).map((t) => ({ firstDay: t.firstDay, lastDay: t.lastDay, type: t.type })),
        jobs: this.d.jobs
          .filter((j) => isSold(j) && j.status !== "on_hold" && this.d.assignments.some((a) => a.jobId === j.id && a.personId === me.id && a.week === wk))
          .sort((a, b) => a.start.localeCompare(b.start))
          .map((j) => ({
            number: j.number,
            customer: j.customer,
            jobType: j.jobType,
            location: j.location,
            from: j.start > mondayOf(wk) ? j.start : mondayOf(wk),
            to: j.projectedFinish < wk ? j.projectedFinish : wk,
            siteAddress: j.siteAddress,
            siteStartTime: j.siteStartTime,
            siteContact: j.siteContact,
            siteOrientation: j.siteOrientation,
            sitePpe: j.sitePpe,
            leader: name(j.leaderId),
            leaderPhone: this.d.people.find((p) => p.id === j.leaderId)?.phone ?? null,
            notes: this.d.notes.filter((n) => n.jobId === j.id && n.crewVisible).map((n) => n.text),
            crew: this.d.assignments
              .filter((a) => a.jobId === j.id && a.week === wk)
              .map((a) => (name(a.personId) ?? "").split(" ")[0])
              .sort(),
          })),
      })),
    };
  }

  async acknowledgeWeek(week: IsoDate) {
    const v = this.me();
    if (!v.personId) throw new Error("This sign-in isn't linked to a person on the roster.");
    const k = v.personId + "|" + week;
    if (!this.s.acks[k]) this.s.acks[k] = new Date().toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
    this.save();
  }

  async woUpload(jobId: string, _file: File | null, fileName: string) {
    const { j, w } = this.wo(jobId);
    if (!woCanUpload(this.me(), w)) throw new Error("Only job setup, the scheduler or an admin uploads work order drafts, and only when one is due.");
    if (!fileName.trim()) throw new Error("Choose the draft file.");
    const wasReturned = !!w.returned;
    Object.assign(w, { fileName, filePath: null, version: w.version + 1, currentStep: 0, returned: null, signoffs: [], since: todayIn(new Date()) });
    this.woEvent(w, `${wasReturned ? "Uploaded revised draft " : "Uploaded draft "}${fileName}.`);
    this.log("work_orders", jobId, "Job " + j.number, "file_name", null, fileName);
    this.push([
      {
        rule: "wo",
        title: `${wasReturned ? "Revised draft" : "Draft work order"} ready for review: ${j.number} ${j.customer}`,
        body: `${this.me().name} uploaded ${fileName}. Your step: check hours and scope against the estimate. Due in ${this.d.settings.woReviewDays} days.\nThe job is already booked on the schedule for ${fmtShort(j.start)}.`,
        recipients: [j.estimator],
        jobId,
        personId: null,
      },
    ]);
    this.save();
  }

  async woApprove(jobId: string) {
    const v = this.me();
    const { j, w } = this.wo(jobId);
    const n = this.names();
    const st = w.currentStep;
    if (!woCanSign(v, j, w)) throw new Error(`This step is waiting on ${stepWho(j, st, n)}.`);
    w.signoffs.push({ step: st, by: v.name, at: new Date().toISOString() });
    this.woEvent(w, `${WO_STEPS[st].role} sign-off: ${WO_STEPS[st].what.toLowerCase()} approved${woIsMine(v, j, st) ? "" : ", for " + stepWho(j, st, n)}.`);
    this.log("work_order_signoffs", jobId, "Job " + j.number, WO_STEPS[st].role.toLowerCase() + " sign-off", "pending", "approved");
    w.since = todayIn(new Date());
    if (st === 3) {
      w.currentStep = 4;
      w.final = true;
      this.woEvent(w, "Work order final. All four sign-offs complete.");
      this.push([
        {
          rule: "wo",
          title: `Work order final: ${j.number} ${j.customer}`,
          body: "Estimator, rep, PM and scheduler have all signed off.\nLori files the final in Procore as the work order of record. TMI Ops shows it from there.",
          recipients: [...n.jobSetup, stepWho(j, 2, n), stepWho(j, 1, n), stepWho(j, 3, n)],
          jobId,
          personId: null,
        },
      ]);
    } else {
      w.currentStep = st + 1;
      this.push([
        {
          rule: "wo",
          title: `Work order ready for your sign-off: ${j.number} ${j.customer}`,
          body: `${WO_STEPS[st].role} signed off on ${WO_STEPS[st].what.toLowerCase()}. Your step: ${WO_STEPS[st + 1].what.toLowerCase()}. Due in ${this.d.settings.woReviewDays} days.`,
          recipients: [stepWho(j, st + 1, n)],
          jobId,
          personId: null,
        },
      ]);
    }
    this.save();
  }

  async woReturn(jobId: string, comment: string) {
    const v = this.me();
    const { j, w } = this.wo(jobId);
    const n = this.names();
    const st = w.currentStep;
    if (!woCanSign(v, j, w)) throw new Error(`This step is waiting on ${stepWho(j, st, n)}.`);
    if (!comment.trim()) throw new Error("Add a comment so Lori knows what to fix.");
    Object.assign(w, { returned: { by: v.name, role: WO_STEPS[st].role, comment: comment.trim(), at: new Date().toISOString() }, currentStep: 0, signoffs: [], since: todayIn(new Date()) });
    this.woEvent(w, `Sent back by the ${WO_STEPS[st].role.toLowerCase()}.`, comment.trim());
    this.log("work_orders", jobId, "Job " + j.number, "returned_comment", null, comment.trim());
    this.push([
      {
        rule: "wo",
        title: `Work order sent back: ${j.number} ${j.customer}`,
        body: `${v.name}, at the ${st === 2 ? "PM" : WO_STEPS[st].role.toLowerCase()} step: ${comment.trim()}\nLori revises the draft and re-uploads it. Sign-offs restart with the estimator.`,
        recipients: [...n.jobSetup, stepWho(j, 2, n)],
        jobId,
        personId: null,
      },
    ]);
    this.save();
  }

  async woMarkFiled(jobId: string) {
    const { j, w } = this.wo(jobId);
    if (!woCanFile(this.me(), w)) throw new Error("Only a final work order can be marked filed, by job setup, the scheduler or an admin.");
    w.filed = true;
    this.woEvent(w, "Final filed in Procore as the work order of record.");
    this.log("work_orders", jobId, "Job " + j.number, "filed", false, true);
    this.save();
  }

  async woFileUrl(): Promise<string | null> {
    return null;
  }

  async setCheckpoint(jobId: string, key: string, done: boolean) {
    const v = this.me();
    const j = this.job(jobId);
    const c = this.d.checkpointDefs.find((x) => x.key === key);
    if (!c || !canCheck(v, c, true)) throw new Error("That checkpoint belongs to someone else.");
    const i = this.d.jobCheckpoints.findIndex((x) => x.jobId === jobId && x.key === key);
    if (done && i < 0) this.d.jobCheckpoints.push({ jobId, key, by: v.name, at: new Date().toISOString() });
    if (!done && i >= 0) this.d.jobCheckpoints.splice(i, 1);
    this.log("job_checkpoints", jobId + "|" + key, `Job ${j.number} · ${c.label}`, "done", done ? "open" : "done", done ? "done" : "reopened");
    this.save();
  }

  async saveCheckpointDef(def: CheckpointDef, isNew: boolean) {
    if (!["admin", "ceo", "cfo"].includes(this.me().role)) throw denied();
    if (!def.label.trim()) throw new Error("Give the checkpoint a name.");
    const i = this.d.checkpointDefs.findIndex((x) => x.key === def.key);
    if (isNew) {
      if (i >= 0) throw new Error("That checkpoint already exists.");
      this.d.checkpointDefs.push({ ...def, autoSource: null });
      this.log("journey_checkpoints", def.key, "Journey " + def.label, "added", null, def.label);
    } else {
      const before = this.d.checkpointDefs[i];
      for (const k of ["label", "owner", "offsetDays", "anchor", "stageKey", "active"] as const)
        if (before[k] !== def[k]) this.log("journey_checkpoints", def.key, "Journey " + def.label, k, before[k], def[k]);
      this.d.checkpointDefs[i] = { ...def, autoSource: before.autoSource };
    }
    this.save();
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
