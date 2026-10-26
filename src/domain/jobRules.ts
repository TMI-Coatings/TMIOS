import type { Job } from "./types";

/**
 * The checks the database also enforces (constraints and the jobs trigger), run before saving
 * so people get a plain message instead of an error.
 */
export function jobProblem(before: Job | null, after: Job): string | null {
  if (!/^\d{4}$/.test(after.number)) return "Job numbers are four digits.";
  if (!after.customer.trim()) return "Customer is required.";
  if (after.projectedFinish < after.start) return "The finish date has to be on or after the start date.";
  if (after.status === "on_hold" && (!after.holdReason?.trim() || !after.holdUntil)) return "Jobs on hold need a reason and an expected restart date.";
  if (after.firmness === "waiting" && !after.waitsOnJobId) return "Pick the job this one waits on.";
  if (after.waitsOnJobId && after.waitsOnJobId === after.id) return "A job can't wait on itself.";
  if (!!after.mustFinish !== !!after.mustFinishReason) return "Pick a deadline type: shutdown or contract obligation.";
  if (after.retainagePct > 0 && !after.retainageRelease) return "Jobs with retainage need release terms.";
  if (after.retainagePct < 0 || after.retainagePct > 100) return "Retainage is a percent between 0 and 100.";
  if (
    before &&
    before.firmness === "locked" &&
    after.firmness !== "locked" &&
    (!after.firmnessReason?.trim() || after.firmnessReason === before.firmnessReason)
  )
    return "Moving a job off Locked needs a reason. It goes in the job notes.";
  return null;
}
