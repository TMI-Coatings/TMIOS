import type { Job, Role, Viewer } from "./types";

/**
 * Who may do what. The screens use this to show or hide controls; the database enforces the
 * same rules with row-level security and the jobs edit trigger (supabase/migrations). The
 * database tests run every rule here against Postgres, so the two can't drift apart.
 */

/** Full rights: admin, the CEO (decision 7) and the CFO. */
const OFFICE_ALL: Role[] = ["admin", "ceo", "cfo"];

export type Tab = "me" | "dashboard" | "schedule" | "wo" | "journey" | "billing" | "close" | "revenue" | "crew" | "scorecard" | "board" | "alerts" | "access" | "settings" | "log";

export const TABS: { id: Tab; label: string; roles: Role[] }[] = [
  { id: "me", label: "My week", roles: ["superintendent", "field_crew"] },
  // Sales reps get a capacity-only version so they can sell into open weeks (Austin, Oct 27).
  { id: "dashboard", label: "Dashboard", roles: [...OFFICE_ALL, "scheduler", "pm", "sales_rep"] },
  {
    id: "schedule",
    label: "Schedule",
    roles: ["admin", "ceo", "scheduler", "job_setup", "estimator", "pm", "superintendent", "sales_rep", "accounting", "cfo"],
  },
  { id: "wo", label: "Work orders", roles: [...OFFICE_ALL, "scheduler", "job_setup", "estimator", "pm", "sales_rep"] },
  { id: "journey", label: "Job journey", roles: [...OFFICE_ALL, "scheduler", "job_setup", "estimator", "pm", "sales_rep", "accounting"] },
  { id: "billing", label: "Billing", roles: [...OFFICE_ALL, "accounting"] },
  // PMs enter hours for their own jobs; the scheduler closes the week (decision 9).
  { id: "close", label: "Weekly close", roles: [...OFFICE_ALL, "scheduler", "pm"] },
  // PMs enter percent complete for their own jobs (decision 16).
  { id: "revenue", label: "Revenue", roles: [...OFFICE_ALL, "scheduler", "pm", "sales_rep", "accounting"] },
  { id: "crew", label: "Crew", roles: [...OFFICE_ALL, "scheduler"] },
  { id: "scorecard", label: "Leader scorecard", roles: [...OFFICE_ALL, "scheduler", "pm", "superintendent"] },
  // The board gets the exported pack; no board login (decision 12).
  { id: "board", label: "Board view", roles: OFFICE_ALL },
  { id: "alerts", label: "Alerts", roles: ["admin", "ceo", "cfo", "scheduler", "job_setup", "estimator", "pm", "superintendent", "sales_rep", "field_crew", "accounting"] },
  // Office staff see the whole log; PMs, reps, job setup and estimators see job changes (Austin, Oct 27).
  { id: "log", label: "Change log", roles: [...OFFICE_ALL, "scheduler", "job_setup", "estimator", "pm", "sales_rep"] },
  { id: "access", label: "Access", roles: OFFICE_ALL },
  { id: "settings", label: "Settings", roles: OFFICE_ALL },
];

export const tabsFor = (role: Role) => TABS.filter((t) => t.roles.includes(role));

/** Is this job "theirs" for the roles that only see their own jobs? */
export function owns(v: Viewer, j: Pick<Job, "leaderId" | "repCode" | "pmCode">): boolean {
  switch (v.role) {
    case "superintendent":
      return !!v.personId && j.leaderId === v.personId;
    case "sales_rep":
      return !!v.repCode && j.repCode === v.repCode;
    case "pm":
      return !!v.pmCode && j.pmCode === v.pmCode;
    default:
      return false;
  }
}

// Reps and PMs see every job, money included; they still change only their own (decision 6a).
const SEES_ALL_JOBS: Role[] = ["admin", "ceo", "scheduler", "job_setup", "estimator", "pm", "sales_rep", "accounting", "cfo"];

export function canSeeJob(v: Viewer, j: Job): boolean {
  if (SEES_ALL_JOBS.includes(v.role)) return true;
  if (v.role === "superintendent") return owns(v, j);
  return false;
}

/** Company totals rows on the Schedule. Reps and PMs see them (decision 6); leaders don't, as in the demo. */
export const seesCompanyTotals = (role: Role) => tabsFor(role).some((t) => t.id === "schedule") && role !== "superintendent";

/** Job fields grouped by who may change them. */
export type JobField =
  | "plan"
  | "start"
  | "projectedFinish"
  | "crewSize"
  | "leaderId"
  | "projectedHrs"
  | "mustFinish"
  | "firmness"
  | "status"
  | "actualFinish"
  | "site"
  | "intake"
  | "crew"
  | "notes"
  | "pinNotes"
  | "actuals"
  | "percent"
  | "changeOrders"
  | "milestones";

type Rule = { any: Role[]; own?: Role[] };

