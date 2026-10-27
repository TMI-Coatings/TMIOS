/**
 * Alert wording and routing. In production the database writes alerts (supabase/migrations
 * weekly_close: job_alerts, capacity_check, cert_reminders, close_week) and decides who sees
 * them (app.can_see_alert). Sample mode uses these functions to do the same in the browser.
 */
import { gapWeeks, openWeeks } from "./insights";
import { type Index, type Plans, availableMen, capacity, eac, firmnessLabel, leadersNeeded, loadForWeek } from "./schedule";
import { ALERT_RULES, type Alert, type AlertRule, type Dataset, type IsoDate, type Job, type Person, type Role, type Settings, type Viewer } from "./types";
import { addDays, daysBetween, fmtLong, fmtShort } from "./weeks";

const n0 = (v: number) => Math.round(v).toLocaleString("en-US");
const n1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString("en-US");
const d = (x: IsoDate | null) => (x ? fmtShort(x) : "blank");

export type NewAlert = Omit<Alert, "id" | "at">;

export function jobRecipients(ds: Dataset, j: Job): string[] {
  const pm = ds.pms.find((p) => p.code === j.pmCode)?.name ?? j.pmCode;
  const leader = ds.people.find((p) => p.id === j.leaderId)?.name;
  return ["PM " + pm, ...(leader ? [leader] : []), "Leadership"];
}


/** Date moved, firmness off or onto Locked, on or off hold, crew size or leader changed. */
export function jobChangeAlerts(ds: Dataset, before: Job, after: Job, who: string): NewAlert[] {
  const out: NewAlert[] = [];
  const to = jobRecipients(ds, after);
  const title = `${after.number} ${after.customer}`;
  const base = { recipients: to, jobId: after.id, personId: null };
  const lines: string[] = [];
  if (before.start !== after.start) lines.push(`Start ${d(before.start)} → ${d(after.start)}`);
  if (before.projectedFinish !== after.projectedFinish) lines.push(`Projected finish ${d(before.projectedFinish)} → ${d(after.projectedFinish)}`);
  if (before.mustFinish !== after.mustFinish) lines.push(`Must finish ${d(before.mustFinish)} → ${d(after.mustFinish)}`);
  if (lines.length) {
    if (after.mustFinish && after.projectedFinish > after.mustFinish) lines.push(`Projected finish is now after the must-finish date of ${d(after.mustFinish)}.`);
    out.push({ ...base, rule: "date", title: "Date moved: " + title, body: [...lines, `Changed by ${who}.`].join("\n") });
  }
  if (before.firmness !== after.firmness && (before.firmness === "locked" || after.firmness === "locked"))
    out.push({
      ...base,
      rule: "date",
      title: "Firmness changed: " + title,
      body: `${firmnessLabel(before.firmness)} → ${firmnessLabel(after.firmness)}${after.firmnessReason?.trim() ? "\nReason: " + after.firmnessReason.trim() : ""}\nChanged by ${who}.`,
    });
  if (before.status !== after.status && (before.status === "on_hold" || after.status === "on_hold"))
    out.push({
      ...base,
      rule: "date",
      title: (after.status === "on_hold" ? "On hold: " : "Off hold: ") + title,
      body:
        (after.status === "on_hold"
          ? `${after.holdReason}. Expected restart ${d(after.holdUntil)}. Hours come out of capacity until then.`
          : `Back in the capacity count from ${d(after.start)}.`) + `\nChanged by ${who}.`,
    });
  const crew: string[] = [];
  if (before.crewSize !== after.crewSize) crew.push(`Crew size ${before.crewSize} → ${after.crewSize}`);
  if (before.leaderId !== after.leaderId) {
    const nm = (id: string | null) => ds.people.find((p) => p.id === id)?.name ?? "none";
    crew.push(`Job leader ${nm(before.leaderId)} → ${nm(after.leaderId)}`);
  }
  if (crew.length) out.push({ ...base, rule: "crew", title: "Crew change: " + title, body: [...crew, `Changed by ${who}.`].join("\n") });
  return out;
}

