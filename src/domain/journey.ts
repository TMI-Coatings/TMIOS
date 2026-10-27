/**
 * The job journey: stages and checkpoints from sale to closeout, each due a number of days
 * from the job's start or finish. Definitions are admin-editable (decision 23). Mirrors the
 * database's checkpoint_auto_done and can_check.
 */
import type { IsoDate, Job, Role, Viewer } from "./types";
import { addDays, daysBetween } from "./weeks";

export type CheckpointOwner = "sales_rep" | "job_setup" | "pm" | "scheduler" | "accounting";
export type AutoSource = "wo_final" | "mobilized" | "work_complete" | "final_invoice";

export interface JourneyStage {
  key: string;
  label: string;
  sort: number;
  startup: boolean;
  active: boolean;
}

export interface CheckpointDef {
  key: string;
  stageKey: string;
  label: string;
  owner: CheckpointOwner;
  offsetDays: number;
  anchor: "start" | "finish";
  autoSource: AutoSource | null;
  sort: number;
  active: boolean;
  /** Set when an admin adds a checkpoint: it only applies to jobs where it falls due on or after this date. */
  appliesFrom?: IsoDate | null;
}

/** A checkpoint added later doesn't reach back to jobs where it would already be past due. */
export const applies = (j: Job, c: CheckpointDef) => !c.appliesFrom || dueDate(j, c) >= c.appliesFrom;

export interface JobCheckpoint {
  jobId: string;
  key: string;
  by: string;
  at: string;
}

export const OWNER_LABEL: Record<CheckpointOwner, string> = { sales_rep: "Sales rep", job_setup: "Job setup", pm: "PM", scheduler: "Scheduler", accounting: "Accounting" };
export const AUTO_LABEL: Record<AutoSource, string> = { wo_final: "Work orders tab", mobilized: "weekly close", work_complete: "job status", final_invoice: "Billing tab" };

export interface JourneyFacts {
  woFinal: (jobId: string) => boolean;
  hasActuals: (jobId: string) => boolean;
  finalInvoiced: (jobId: string) => boolean;
}

export const dueDate = (j: Job, c: CheckpointDef): IsoDate => addDays(c.anchor === "finish" ? j.projectedFinish : j.start, c.offsetDays);

export function autoDone(j: Job, c: CheckpointDef, f: JourneyFacts): boolean {
  switch (c.autoSource) {
    case "wo_final":
      return f.woFinal(j.id);
    case "mobilized":
      return j.status === "active" || j.status === "complete" || f.hasActuals(j.id);
    case "work_complete":
      return j.status === "complete";
    case "final_invoice":
      return f.finalInvoiced(j.id);
    default:
      return false;
  }
}

export class Journey {
  readonly stages: JourneyStage[];
  readonly defs: CheckpointDef[];
  private done: Map<string, JobCheckpoint>;
  constructor(stages: JourneyStage[], defs: CheckpointDef[], marks: JobCheckpoint[], private facts: JourneyFacts, private today: IsoDate) {
    this.stages = stages.filter((s) => s.active).sort((a, b) => a.sort - b.sort);
    const live = new Set(this.stages.map((s) => s.key));
    this.defs = defs.filter((d) => d.active && live.has(d.stageKey)).sort((a, b) => a.sort - b.sort);
    this.done = new Map(marks.map((m) => [m.jobId + "|" + m.key, m]));
  }
  stageIndex = (c: CheckpointDef) => this.stages.findIndex((s) => s.key === c.stageKey);
  mark = (j: Job, c: CheckpointDef) => this.done.get(j.id + "|" + c.key);
  isDone = (j: Job, c: CheckpointDef) => !applies(j, c) || (c.autoSource ? autoDone(j, c, this.facts) : this.done.has(j.id + "|" + c.key));
  isLate = (j: Job, c: CheckpointDef) => !this.isDone(j, c) && dueDate(j, c) < this.today;
  isSoon = (j: Job, c: CheckpointDef) => !this.isDone(j, c) && !this.isLate(j, c) && dueDate(j, c) <= addDays(this.today, 7);
  daysLate = (j: Job, c: CheckpointDef) => daysBetween(dueDate(j, c), this.today);
  /** The earliest stage with anything unfinished; stages.length once everything is done. */
  stageOf(j: Job): number {
    const i = this.stages.findIndex((s) => this.defs.some((c) => c.stageKey === s.key && !this.isDone(j, c)));
    return i < 0 ? this.stages.length : i;
  }
  next = (j: Job) => this.defs.filter((c) => !this.isDone(j, c)).sort((a, b) => dueDate(j, a).localeCompare(dueDate(j, b)))[0];
  lateList = (j: Job) => this.defs.filter((c) => this.isLate(j, c));
  startupDefs = () => this.defs.filter((c) => this.stages[this.stageIndex(c)]?.startup);
  readiness(j: Job): number {
    const st = this.startupDefs();
    return st.length ? st.filter((c) => this.isDone(j, c)).length / st.length : 1;
  }
  inStartup = (j: Job) => this.stageOf(j) < this.stages.length && !!this.stages[this.stageOf(j)]?.startup;
}