export const JOB_FIELD_RULES: Record<JobField, Rule> = {
  // Decision 8: admin, ceo, scheduler on any job; a PM on their own.
  plan: { any: [...OFFICE_ALL, "scheduler"], own: ["pm"] },
  start: { any: [...OFFICE_ALL, "scheduler"], own: ["pm"] },
  projectedFinish: { any: [...OFFICE_ALL, "scheduler"], own: ["pm", "superintendent"] },
  // The scheduler runs the schedule day to day, so she sets leaders, crew size and hours too (Austin, Oct 27).
  crewSize: { any: [...OFFICE_ALL, "scheduler"], own: ["superintendent"] },
  leaderId: { any: [...OFFICE_ALL, "scheduler"] },
  projectedHrs: { any: [...OFFICE_ALL, "scheduler"] },
  mustFinish: { any: OFFICE_ALL },
  firmness: { any: [...OFFICE_ALL, "scheduler"], own: ["pm", "sales_rep"] },
  status: { any: [...OFFICE_ALL, "scheduler"] },
  actualFinish: { any: [...OFFICE_ALL, "scheduler"] },
  site: { any: [...OFFICE_ALL, "scheduler"] },
  intake: { any: [...OFFICE_ALL, "job_setup"] },
  crew: { any: [...OFFICE_ALL, "scheduler"], own: ["superintendent"] },
  notes: { any: [...OFFICE_ALL, "scheduler"], own: ["superintendent"] },
  pinNotes: { any: OFFICE_ALL },
  // Hours for the open week, before the close (decision 9).
  actuals: { any: [...OFFICE_ALL, "scheduler"], own: ["pm"] },
  // Monday percent complete: the PM, or Jared and the admins (decision 16).
  percent: { any: OFFICE_ALL, own: ["pm"] },
  // Approved change orders: the PM or Lori (decision 19).
  changeOrders: { any: [...OFFICE_ALL, "job_setup"], own: ["pm"] },
  milestones: { any: [...OFFICE_ALL, "scheduler"], own: ["pm"] },
};

export function canEditJob(v: Viewer, j: Job, f: JobField): boolean {
  const r = JOB_FIELD_RULES[f];
  if (r.any.includes(v.role)) return true;
  return !!r.own?.includes(v.role) && owns(v, j);
}

/** Which job columns each field group covers (used by the edit form and mirrored in the database trigger). */
export const JOB_COLUMNS: Record<Exclude<JobField, "plan" | "crew" | "notes" | "pinNotes" | "actuals" | "percent" | "changeOrders" | "milestones">, (keyof Job)[]> = {
  start: ["start"],
  projectedFinish: ["projectedFinish"],
  crewSize: ["crewSize"],
  leaderId: ["leaderId"],
  projectedHrs: ["projectedHrs"],
  mustFinish: ["mustFinish", "mustFinishReason"],
  firmness: ["firmness", "waitsOnJobId", "firmnessReason"],
  status: ["status", "holdReason", "holdUntil"],
  actualFinish: ["actualFinish"],
  site: ["siteAddress", "siteStartTime", "siteContact", "siteOrientation", "sitePpe"],
  intake: [
    "number",
    "customer",
    "jobType",
    "location",
    "repCode",
    "pmCode",
    "estimator",
    "estimateHrs",
    "contractCents",
    "materialCostCents",
    "materialRevenueCents",
    "exterior",
    "billingMethod",
    "retainagePct",
    "retainageRelease",
    "retainageReleaseNote",
    "customerPo",
    "billTo",
    "lienWaivers",
    "certifiedPayroll",
    "requirements",
    "active",
  ],
};

export const can = {
  addJob: (r: Role) => ([...OFFICE_ALL, "scheduler", "job_setup"] as Role[]).includes(r),
  editCrewRecords: (r: Role) => ([...OFFICE_ALL, "scheduler"] as Role[]).includes(r),
  addPerson: (r: Role) => ([...OFFICE_ALL, "scheduler"] as Role[]).includes(r),
  setRosterActive: (r: Role) => OFFICE_ALL.includes(r),
  editSettings: (r: Role) => OFFICE_ALL.includes(r),
  manageAccess: (r: Role) => OFFICE_ALL.includes(r),
  readChangeLog: (r: Role) => ([...OFFICE_ALL, "scheduler", "job_setup", "estimator", "pm", "sales_rep"] as Role[]).includes(r),
  /** Settings, access and roster changes stay with the office. */
  readWholeChangeLog: (r: Role) => ([...OFFICE_ALL, "scheduler"] as Role[]).includes(r),
  closeWeek: (r: Role) => ([...OFFICE_ALL, "scheduler"] as Role[]).includes(r),
  sendDigest: (r: Role) => ([...OFFICE_ALL, "scheduler"] as Role[]).includes(r),
  editJourney: (r: Role) => OFFICE_ALL.includes(r),
  recordInvoices: (r: Role) => ([...OFFICE_ALL, "accounting"] as Role[]).includes(r),
  seeMoney: (r: Role) => ([...OFFICE_ALL, "scheduler", "pm", "sales_rep", "accounting", "job_setup"] as Role[]).includes(r),
};