/** Capacity gap and open-capacity alerts; fire only when the set of weeks changes. */
export function capacityAlerts(ds: Dataset, idx: Index, plans: Plans, week: IsoDate, state: Record<string, string>): NewAlert[] {
  const out: NewAlert[] = [];
  const s = ds.settings;
  const gaps = gapWeeks(ds, idx, plans, week);
  const gapKey = gaps.join(",");
  if (gapKey && gapKey !== (state.gap ?? "")) {
    out.push({
      rule: "gap",
      title: `Capacity gap in ${gaps.length} of the next 8 weeks`,
      body: gaps
        .map((w) => {
          const L = loadForWeek(ds, plans, w);
          const C = capacity(ds, idx, w);
          const LN = leadersNeeded(ds, plans, w);
          const LA = availableMen(ds, idx, w, true);
          const parts = [L > C ? `${n0(L)} hrs scheduled vs ${n0(C)} available` : "", LN > LA ? `${n1(LN)} leaders needed vs ${n1(LA)} available` : ""].filter(Boolean);
          return `Week ending ${fmtShort(w)}: ${parts.join("; ")}`;
        })
        .join("\n"),
      recipients: ["Leadership"],
      jobId: null,
      personId: null,
    });
  }
  state.gap = gapKey;
  const open = openWeeks(ds, idx, plans, week);
  const openKey = open.map((x) => x.week).join(",");
  if (openKey && openKey !== (state.open ?? "")) {
    out.push({
      rule: "open",
      title: `Open capacity to sell: ${open.length} week${open.length > 1 ? "s" : ""} ${s.openWindowStartWeeks} to ${s.openWindowEndWeeks} weeks out`,
      body:
        open.map((x) => `Week ending ${fmtShort(x.week)}: ${n0(x.open)} hrs open, about ${n0(x.open / s.hoursPerManWeek)} men`).join("\n") +
        "\nFast lane: existing accounts run about a month from quote to crews, so this is the window to sell into.",
      recipients: ["Sales team", "Leadership"],
      jobId: null,
      personId: null,
    });
  }
  state.open = openKey;
  return out;
}

/** DOT physicals (drivers only) and certifications at 60 and 30 days, and on expiry. */
export function certAlerts(ds: Dataset, week: IsoDate, state: Record<string, string>): NewAlert[] {
  const s = ds.settings;
  const out: NewAlert[] = [];
  for (const p of ds.people.filter((x) => x.active)) {
    const items: [string, IsoDate][] = [];
    if (p.driver && p.dotExpires) items.push(["DOT physical", p.dotExpires]);
    for (const [q, exp] of Object.entries(p.quals)) if (exp) items.push([q, exp]);
    for (const [item, exp] of items) {
      const days = daysBetween(week, exp);
      const step = days < 0 ? 0 : days <= s.certSecondDays ? s.certSecondDays : days <= s.certFirstDays ? s.certFirstDays : null;
      if (step == null) continue;
      const key = `cert|${p.id}|${item}|${exp}|${step}`;
      if (state[key]) continue;
      state[key] = "sent";
      out.push(certAlert(p, item, exp, days));
    }
  }
  return out;
}

function certAlert(p: Person, item: string, exp: IsoDate, days: number): NewAlert {
  return {
    rule: "cert",
    title: `${item}${days < 0 ? " expired: " : " expiring: "}${p.name}`,
    body:
      `${p.name}’s ${item} ${days < 0 ? "expired " + fmtLong(exp) : `expires in ${days} days (${fmtLong(exp)})`}. Reminder to ${p.name.split(" ")[0]}, copy to the scheduler.` +
      (item === "DOT physical" ? " Without a current card they can’t drive company vehicles, and the schedule will flag them." : ""),
    recipients: [p.name, "Scheduler"],
    jobId: null,
    personId: p.id,
  };
}

