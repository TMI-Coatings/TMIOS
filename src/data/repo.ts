import type { CloseInput, CloseResult } from "../domain/close";
import type { CheckpointDef } from "../domain/journey";
import type { Alert, AlertRule, ChangeLogEntry, Dataset, IsoDate, Job, MyWeek, Person, Role, Settings, TimeOffType, Viewer } from "../domain/types";

export interface NewJobInput {
  number: string;
  customer: string;
  jobType: string;
  location: string;
  repCode: string;
  pmCode: string;
  estimator: string;
  leaderId: string | null;
  crewSize: number;
  estimateHrs: number;
  contractCents: number;
  materialCostCents: number;
  start: IsoDate;
  projectedFinish: IsoDate;
  mustFinish: IsoDate | null;
  mustFinishReason: Job["mustFinishReason"];
  status: "scheduled" | "active";
  firmness: Job["firmness"];
  waitsOnJobId: string | null;
  exterior: boolean;
  billingMethod: Job["billingMethod"];
  retainagePct: number;
  retainageRelease: Job["retainageRelease"];
  retainageReleaseNote: string | null;
  requirements: string[];
  siteAddress: string;
  siteStartTime: string;
  siteContact: string;
  siteOrientation: string;
  sitePpe: string;
  note: string;
}

export interface AccessUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  personId: string | null;
  repCode: string | null;
  pmCode: string | null;
  active: boolean;
  linked: boolean;
}

export interface LoadResult {
  ds: Dataset;
  /** The week the schedule plans from: the first week not yet closed. */
  week: IsoDate;
  /** The next week to close, or null when this week is already closed. */
  weekToClose: IsoDate | null;
  /** Inputs for the company totals rows when the viewer only sees some jobs (decision 6). */
  totals: Dataset | null;
}

/** Everything the screens read and write. Two versions: Supabase (live) and in-browser sample data. */
export interface Repo {
  readonly mode: "live" | "sample";
  load(viewer: Viewer): Promise<LoadResult>;
  setPlanCell(jobId: string, week: IsoDate, hours: number | null): Promise<void>;
  updateJob(jobId: string, patch: Partial<Job>): Promise<void>;
  createJob(input: NewJobInput): Promise<string>;
  assign(jobId: string, personId: string, week: IsoDate): Promise<void>;
  unassign(jobId: string, personId: string, week: IsoDate): Promise<void>;
  addNote(jobId: string, text: string, pinned: boolean, crewVisible: boolean): Promise<void>;
  setNotePinned(noteId: string, pinned: boolean): Promise<void>;
  addTimeOff(personId: string, firstDay: IsoDate, lastDay: IsoDate, type: TimeOffType): Promise<void>;
  removeTimeOff(id: string): Promise<void>;
  addPerson(p: Pick<Person, "name" | "kind" | "state" | "driver" | "phone" | "dotExpires">): Promise<void>;
  updatePerson(id: string, patch: Partial<Pick<Person, "name" | "kind" | "state" | "driver" | "phone" | "dotExpires" | "active">>): Promise<void>;
  setQualification(personId: string, qualification: string, has: boolean, expires: IsoDate | null): Promise<void>;
  updateSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void>;
  listUsers(): Promise<AccessUser[]>;
  saveUser(u: Omit<AccessUser, "id" | "linked"> & { id?: string }): Promise<void>;
  changeLog(jobId?: string): Promise<ChangeLogEntry[]>;
  /** Hours a PM or the scheduler enters for the open week; null clears it. */
  saveHourEntry(jobId: string, week: IsoDate, hours: number | null, source: "typed" | "csv" | "import"): Promise<void>;
  closeWeek(input: CloseInput): Promise<CloseResult>;
  alerts(): Promise<Alert[]>;
  mutedRules(): Promise<AlertRule[]>;
  setMuted(rule: AlertRule, muted: boolean): Promise<void>;
  postDigest(title: string, body: string): Promise<void>;
  confirmMyCrews(): Promise<number>;
  myWeek(): Promise<MyWeek | null>;
  acknowledgeWeek(week: IsoDate): Promise<void>;
  /** Upload a work order draft. In sample mode only the file name is kept. */
  woUpload(jobId: string, file: File | null, fileName: string): Promise<void>;
  woApprove(jobId: string): Promise<void>;
  woReturn(jobId: string, comment: string): Promise<void>;
  woMarkFiled(jobId: string): Promise<void>;
  /** A short-lived link to the current draft, or null when there is no file to open. */
  woFileUrl(jobId: string): Promise<string | null>;
  setCheckpoint(jobId: string, key: string, done: boolean): Promise<void>;
  saveCheckpointDef(def: CheckpointDef, isNew: boolean): Promise<void>;
}

/** Turns a database or rule error into one plain sentence for the screen. */
export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e);
  if (/row-level security|permission denied/i.test(msg)) return "You don't have permission to make that change.";
  if (/jobs_number_check|four digits/i.test(msg)) return "Job numbers are four digits.";
  if (/jobs_number_key|duplicate key.*number|already on the schedule/i.test(msg)) return "That job number is already on the schedule.";
  if (/projected_finish.*start|jobs_check\b|finish date/i.test(msg)) return "The finish date has to be on or after the start date.";
  if (/hold_reason|hold_until/i.test(msg)) return "Jobs on hold need a reason and an expected restart date.";
  if (/retainage_release/i.test(msg)) return "Jobs with retainage need release terms.";
  if (/actual_hours_job_id_week|hour_entries_pkey/i.test(msg)) return "Hours for that job and week are already in.";
  return msg.replace(/^.*?: /, "");
}
