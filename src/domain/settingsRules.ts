import type { Settings } from "./types";

type NumericKey = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings];

/**
 * The range each number setting may take, so a typo can't break capacity or the alerts.
 * The database's settings_guard holds the same limits (the database tests compare them).
 */
export const SETTING_LIMITS: Record<NumericKey, { min: number; max: number; whole?: boolean }> = {
  absencePct: { min: 0, max: 50 },
  hoursPerManWeek: { min: 1, max: 80 },
  dedicatedLeaderHrs: { min: 1, max: 100000, whole: true },
  smallJobLeaderWeight: { min: 0, max: 1 },
  overrunPct: { min: 1, max: 200 },
  burdenedRateCents: { min: 100, max: 50000, whole: true },
  targetHeadcount: { min: 1, max: 1000, whole: true },
  confirmDatesDays: { min: 1, max: 365, whole: true },
  openCapacityHrs: { min: 0, max: 100000, whole: true },
  openWindowStartWeeks: { min: 0, max: 26, whole: true },
  openWindowEndWeeks: { min: 1, max: 26, whole: true },
  certFirstDays: { min: 1, max: 365, whole: true },
  certSecondDays: { min: 1, max: 365, whole: true },
  autoFillWeeksOut: { min: 0, max: 12, whole: true },
  woReviewDays: { min: 1, max: 30, whole: true },
  woStartSoonDays: { min: 1, max: 90, whole: true },
  journeyLookaheadDays: { min: 1, max: 120, whole: true },
  payAppDay: { min: 1, max: 28, whole: true },
  invoiceDays: { min: 0, max: 90, whole: true },
  underBilledFlagCents: { min: 0, max: 100_000_000, whole: true },
  overBilledFlagPct: { min: 0, max: 100 },
  laborDivergencePts: { min: 1, max: 100 },
  marginFadePts: { min: 1, max: 100 },
  scorecardMonths: { min: 1, max: 60, whole: true },
};

/** Why a new setting value can't be saved, or null when it's fine. */
export function settingProblem<K extends keyof Settings>(key: K, value: Settings[K], s: Settings, show: (n: number) => string = String): string | null {
  const lim = (SETTING_LIMITS as Record<string, { min: number; max: number; whole?: boolean }>)[key];
  if (lim) {
    const n = value as number;
    if (typeof n !== "number" || !Number.isFinite(n)) return "Enter a number.";
    if (n < lim.min || n > lim.max) return `Use a number from ${show(lim.min)} to ${show(lim.max)}.`;
    if (lim.whole && !Number.isInteger(n)) return "Use a whole number.";
  }
  const next = { ...s, [key]: value };
  if (next.openWindowStartWeeks > next.openWindowEndWeeks) return "The open capacity window has to start before it ends.";
  if (next.certSecondDays >= next.certFirstDays) return "The second certification reminder has to come after the first, so use fewer days.";
  return null;
}
