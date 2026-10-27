import { settingProblem } from "../domain/settingsRules";
import type { Settings } from "../domain/types";
import type { Ctx } from "../Workspace";

const FIELDS: { k: keyof Settings; label: string; kind: "num" | "money" | "mmdd" | "list" | "milestones"; note?: string }[] = [
  { k: "absencePct", label: "Absence rate (%)", kind: "num", note: "Taken off capacity every week." },
  { k: "hoursPerManWeek", label: "Hours per man-week", kind: "num" },
  { k: "dedicatedLeaderHrs", label: "Job size that needs a dedicated leader (hrs)", kind: "num", note: "Smaller jobs share a leader." },
  { k: "smallJobLeaderWeight", label: "Leaders counted for a smaller job", kind: "num" },
  { k: "overrunPct", label: "Overrun warning (%)", kind: "num", note: "Flags a job on pace to beat its projected hours by this much." },
  { k: "burdenedRateCents", label: "Burdened labor cost per hour ($)", kind: "money", note: "Used to split new contracts at intake. Existing jobs keep their split." },
  { k: "targetHeadcount", label: "Target working headcount", kind: "num" },
  { k: "confirmDatesDays", label: "Ask to confirm best-guess dates this many days out", kind: "num" },
  { k: "openCapacityHrs", label: "Open capacity alert: hours open in a week", kind: "num" },
  { k: "openWindowStartWeeks", label: "Open capacity alert: from this many weeks out", kind: "num" },
  { k: "openWindowEndWeeks", label: "Open capacity alert: to this many weeks out", kind: "num" },
  { k: "certFirstDays", label: "First certification reminder (days before expiry)", kind: "num" },
  { k: "certSecondDays", label: "Second certification reminder (days before expiry)", kind: "num" },
  { k: "autoFillWeeksOut", label: "Crew auto-fill looks this many weeks out", kind: "num" },
  { k: "woReviewDays", label: "Work order review deadline (days per step)", kind: "num" },
  { k: "woStartSoonDays", label: "Flag jobs starting within this many days without a final work order", kind: "num" },
  { k: "journeyLookaheadDays", label: "Job journey: starting-soon window (days)", kind: "num" },
  { k: "payAppDay", label: "Progress pay applications due (day of month)", kind: "num" },
  { k: "invoiceDays", label: "Final invoice due this many days after sign-off", kind: "num" },
  { k: "underBilledFlagCents", label: "Flag final-only jobs under billed by more than ($)", kind: "money" },
  { k: "overBilledFlagPct", label: "Over or under billing shown red past this % of contract", kind: "num" },
  { k: "laborDivergencePts", label: "Flag labor % this many points from what hours suggest", kind: "num" },
  { k: "marginFadePts", label: "Flag margin down this many points from bid", kind: "num" },
  { k: "gapWindowWeeks", label: "Flag capacity gaps this many weeks ahead", kind: "num", note: "Also how far ahead the dashboard sums up date firmness." },
  { k: "journeySoonDays", label: "Job journey: a checkpoint is due soon this many days ahead", kind: "num" },
  {
    k: "milestoneDefaults",
    label: "Default milestones for milestone billing",
    kind: "milestones",
    note: "Name and percent, separated by commas, e.g. Mobilization 20, Coatings applied 40. The rest bills at customer sign-off.",
  },
  { k: "scorecardMonths", label: "Leader scorecard looks back (months)", kind: "num" },
  { k: "closeoutCauses", label: "Overrun causes the PM can tag at closeout", kind: "list", note: "Separate with commas." },
  { k: "winterStart", label: "Winter window starts (MM-DD)", kind: "mmdd" },
  { k: "winterEnd", label: "Winter window ends (MM-DD)", kind: "mmdd" },
];

/** Thresholds an admin can change (hard rule 8). Every change is logged. */
export function SettingsScreen({ ctx }: { ctx: Ctx }) {
  const { data, repo, run } = ctx;
  const s = data.ds.settings;
  const commit = (k: keyof Settings, kind: string, raw: string) => {
    let v: number | string | string[];
    if (kind === "milestones") {
      const ms = raw
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => {
          const m = x.match(/^(.*?)\s+(\d+(?:\.\d+)?)\s*%?$/);
          return m ? { label: m[1].trim(), pct: Number(m[2]) } : { label: x, pct: NaN };
        });
      const problem = settingProblem(k, ms as never, s);
      if (problem) return void run(() => Promise.reject(new Error(problem)));
      if (JSON.stringify(ms) === JSON.stringify(s[k])) return;
      return void run(() => repo.updateSetting(k, ms as never), "Setting saved.");
    } else if (kind === "list") {
      const list = raw.split(",").map((x) => x.trim()).filter(Boolean);
      if (!list.length) return void run(() => Promise.reject(new Error("Keep at least one cause.")));
      if (JSON.stringify(list) === JSON.stringify(s[k])) return;
      return void run(() => repo.updateSetting(k, list as never), "Setting saved.");
    } else if (kind === "mmdd") {
      if (!/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(raw)) return void run(() => Promise.reject(new Error("Use MM-DD, for example 12-01.")));
      v = raw;
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) return void run(() => Promise.reject(new Error("Enter a number zero or above.")));
      v = kind === "money" ? Math.round(n * 100) : n;
    }
    if (v === s[k]) return;
    const problem = settingProblem(k, v as never, s, kind === "money" ? (c) => "$" + (c / 100).toLocaleString("en-US") : String);
    if (problem) return void run(() => Promise.reject(new Error(problem)));
    void run(() => repo.updateSetting(k, v as never), "Setting saved.");
  };
  return (
    <>
      <h1>Settings</h1>
      <p className="lead">The numbers behind capacity and the alerts. Change them as actuals come in; each change is logged with your name.</p>
      <div className="panel">
        <div className="fg">
          {FIELDS.map((f) => (
            <label className="field" key={f.k}>
              {f.label}
              <input
                key={JSON.stringify(s[f.k])}
                defaultValue={
                  f.kind === "money"
                    ? Number(s[f.k]) / 100
                    : f.kind === "list"
                      ? (s[f.k] as string[]).join(", ")
                      : f.kind === "milestones"
                        ? (s[f.k] as Settings["milestoneDefaults"]).map((m) => `${m.label} ${m.pct}`).join(", ")
                        : String(s[f.k])
                }
                inputMode={f.kind === "mmdd" ? "text" : "decimal"}
                onBlur={(e) => commit(f.k, f.kind, e.target.value.trim())}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              />
              {f.note && <span className="q">{f.note}</span>}
            </label>
          ))}
        </div>
      </div>
    </>
  );
}
