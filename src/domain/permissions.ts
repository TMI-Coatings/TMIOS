import type { Job, Role, Viewer } from "./types";

/**
 * Who may do what. The screens use this to show or hide controls; the database enforces the
 * same rules with row-level security and the jobs edit trigger (supabase/migrations). The
 * database tests run every rule here against Postgres, so the two can't drift apart.
 */

const OFFICE_ALL: Role[] = ["admin", "ceo"];

export type Tab = "schedule" | "crew" | "access" | "settings" | "log";

export const TABS: { id: Tab; label: string; roles: Role[] }[] = [
  {
    id: "schedule",
    label: "Schedule",
    roles: ["admin", "ceo", "scheduler", "job_setup", "estimator", "pm", "superintendent", "sales_rep", "accounting", "cfo"],
  },
  { id: "crew", label: "Crew", roles: ["admin", "ceo", "scheduler"] },
  { id: "log", label: "Change log", roles: ["admin", "ceo", "scheduler"] },
  { id: "access", label: "Access", roles: ["admin", "ceo"] },
  { id: "settings", label: "Settings", roles: ["admin", "ceo"] },
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

const SEES_ALL_JOBS: Role[] = ["admin", "ceo", "scheduler", "job_setup", "estimator", "accounting", "cfo"];

export function canSeeJob(v: Viewer, j: Job): boolean {
  if (SEES_ALL_JOBS.includes(v.role)) return true;
  if (v.role === "superintendent" || v.role === "sales_rep" || v.role === "pm") return owns(v, j);
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
  | "pinNotes";

type Rule = { any: Role[]; own?: Role[] };

export const JOB_FIELD_RULES: Record<JobField, Rule> = {
  // Decision 8: admin, ceo, scheduler on any job; a PM on their own.
  plan: { any: [...OFFICE_ALL, "scheduler"], own: ["pm"] },
  start: { any: [...OFFICE_ALL, "scheduler"], own: ["pm"] },
  projectedFinish: { any: [...OFFICE_ALL, "scheduler"], own: ["pm", "superintendent"] },
  crewSize: { any: OFFICE_ALL, own: ["superintendent"] },
  leaderId: { any: OFFICE_ALL },
  projectedHrs: { any: OFFICE_ALL },
  mustFinish: { any: OFFICE_ALL },
  firmness: { any: [...OFFICE_ALL, "scheduler"], own: ["pm", "sales_rep"] },
  status: { any: [...OFFICE_ALL, "scheduler"] },
  actualFinish: { any: [...OFFICE_ALL, "scheduler"] },
  site: { any: [...OFFICE_ALL, "scheduler"] },
  intake: { any: [...OFFICE_ALL, "job_setup"] },
  crew: { any: OFFICE_ALL, own: ["superintendent"] },
  notes: { any: [...OFFICE_ALL, "scheduler"], own: ["superintendent"] },
  pinNotes: { any: OFFICE_ALL },
};

export function canEditJob(v: Viewer, j: Job, f: JobField): boolean {
  const r = JOB_FIELD_RULES[f];
  if (r.any.includes(v.role)) return true;
  return !!r.own?.includes(v.role) && owns(v, j);
}

/** Which job columns each field group covers (used by the edit form and mirrored in the database trigger). */
export const JOB_COLUMNS: Record<Exclude<JobField, "plan" | "crew" | "notes" | "pinNotes">, (keyof Job)[]> = {
  start: ["start"],
  projectedFinish: ["projectedFinish"],
  crewSize: ["crewSize"],
  leaderId: ["leaderId"],
  projectedHrs: ["projectedHrs"],
  mustFinish: ["mustFinish", "mustFinishReason"],
  firmness: ["firmness", "waitsOnJobId"],
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
  readChangeLog: (r: Role) => ([...OFFICE_ALL, "scheduler"] as Role[]).includes(r),
};
