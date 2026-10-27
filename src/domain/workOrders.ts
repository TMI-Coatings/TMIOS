/**
 * Work orders: the job is booked at once; its work order runs alongside through four
 * sign-offs in order, and the final is filed in Procore. Mirrors the database functions
 * wo_upload, wo_approve, wo_return and wo_mark_filed (batch B migration).
 */
import type { IsoDate, Job, Viewer } from "./types";
import { daysBetween } from "./weeks";

export const WO_STEPS = [
  { role: "Estimator", what: "Hours and scope" },
  { role: "Sales rep", what: "Contract terms" },
  { role: "PM", what: "Execution plan" },
  { role: "Scheduler", what: "Crew and dates" },
] as const;

export interface WorkOrder {
  jobId: string;
  version: number;
  /** 0..3 = waiting on that step; 4 = final. */
  currentStep: number;
  since: IsoDate;
  final: boolean;
  filed: boolean;
  fileName: string | null;
  filePath: string | null;
  returned: { by: string; role: string; comment: string; at: string } | null;
  /** Sign-offs on the current version. */
  signoffs: { step: number; by: string; at: string }[];
  history: { at: string; who: string; action: string; note: string }[];
}

export type WoStatus = "Awaiting draft" | "Draft" | "In review" | "Returned" | "Final";

export const woStatus = (w: WorkOrder): WoStatus =>
  w.final ? "Final" : w.returned ? "Returned" : !w.fileName ? "Awaiting draft" : w.currentStep === 0 ? "Draft" : "In review";

export const WO_TAG: Record<WoStatus, string> = { "Awaiting draft": "yel", Returned: "red", Draft: "", "In review": "blue", Final: "grn" };

export interface Names {
  rep: (code: string) => string;
  pm: (code: string) => string;
  schedulers: string[];
  jobSetup: string[];
}

/** Who signs a step on this job, by name. */
export function stepWho(j: Job, step: number, n: Names): string {
  return step === 0 ? j.estimator : step === 1 ? n.rep(j.repCode) : step === 2 ? n.pm(j.pmCode) : n.schedulers.join(", ") || "Scheduler";
}

export const woOpen = (j: Job, w: WorkOrder | undefined) => !!w && j.status !== "complete" && !w.final;
export const woDaysWaiting = (w: WorkOrder, today: IsoDate) => Math.max(0, daysBetween(w.since, today));
export const woLate = (j: Job, w: WorkOrder | undefined, today: IsoDate, reviewDays: number) => woOpen(j, w) && woDaysWaiting(w!, today) > reviewDays;

/** Who the work order is waiting on now, in words. */
export function woWaiting(j: Job, w: WorkOrder, n: Names): string {
  const s = woStatus(w);
  const lori = n.jobSetup.join(", ") || "Job setup";
  if (s === "Final") return w.filed ? "" : `${lori}, to file in Procore`;
  if (s === "Awaiting draft" || s === "Returned") return lori;
  return stepLabel(j, w.currentStep, n);
}

/** A step's person with their role, e.g. "Rep Eric Rich" or "Estimator Sarah Louvar". */
export const stepLabel = (j: Job, step: number, n: Names) => `${WO_STEPS[step].role === "Sales rep" ? "Rep" : WO_STEPS[step].role} ${stepWho(j, step, n)}`;

/** Is this step waiting on the viewer themselves (not acting for someone)? */
export function woIsMine(v: Viewer, j: Job, step: number): boolean {
  return (
    (step === 0 && v.role === "estimator" && v.name === j.estimator) ||
    (step === 1 && v.role === "sales_rep" && v.repCode === j.repCode) ||
    (step === 2 && v.role === "pm" && v.pmCode === j.pmCode) ||
    (step === 3 && v.role === "scheduler")
  );
}

const FULL = ["admin", "ceo", "cfo"];
export const woCanSign = (v: Viewer, j: Job, w: WorkOrder) => (woStatus(w) === "Draft" || woStatus(w) === "In review") && (FULL.includes(v.role) || woIsMine(v, j, w.currentStep));
export const woCanUpload = (v: Viewer, w: WorkOrder) => [...FULL, "scheduler", "job_setup"].includes(v.role) && (woStatus(w) === "Awaiting draft" || woStatus(w) === "Returned");
export const woCanFile = (v: Viewer, w: WorkOrder) => [...FULL, "scheduler", "job_setup"].includes(v.role) && w.final && !w.filed;

/** In the viewer's queue: drafts for job setup, their sign-off step for everyone else. */
export function woInQueue(v: Viewer, j: Job, w: WorkOrder): boolean {
  if (j.status === "complete") return false;
  const s = woStatus(w);
  if (v.role === "job_setup") return s === "Awaiting draft" || s === "Returned" || (s === "Final" && !w.filed);
  return (s === "Draft" || s === "In review") && woIsMine(v, j, w.currentStep);
}
