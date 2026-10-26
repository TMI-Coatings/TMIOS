export const ROLES = [
  "admin",
  "ceo",
  "scheduler",
  "job_setup",
  "estimator",
  "pm",
  "superintendent",
  "sales_rep",
  "field_crew",
  "accounting",
  "cfo",
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  ceo: "CEO",
  scheduler: "Scheduler",
  job_setup: "Job setup",
  estimator: "Estimator",
  pm: "Project manager",
  superintendent: "Superintendent / job leader",
  sales_rep: "Sales rep",
  field_crew: "Field crew",
  accounting: "Accounting",
  cfo: "CFO",
};

export type Firmness = "locked" | "confirmed" | "waiting" | "flexible" | "best_guess" | "fill_in";
export type JobStatus = "scheduled" | "active" | "on_hold" | "complete";
export type MustFinishReason = "shutdown" | "contract";
export type RetainageRelease = "substantial_completion" | "final_completion" | "other";
export type BillingMethod = "final" | "monthly" | "milestone";
export type PersonKind = "leader" | "field" | "leadership";
export type TimeOffType = "PTO" | "Holiday" | "Hunting" | "Medical" | "Other";

/** ISO date string, YYYY-MM-DD. */
export type IsoDate = string;

export interface Job {
  id: string;
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
  projectedHrs: number;
  contractCents: number;
  materialCostCents: number;
  /** Frozen at intake (decision 22). */
  materialRevenueCents: number;
  start: IsoDate;
  projectedFinish: IsoDate;
  baselineFinish: IsoDate;
  mustFinish: IsoDate | null;
  mustFinishReason: MustFinishReason | null;
  actualFinish: IsoDate | null;
  status: JobStatus;
  firmness: Firmness;
  waitsOnJobId: string | null;
  holdReason: string | null;
  holdUntil: IsoDate | null;
  exterior: boolean;
  billingMethod: BillingMethod;
  /** Percent, e.g. 5 for 5%. Varies by contract (decision 17). */
  retainagePct: number;
  retainageRelease: RetainageRelease | null;
  retainageReleaseNote: string | null;
  requirements: string[];
  siteAddress: string;
  siteStartTime: string;
  siteContact: string;
  siteOrientation: string;
  sitePpe: string;
  active: boolean;
}

export interface Person {
  id: string;
  name: string;
  kind: PersonKind;
  state: string;
  phone: string;
  driver: boolean;
  dotExpires: IsoDate | null;
  active: boolean;
  /** qualification name -> expiry date (null = no expiry recorded) */
  quals: Record<string, IsoDate | null>;
}

export interface TimeOff {
  id: string;
  personId: string;
  firstDay: IsoDate;
  lastDay: IsoDate;
  type: TimeOffType;
  active: boolean;
}

export interface PlanOverride {
  jobId: string;
  week: IsoDate;
  hours: number;
}

export interface ActualHours {
  jobId: string;
  week: IsoDate;
  hours: number;
}

export interface Assignment {
  id: string;
  jobId: string;
  personId: string;
  week: IsoDate;
}

export interface JobNote {
  id: string;
  jobId: string;
  text: string;
  pinned: boolean;
  crewVisible: boolean;
  author: string;
  createdAt: string;
}

export interface Settings {
  absencePct: number;
  hoursPerManWeek: number;
  dedicatedLeaderHrs: number;
  overrunPct: number;
  burdenedRateCents: number;
  targetHeadcount: number;
  winterStart: string; // MM-DD
  winterEnd: string; // MM-DD
  confirmDatesDays: number;
  smallJobLeaderWeight: number;
}

export const DEFAULT_SETTINGS: Settings = {
  absencePct: 10,
  hoursPerManWeek: 40,
  dedicatedLeaderHrs: 400,
  overrunPct: 15,
  burdenedRateCents: 5500,
  targetHeadcount: 50,
  winterStart: "12-01",
  winterEnd: "03-15",
  confirmDatesDays: 28,
  smallJobLeaderWeight: 0.5,
};

export interface Lookup {
  code: string;
  name: string;
}

export interface ChangeLogEntry {
  id: string;
  at: string;
  who: string;
  table: string;
  recordId: string;
  recordLabel: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

/** Everything the Schedule and Crew screens read. */
export interface Dataset {
  jobs: Job[];
  people: Person[];
  timeOff: TimeOff[];
  overrides: PlanOverride[];
  actuals: ActualHours[];
  assignments: Assignment[];
  notes: JobNote[];
  settings: Settings;
  qualifications: string[];
  reps: Lookup[];
  pms: Lookup[];
}

/** The signed-in person as the app sees them. */
export interface Viewer {
  userId: string;
  name: string;
  email: string;
  role: Role;
  personId: string | null;
  repCode: string | null;
  pmCode: string | null;
}