/** Who may tick a checkpoint. Same rules as app.can_check in the database. */
export function canCheck(v: Viewer, c: CheckpointDef, seesJob: boolean): boolean {
  if (c.autoSource || !seesJob || !c.active) return false;
  if ((["admin", "ceo", "cfo"] as Role[]).includes(v.role)) return true;
  return c.owner === v.role;
}

export function ownerName(j: Job, c: CheckpointDef, names: { rep: (c: string) => string; pm: (c: string) => string; jobSetup: string[]; schedulers: string[] }): string {
  switch (c.owner) {
    case "sales_rep":
      return names.rep(j.repCode);
    case "pm":
      return "PM " + names.pm(j.pmCode);
    case "job_setup":
      return names.jobSetup.join(", ") || "Job setup";
    case "scheduler":
      return names.schedulers.join(", ") || "Scheduler";
    case "accounting":
      return "Accounting";
  }
}

export const leadText = (c: CheckpointDef) =>
  c.offsetDays === 0 ? `at ${c.anchor}` : `${Math.abs(c.offsetDays)} days ${c.offsetDays < 0 ? "before" : "after"} ${c.anchor}`;

/** The starting definitions (the demo's journey), the same rows the database migration inserts. */
export const DEFAULT_STAGES: JourneyStage[] = [
  ["sold", "Sold and set up", true],
  ["wo", "Work order", true],
  ["paper", "Paperwork", true],
  ["mat", "Materials", true],
  ["equip", "Equipment and travel", true],
  ["hand", "Crew handoff", true],
  ["prog", "In progress", false],
  ["punch", "Punch and acceptance", false],
  ["close", "Closeout", false],
].map(([key, label, startup], i) => ({ key: key as string, label: label as string, sort: i + 1, startup: startup as boolean, active: true }));

export const DEFAULT_CHECKPOINTS: CheckpointDef[] = (
  [
    ["po", "sold", "Contract or PO received", "sales_rep", -35, "start", null],
    ["setup", "sold", "Job entered and Procore project created", "job_setup", -30, "start", null],
    ["wofinal", "wo", "Work order final", "pm", -21, "start", "wo_final"],
    ["sub", "paper", "Submittals and product data approved", "pm", -21, "start", null],
    ["coi", "paper", "Insurance certificate and bonds", "job_setup", -14, "start", null],
    ["safety", "paper", "Safety plan, hazard analysis and permits", "pm", -7, "start", null],
    ["ord", "mat", "Materials ordered, lead time confirmed", "pm", -21, "start", null],
    ["del", "mat", "Materials delivered", "pm", -3, "start", null],
    ["rent", "equip", "Lifts, rentals, trucks and hotels booked", "scheduler", -7, "start", null],
    ["crew", "hand", "Leader and crew confirmed", "scheduler", -7, "start", null],
    ["badge", "hand", "Orientation or badging booked", "pm", -5, "start", null],
    ["prejob", "hand", "Pre-job meeting with the leader", "pm", -3, "start", null],
    ["mob", "prog", "Crew mobilized", "scheduler", 0, "start", "mobilized"],
    ["wdone", "prog", "Work complete", "pm", 0, "finish", "work_complete"],
    ["walk", "punch", "Final walk and customer sign-off", "pm", 3, "finish", null],
    ["inv", "close", "Final invoice sent", "accounting", 7, "finish", "final_invoice"],
    ["cause", "close", "Closeout cause tagged for the scorecard", "pm", 7, "finish", null],
    ["warr", "close", "Warranty letter and closeout documents sent", "pm", 14, "finish", null],
  ] as const
).map(([key, stageKey, label, owner, offsetDays, anchor, autoSource], i) => ({ key, stageKey, label, owner, offsetDays, anchor, autoSource, sort: i + 1, active: true }));
