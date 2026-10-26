/**
 * Sample mode: the app on invented data held in this browser, with a "Viewing as" picker.
 * It applies the same permission rules as the database, so what a role can do here is what
 * it can do in production. It never talks to a server.
 */
import { JOB_COLUMNS, can, canEditJob, canSeeJob, seesCompanyTotals, type JobField } from "../domain/permissions";
import { jobProblem } from "../domain/jobRules";
import { materialRevenueCents } from "../domain/schedule";
import type { ChangeLogEntry, Dataset, IsoDate, Job, Settings, Viewer } from "../domain/types";
import { currentWeek } from "../domain/weeks";
import { buildSample, type SampleData } from "../sample/seed";
import type { AccessUser, LoadResult, NewJobInput, Repo } from "./repo";

const KEY = "tmi-ops-sample-v1";

const uid = () => crypto.randomUUID();
const denied = () => new Error("You don't have permission to make that change.");
const show = (v: unknown) => (v === null || v === undefined || v === "" ? null : Array.isArray(v) ? v.join(", ") : String(v));

interface Stored {
  week: IsoDate;
  data: SampleData;
  log: ChangeLogEntry[];
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
    return { week, data: buildSample(week), log: [] };
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
    const sawAll = visible.size === d.jobs.length;
    const totals = seesCompanyTotals(viewer.role) && !sawAll ? { ...d, jobs: d.jobs.filter((j) => j.status !== "complete") } : null;
    return { ds, totals };
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
    Object.assign(j, next);
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
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
