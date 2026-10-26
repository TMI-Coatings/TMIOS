import type { ChangeLogEntry, Dataset, IsoDate, Job, Person, Role, Settings, TimeOffType, Viewer } from "../domain/types";

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
  return msg.replace(/^.*?: /, "");
}
