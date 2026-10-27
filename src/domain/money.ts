/**
 * Revenue, WIP and billing. Mirrors the database (batch C migration): recognized revenue,
 * change orders, invoices, retainage held per invoice, billing state and the pay-app calendar.
 */
import { type Index, type Plans, actualToDate, eac, isSold } from "./schedule";
import type { Dataset, IsoDate, Job } from "./types";
import { addDays, mondayOf } from "./weeks";

export interface PercentEntry {
  jobId: string;
  week: IsoDate;
  materialsPct: number;
  laborPct: number;
  enteredBy: string;
}
export interface ChangeOrder {
  id: string;
  jobId: string;
  number: string;
  description: string;
  amountCents: number;
  /** Materials revenue in the change order. */
  materialCents: number;
  /** What those materials cost TMI. */
  materialCostCents: number;
  hours: number;
  approvedOn: IsoDate;
  approvedBy: string;
}
export interface Milestone {
  id: string;
  jobId: string;
  label: string;
  pct: number;
  sort: number;
  reachedOn: IsoDate | null;
  reachedBy: string | null;
}
export type InvoiceKind = "progress" | "milestone" | "final" | "skip";
export interface Invoice {
  id: string;
  jobId: string;
  kind: InvoiceKind;
  period: string | null;
  milestoneId: string | null;
  number: string | null;
  amountCents: number;
  /** Retainage the customer holds on this invoice, at the job's retainage % when it was billed (decision 17). */
  retainageCents: number;
  invoicedOn: IsoDate;
  recordedBy: string;
}
export interface RetainageReceipt {
  id: string;
  jobId: string;
  amountCents: number;
  receivedOn: IsoDate;
}

export const MILESTONE_TEMPLATE: [string, number][] = [
  ["Mobilization", 20],
  ["Surface prep complete", 30],
  ["Coatings applied", 40],
];
export const BILLING_METHOD_LABEL = { final: "Final invoice only", monthly: "Monthly progress billing", milestone: "Milestone billing" } as const;

export class Money {
  constructor(
    private ds: Dataset,
    private idx: Index,
    private week: IsoDate,
    private today: IsoDate,
  ) {}
  private cos = (j: Job) => this.ds.changeOrders.filter((c) => c.jobId === j.id);
  contract = (j: Job) => j.contractCents + this.cos(j).reduce((a, c) => a + c.amountCents, 0);
  materialRev = (j: Job) => j.materialRevenueCents + this.cos(j).reduce((a, c) => a + c.materialCents, 0);
  laborRev = (j: Job) => this.contract(j) - this.materialRev(j);
  materialCost = (j: Job) => j.materialCostCents + this.cos(j).reduce((a, c) => a + c.materialCostCents, 0);
  /** The estimate plus approved change orders, at the job's frozen labor rate. */
  budgetCost = (j: Job) => this.materialCost(j) + (j.estimateHrs + this.cos(j).reduce((a, c) => a + c.hours, 0)) * j.burdenedRateCents;
  latest(j: Job): PercentEntry | undefined {
    return this.ds.percents.filter((p) => p.jobId === j.id).sort((a, b) => b.week.localeCompare(a.week))[0];
  }
  matDone = (j: Job) => (j.status === "complete" ? 1 : (this.latest(j)?.materialsPct ?? 0) / 100);
  labDone = (j: Job) => (j.status === "complete" ? 1 : (this.latest(j)?.laborPct ?? 0) / 100);
  recognized = (j: Job) => (j.status === "complete" ? this.contract(j) : this.materialRev(j) * this.matDone(j) + this.laborRev(j) * this.labDone(j));
  /** Recognized as of a week, from the percent history. */
  recognizedAsOf(j: Job, w: IsoDate): number {
    if (j.status === "complete" && j.actualFinish && j.actualFinish <= w) return this.contract(j);
    const p = this.ds.percents.filter((x) => x.jobId === j.id && x.week <= w).sort((a, b) => b.week.localeCompare(a.week))[0];
    return p ? (this.materialRev(j) * p.materialsPct) / 100 + (this.laborRev(j) * p.laborPct) / 100 : 0;
  }
  billed = (j: Job) => this.ds.invoices.filter((i) => i.jobId === j.id && i.kind !== "skip").reduce((a, i) => a + i.amountCents, 0);
  overUnder = (j: Job) => this.billed(j) - this.recognized(j);
  remaining = (j: Job) => Math.max(0, this.contract(j) - this.recognized(j));
  retainageHeld = (j: Job) => this.ds.invoices.filter((i) => i.jobId === j.id && i.kind !== "skip").reduce((a, i) => a + i.retainageCents, 0);
  retainageOutstanding = (j: Job) => Math.max(0, this.retainageHeld(j) - this.ds.retainageReceipts.filter((r) => r.jobId === j.id).reduce((a, r) => a + r.amountCents, 0));
  suggestLabor(j: Job): number {
    const a = actualToDate(this.idx, j);
    return a ? Math.min(1, a / Math.max(eac(this.idx, j), 1)) : 0;
  }
  diverges = (j: Job) => isSold(j) && actualToDate(this.idx, j) > 0 && Math.abs(this.labDone(j) - this.suggestLabor(j)) > this.ds.settings.laborDivergencePts / 100;
  stale = (j: Job) => isSold(j) && j.start <= this.week && this.latest(j)?.week !== this.week;
  /** Bid margin, with approved change orders at their own margin, so fade measures the field, not the COs. */
  gpBid = (j: Job) => 1 - this.budgetCost(j) / Math.max(1, this.contract(j));
  gpNow = (j: Job) => 1 - (this.materialCost(j) + eac(this.idx, j) * j.burdenedRateCents) / Math.max(1, this.contract(j));
  fade = (j: Job) => this.gpNow(j) - this.gpBid(j);
  forReview = (j: Job) => isSold(j) && (this.stale(j) || this.diverges(j) || this.fade(j) < -this.ds.settings.marginFadePts / 100);