export function overrunAlert(ds: Dataset, idx: Index, j: Job, lastWeekHrs: number, left: number): NewAlert | null {
  const e = eac(idx, j);
  if (e <= j.projectedHrs * (1 + ds.settings.overrunPct / 100)) return null;
  return {
    rule: "overrun",
    title: `Overrun warning: ${j.number} ${j.customer}`,
    body: `On pace for ${n0(e)} hrs against ${n0(j.projectedHrs)} projected (+${Math.round((e / j.projectedHrs - 1) * 100)}%). Last week: ${n0(lastWeekHrs)} hrs. Hours left: ${n0(left)}.`,
    recipients: jobRecipients(ds, j),
    jobId: j.id,
    personId: null,
  };
}

/** Who sees which alert: same rules as app.can_see_alert in the database. */
export function canSeeAlert(v: Viewer, a: Pick<Alert, "rule" | "jobId" | "recipients">, ds: Dataset, week: IsoDate): boolean {
  const j = a.jobId ? ds.jobs.find((x) => x.id === a.jobId) : undefined;
  const myPersonName = ds.people.find((p) => p.id === v.personId)?.name;
  const r: AlertRule = a.rule;
  switch (v.role) {
    case "admin":
    case "ceo":
    case "cfo":
      return true;
    case "scheduler":
      return r !== "bill";
    case "accounting":
      return r === "bill" || r === "digest";
    case "job_setup":
      return r === "digest" || (r === "wo" && a.recipients.includes(v.name));
    case "estimator":
      return r === "wo" && a.recipients.includes(v.name);
    case "pm":
      return r === "digest" || (r === "wo" && a.recipients.includes(v.name)) || (!!j && j.pmCode === v.pmCode);
    case "sales_rep":
      return r === "open" || r === "digest" || (r === "wo" && a.recipients.includes(v.name)) || (!!j && j.repCode === v.repCode);
    case "superintendent":
      return r === "digest" || (r !== "bill" && r !== "wo" && !!j && j.leaderId === v.personId) || (r === "cert" && !!myPersonName && a.recipients.includes(myPersonName));
    case "field_crew":
      return (
        (r === "cert" && !!myPersonName && a.recipients.includes(myPersonName)) ||
        (r !== "bill" && r !== "wo" && !!j && ds.assignments.some((x) => x.jobId === j.id && x.personId === v.personId && (x.week === week || x.week === addDays(week, 7))))
      );
    default:
      return false;
  }
}

/** The alert rules that can ever reach a role (same routing as canSeeAlert), for the mute list. */
export function rulesFor(role: Role): AlertRule[] {
  switch (role) {
    case "admin":
    case "ceo":
    case "cfo":
      return ALERT_RULES.map((r) => r.id);
    case "scheduler":
      return ALERT_RULES.map((r) => r.id).filter((r) => r !== "bill");
    case "accounting":
      return ["bill", "digest"];
    case "job_setup":
      return ["wo", "digest"];
    case "estimator":
      return ["wo"];
    case "pm":
      return ["wo", "bill", "date", "overrun", "crew", "digest"];
    case "sales_rep":
      return ["wo", "bill", "open", "date", "overrun", "crew", "digest"];
    case "superintendent":
      return ["date", "overrun", "crew", "digest", "cert"];
    case "field_crew":
      return ["date", "overrun", "crew", "cert"];
  }
}

/** A rule's description with today's settings in it. */
export function ruleDesc(rule: AlertRule, s: Settings): string {
  switch (rule) {
    case "open":
      return `Unsold hours ${s.openWindowStartWeeks} to ${s.openWindowEndWeeks} weeks out, for the sales team`;
    case "cert":
      return `DOT physical or certification expiring in ${s.certFirstDays} or ${s.certSecondDays} days`;
    case "overrun":
      return `Job on pace to beat its hours by ${s.overrunPct}% or more`;
    default:
      return ALERT_RULES.find((r) => r.id === rule)!.desc;
  }
}
