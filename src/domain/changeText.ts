import { BILLING_METHOD_LABEL } from "./money";
import { firmnessLabel } from "./schedule";
import type { ChangeLogEntry, Dataset, Firmness, Job } from "./types";
import { fmtShort } from "./weeks";

/**
 * Plain-English wording for change-log rows. The sample logs camelCase field names and the
 * database logs column names, so both spellings are handled here.
 */

export const STATUS_LABEL: Record<Job["status"], string> = {
  scheduled: "Scheduled",
  active: "In progress",
  on_hold: "On hold",
  complete: "Complete",
};

const FIELD_LABEL: Record<string, string> = {
  leaderId: "Job leader",
  projectedFinish: "Projected finish",
  baselineFinish: "Finish when first scheduled",
  actualFinish: "Actual finish",
  start: "Start",
  mustFinish: "Must finish",
  mustFinishReason: "Deadline type",
  firmness: "Date firmness",
  firmnessReason: "Firmness reason",
  waitsOnJobId: "Waits on",
  status: "Status",
  holdReason: "Hold reason",
  holdUntil: "Expected restart",
  crewSize: "Crew size",
  projectedHrs: "Projected hours",
  estimateHrs: "Estimate hours",
  customer: "Customer",
  jobType: "Job type",
  location: "Location",
  repCode: "Sales rep",
  pmCode: "PM",
  estimator: "Estimator",
  contractCents: "Contract value",
  materialCostCents: "Materials cost",
  materialRevenueCents: "Materials revenue",
  burdenedRateCents: "Burdened labor rate",
  exterior: "Exterior",
  billingMethod: "Billing method",
  retainagePct: "Retainage %",
  retainageRelease: "Retainage release",
  retainageReleaseNote: "Retainage release note",
  customerPo: "Customer PO",
  billTo: "Bill to",
  lienWaivers: "Lien waivers",
  certifiedPayroll: "Certified payroll",
  requirements: "Requirements",
  siteAddress: "Site address",
  siteStartTime: "Site start time",
  siteContact: "Site contact",
  siteOrientation: "Site orientation",
  sitePpe: "PPE",
  active: "Active",
  fileName: "Draft file",
  returnedComment: "Send-back comment",
  filed: "Filed in Procore",
  currentStep: "Sign-off step",
  personId: "Person",
  hours: "Hours",
  dotExpires: "DOT expires",
  driver: "Driver",
  kind: "Type",
  phone: "Phone",
  name: "Name",
  role: "Role",
};

const RELEASE_LABEL: Record<string, string> = { substantial: "Substantial completion", final: "Final completion", other: "Other" };

const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const ISO = /\b(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+Z?)?\b/g;
const datesIn = (s: string) => s.replace(ISO, (m) => fmtShort(m.slice(0, 10)));
const usd = (cents: number) => "$" + Math.round(cents / 100).toLocaleString("en-US");

export type Names = Pick<Dataset, "people" | "reps" | "pms" | "jobs">;

export function fieldLabel(field: string): string {
  const k = camel(field);
  return FIELD_LABEL[k] ?? datesIn(field.replace(/_/g, " "));
}

export function valueText(field: string, v: string | null, n: Names, table = ""): string {
  if (v === null || v === "") return "blank";
  const k = camel(field);
  if (k === "added") return addedText(table, v);
  if (v === "true") return "yes";
  if (v === "false") return "no";
  switch (k) {
    case "leaderId":
    case "personId":
      return n.people.find((p) => p.id === v)?.name ?? "someone not on the roster";
    case "waitsOnJobId": {
      const j = n.jobs.find((x) => x.id === v);
      return j ? `${j.number} ${j.customer}` : "another job";
    }
    case "repCode":
      return n.reps.find((r) => r.code === v)?.name ?? v;
    case "pmCode":
      return n.pms.find((r) => r.code === v)?.name ?? v;
    case "firmness":
      return firmnessLabel(v as Firmness);
    case "status":
      return STATUS_LABEL[v as Job["status"]] ?? v;
    case "billingMethod":
      return BILLING_METHOD_LABEL[v as Job["billingMethod"]] ?? v;
    case "retainageRelease":
      return RELEASE_LABEL[v] ?? v;
    case "retainagePct":
      return v + "%";
  }
  if (/Cents$/.test(k) && /^-?\d+$/.test(v)) return usd(Number(v));
  return datesIn(v);
}

/** The database logs a new row as JSON; say what was added in a few words. */
function addedText(table: string, v: string): string {
  if (!v.startsWith("{")) return datesIn(v);
  try {
    const r = JSON.parse(v) as Record<string, unknown>;
    switch (table) {
      case "jobs":
        return `${r.customer}, ${r.estimate_hrs} hrs`;
      case "actual_hours":
      case "hour_entries":
        return `${r.hours} hrs, week ending ${fmtShort(String(r.week))}${r.source ? ` (${r.source})` : ""}`;
      case "plan_overrides":
        return `${r.hours} hrs, week ending ${fmtShort(String(r.week))}`;
      case "assignments":
        return `crew, week ending ${fmtShort(String(r.week))}`;
      case "time_off":
        return `${fmtShort(String(r.first_day))} to ${fmtShort(String(r.last_day))}${r.type ? ` (${r.type})` : ""}`;
      case "change_orders":
        return `${r.number ?? "Change order"}: ${usd(Number(r.amount_cents ?? 0))}, ${r.hours ?? 0} hrs`;
      case "invoices":
        return `${r.kind} invoice${r.number ? " " + r.number : ""}${r.amount_cents != null ? ", " + usd(Number(r.amount_cents)) : ""}`;
      case "job_notes":
        return String(r.body ?? "note");
      case "people":
      case "app_users":
        return String(r.name ?? r.email ?? "added");
      default:
        return "added";
    }
  } catch {
    return "added";
  }
}

/** One line for a change, e.g. "Job leader Tony Becker → Ben Schultz". */
export function describeChange(c: ChangeLogEntry, n: Names): string {
  if (c.field === "added") {
    const what = c.table === "jobs" ? "job" : c.table.replace(/_/g, " ").replace(/s$/, "");
    const detail = c.newValue ? valueText("added", c.newValue, n, c.table) : "";
    return `${what} added${detail && detail !== "added" ? ": " + detail : ""}`;
  }
  return `${fieldLabel(c.field)} ${valueText(c.field, c.oldValue, n, c.table)} → ${valueText(c.field, c.newValue, n, c.table)}`;
}