  /** What's left to recognize, spread across the job's planned weeks (materials with labor, decision 16). */
  forecast(j: Job, plans: Plans): Map<IsoDate, { lab: number; mat: number }> {
    const out = new Map<IsoDate, { lab: number; mat: number }>();
    if (!isSold(j)) return out;
    const p = plans.get(j.id);
    const ws = [...(p?.entries() ?? [])].filter(([w, h]) => w >= this.week && h > 0).sort((a, b) => a[0].localeCompare(b[0]));
    const lab = this.laborRev(j) * (1 - this.labDone(j));
    const mat = this.materialRev(j) * (1 - this.matDone(j));
    if (lab + mat <= 0) return out;
    if (!ws.length) {
      out.set(this.week, { lab, mat });
      return out;
    }
    const tot = ws.reduce((a, [, h]) => a + h, 0);
    for (const [w, h] of ws) out.set(w, { lab: (lab * h) / tot, mat: (mat * h) / tot });
    return out;
  }

  // ---------------------------------------------------------------- billing
  signedOff = (j: Job) => this.ds.jobCheckpoints.find((c) => c.jobId === j.id && c.key === "walk");
  finalInvoice = (j: Job) => this.ds.invoices.find((i) => i.jobId === j.id && i.kind === "final");
  /** Complete jobs only: waiting on sign-off, ready to invoice, retainage outstanding, closed. */
  billState(j: Job): "wait" | "ready" | "ret" | "closed" | null {
    if (j.status !== "complete") return null;
    if (!this.finalInvoice(j)) return this.signedOff(j) ? "ready" : "wait";
    return this.retainageOutstanding(j) > 0 ? "ret" : "closed";
  }
  readyOn(j: Job): IsoDate | null {
    const s = this.signedOff(j);
    if (!s) return null;
    const d = s.at.slice(0, 10);
    return j.actualFinish && j.actualFinish > d ? j.actualFinish : d;
  }
  invoiceDue = (j: Job) => {
    const r = this.readyOn(j);
    return r ? addDays(r, this.ds.settings.invoiceDays) : null;
  };
  invoiceLate = (j: Job) => this.billState(j) === "ready" && (this.invoiceDue(j) ?? "9999") < this.today;
  toBill = (j: Job) => Math.max(0, this.contract(j) - this.billed(j));
  /** Pay-app months from the job's start through this month with no invoice and no "nothing to bill". */
  progressDue(j: Job): string[] {
    if (j.billingMethod !== "monthly" || j.status === "complete" || j.start > this.today) return [];
    const out: string[] = [];
    let p = j.start.slice(0, 7);
    const end = this.today.slice(0, 7);
    while (p <= end) {
      if (!this.ds.invoices.some((i) => i.jobId === j.id && i.period === p && (i.kind === "progress" || i.kind === "skip"))) out.push(p);
      p = nextMonth(p);
    }
    return out;
  }
  payDue = (period: string) => `${period}-${String(this.ds.settings.payAppDay).padStart(2, "0")}`;
  progressLate = (period: string) => this.payDue(period) < this.today;
  progressSuggest = (j: Job) => Math.max(0, Math.round((this.recognized(j) - this.billed(j)) / 10000) * 10000);
  milestones = (j: Job) => this.ds.milestones.filter((m) => m.jobId === j.id).sort((a, b) => a.sort - b.sort);
  milestoneAmount = (j: Job, m: Milestone) => Math.round((this.contract(j) * m.pct) / 100);
  milestoneInvoice = (m: Milestone) => this.ds.invoices.find((i) => i.milestoneId === m.id && i.kind === "milestone");
  milestonesReady = (j: Job) => this.milestones(j).filter((m) => m.reachedOn && !this.milestoneInvoice(m));
  milestoneTotal = (j: Job) => this.milestones(j).reduce((a, m) => a + m.pct, 0);
}

