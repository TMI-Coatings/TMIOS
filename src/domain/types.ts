import type { CheckpointDef, JobCheckpoint, JourneyStage } from "./journey";
import type { WorkOrder } from "./workOrders";
import type { ChangeOrder, Invoice, Milestone, PercentEntry, RetainageReceipt } from "./money";
import type { Outcome } from "./scorecard";

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
  /** Burdened labor rate when the job was set up; frozen so a rate change never rewrites its margin (decision 22). */
  burdenedRateCents: number;
  start: IsoDate;
  projectedFinish: IsoDate;
  baselineFinish: IsoDate;
  mustFinish: IsoDate | null;
  mustFinishReason: MustFinishReason | null;
  actualFinish: IsoDate | null;
  status: JobStatus;
  firmness: Firmness;
  waitsOnJobId: string | null;
  firmnessReason: string | null;
  holdReason: string | null;
  holdUntil: IsoDate | null;
  exterior: boolean;
  billingMethod: BillingMethod;
  /** Percent, e.g. 5 for 5%. Varies by contract (decision 17). */
  retainagePct: number;
  retainageRelease: RetainageRelease | null;
  retainageReleaseNote: string | null;
  customerPo: string;
  billTo: string;
  lienWaivers: boolean;
  certifiedPayroll: boolean;
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
  openCapacityHrs: number;
  openWindowStartWeeks: number;
  openWindowEndWeeks: number;
  certFirstDays: number;
  certSecondDays: number;
  autoFillWeeksOut: number;
  woReviewDays: number;
  woStartSoonDays: number;
  journeyLookaheadDays: number;
  payAppDay: number;
  invoiceDays: number;
  underBilledFlagCents: number;
  overBilledFlagPct: number;
  laborDivergencePts: number;
  marginFadePts: number;
  closeoutCauses: string[];
  scorecardMonths: number;
  /** How far ahead capacity gaps are flagged and firmness is summarized. */
  gapWindowWeeks: number;
  /** A journey checkpoint counts as "due soon" this many days ahead. */
  journeySoonDays: number;
  /** The milestones a job starts with when it switches to milestone billing; the rest bills at sign-off. */
  milestoneDefaults: { label: string; pct: number }[];
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
  openCapacityHrs: 400,
  openWindowStartWeeks: 4,
  openWindowEndWeeks: 8,
  certFirstDays: 60,
  certSecondDays: 30,
  autoFillWeeksOut: 3,
  woReviewDays: 2,
  woStartSoonDays: 14,
  journeyLookaheadDays: 21,
  payAppDay: 25,
  invoiceDays: 3,
  underBilledFlagCents: 100000,
  overBilledFlagPct: 10,
  laborDivergencePts: 15,
  marginFadePts: 3,
  closeoutCauses: ["Field", "Estimate", "Change order not captured", "Customer delay", "Weather"],
  scorecardMonths: 12,
  gapWindowWeeks: 8,
  journeySoonDays: 7,
  milestoneDefaults: [
    { label: "Mobilization", pct: 20 },
    { label: "Surface prep complete", pct: 30 },
    { label: "Coatings applied", pct: 40 },
  ],
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

export interface WeekClose {
  week: IsoDate;
  entered: number;
  totalHrs: number;
  missingJobIds: string[];
  completedJobIds: string[];
}

export interface HourEntry {
  jobId: string;
  week: IsoDate;
  hours: number;
  source: "typed" | "csv" | "import";
}

export interface WeeklyMetric {
  week: IsoDate;
  utilization: number | null;
  utilizationRoster: number | null;
  backlogWeeks: number | null;
  backlogCents: number | null;
  accuracy: number | null;
  onTime: number | null;
  illustrative: boolean;
}

export interface ForecastSnapshot {
  madeWeek: IsoDate;
  targetWeek: IsoDate;
  jobId: string;
  hours: number;
}

export const ALERT_RULES = [
  { id: "wo", name: "Work order", desc: "Draft ready, sign-offs, send-backs and late reviews" },
  { id: "bill", name: "Billing", desc: "Job complete and signed off, ready to invoice; late invoices" },
  { id: "open", name: "Open capacity", desc: "Unsold hours 4 to 8 weeks out, for the sales team" },
  { id: "date", name: "Date moved", desc: "Start or finish changes on any job" },
  { id: "overrun", name: "Overrun warning", desc: "Job on pace to beat its hours by the threshold" },
  { id: "crew", name: "Crew change", desc: "Crew size or leader changes" },
  { id: "gap", name: "Capacity gap", desc: "Men or leaders short in the next 8 weeks" },
  { id: "digest", name: "Monday digest", desc: "Week ahead, gaps, missing hours, accuracy" },
  { id: "hours", name: "Hours reminder", desc: "A nudge from the scheduler to enter this week’s hours" },
  { id: "cert", name: "Certification reminder", desc: "DOT physical or certification expiring in 60 or 30 days" },
] as const;
export type AlertRule = (typeof ALERT_RULES)[number]["id"];

export interface Alert {
  id: string;
  at: string;
  rule: AlertRule;
  title: string;
  body: string;
  recipients: string[];
  jobId: string | null;
  personId: string | null;
}

/** My week: what a person needs about the jobs they're on this week and next. */
export interface MyWeek {
  person: { id: string; name: string; driver: boolean; dotExpires: IsoDate | null };
  certs: { name: string; expires: IsoDate | null }[];
  weeks: {
    week: IsoDate;
    acknowledged: string | null;
    timeOff: { firstDay: IsoDate; lastDay: IsoDate; type: string }[];
    jobs: {
      number: string;
      customer: string;
      jobType: string;
      location: string;
      from: IsoDate;
      to: IsoDate;
      siteAddress: string;
      siteStartTime: string;
      siteContact: string;
      siteOrientation: string;
      sitePpe: string;
      leader: string | null;
      leaderPhone: string | null;
      notes: string[];
      crew: string[];
    }[];
  }[];
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
  closes: WeekClose[];
  hourEntries: HourEntry[];
  confirmations: { jobId: string; week: IsoDate }[];
  metrics: WeeklyMetric[];
  workOrders: WorkOrder[];
  stages: JourneyStage[];
  checkpointDefs: CheckpointDef[];
  jobCheckpoints: JobCheckpoint[];
  percents: PercentEntry[];
  changeOrders: ChangeOrder[];
  milestones: Milestone[];
  invoices: Invoice[];
  retainageReceipts: RetainageReceipt[];
  outcomes: Outcome[];
  /** Names only, so screens can say who a step waits on. */
  staff: { schedulers: string[]; jobSetup: string[]; estimators: string[] };
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
  /** On the estimator list though their role is something else (Access → "Also estimates"). */
  alsoEstimator?: boolean;
}