export const nextMonth = (p: string) => {
  const [y, m] = p.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};
export const prevMonth = (p: string) => {
  const [y, m] = p.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};
export const monthLabel = (p: string, long = false) =>
  new Date(p + "-01T00:00:00Z").toLocaleDateString("en-US", long ? { month: "long", year: "numeric", timeZone: "UTC" } : { month: "short", year: "numeric", timeZone: "UTC" });

/** Recognized and forecast revenue by month (or by week), sold work. */
export function revenueByPeriod(ds: Dataset, m: Money, plans: Plans, week: IsoDate, by: "month" | "week") {
  const jobs = ds.jobs.filter((j) => j.active);
  if (by === "month") {
    const months: string[] = [];
    let mk = week.slice(0, 7);
    for (let i = 0; i < 5; i++) {
      months.push(mk);
      mk = nextMonth(mk);
    }
    const lastDay = (p: string) => addDays(nextMonth(p) + "-01", -1);
    const rows = months.map((p) => ({ key: p, label: monthLabel(p), actual: 0, lab: 0, mat: 0, current: p === week.slice(0, 7) }));
    rows[0].actual = jobs.reduce((a, j) => a + m.recognizedAsOf(j, lastDay(months[0])) - m.recognizedAsOf(j, lastDay(prevMonth(months[0]))), 0);
    for (const j of jobs)
      for (const [w, f] of m.forecast(j, plans)) {
        const r = rows.find((x) => x.key === w.slice(0, 7));
        if (r) {
          r.lab += f.lab;
          r.mat += f.mat;
        }
      }
    return rows;
  }
  const rows = Array.from({ length: 17 }, (_, i) => {
    const w = addDays(week, 7 * (i - 4));
    return { key: w, label: w, actual: 0, lab: 0, mat: 0, current: i === 4 };
  });
  for (const r of rows) if (r.key <= week) r.actual = jobs.reduce((a, j) => a + m.recognizedAsOf(j, r.key) - m.recognizedAsOf(j, addDays(r.key, -7)), 0);
  for (const j of jobs)
    for (const [w, f] of m.forecast(j, plans)) {
      const r = rows.find((x) => x.key === w);
      if (r) {
        r.lab += f.lab;
        r.mat += f.mat;
      }
    }
  return rows;
}

export const meetingMonday = (week: IsoDate) => mondayOf(week);
