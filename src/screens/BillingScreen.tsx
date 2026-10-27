import { useMemo, useState } from "react";
import { BILLING_METHOD_LABEL, Money, monthLabel } from "../domain/money";
import { buildIndex, isSold } from "../domain/schedule";
import type { Job } from "../domain/types";
import { fmtShort, todayIn } from "../domain/weeks";
import { usd } from "../format";
import type { Ctx } from "../Workspace";
import { JobDialog } from "./JobDialog";

/** Billing: what's due by method, the final and milestone board, retainage, and final-only jobs running ahead. */
export function BillingScreen({ ctx }: { ctx: Ctx }) {
  const { data, week } = ctx;
  const ds = data.ds;
  const s = ds.settings;
  const [openJob, setOpenJob] = useState<string | null>(null);
  const today = todayIn(new Date());
  const m = useMemo(() => new Money(ds, buildIndex(ds), week, today), [ds, week, today]);
  const by = (k: string) => ds.jobs.filter((j) => m.billState(j) === k);
  const ready = by("ready");
  const wait = by("wait");
  const ret = by("ret");
  // Retainage receivable includes what customers hold on progress and milestone invoices, not just finished jobs.
  const held = ds.jobs.filter((j) => m.retainageOutstanding(j) > 0);
  const closed = by("closed")
    .sort((a, b) => (m.finalInvoice(b)?.invoicedOn ?? "").localeCompare(m.finalInvoice(a)?.invoicedOn ?? ""))
    .slice(0, 8);
  const ms = ds.jobs.flatMap((j) => m.milestonesReady(j).map((x) => ({ j, x })));
  const prog = ds.jobs.flatMap((j) => m.progressDue(j).map((p) => ({ j, p }))).sort((a, b) => a.p.localeCompare(b.p) || a.j.number.localeCompare(b.j.number));
  const readyCents = ready.reduce((a, j) => a + m.toBill(j), 0) + ms.reduce((a, x) => a + m.milestoneAmount(x.j, x.x), 0);
  const under = ds.jobs
    .filter((j) => isSold(j) && j.billingMethod === "final" && m.recognized(j) - m.billed(j) > s.underBilledFlagCents)
    .sort((a, b) => m.recognized(b) - m.billed(b) - (m.recognized(a) - m.billed(a)));
  const count = (k: Job["billingMethod"]) => ds.jobs.filter((j) => isSold(j) && j.billingMethod === k).length;
  const lateProg = prog.filter((x) => m.progressLate(x.p)).length;
  const open = (id: string) => setOpenJob(id);

  const card = (j: Job) => {
    const st = m.billState(j);
    const late = m.invoiceLate(j);
    const fi = m.finalInvoice(j);
    const line =
      st === "wait"
        ? `Finished ${fmtShort(j.actualFinish ?? j.projectedFinish)}. Waiting on the PM for sign-off.`
        : st === "ready"
          ? `Final invoice, ${usd(m.toBill(j))}. Due ${fmtShort(m.invoiceDue(j)!)}${late ? ", late" : ""}.`
          : st === "ret"
            ? `Invoice ${fi?.number}, ${fmtShort(fi!.invoicedOn)}. Retainage ${usd(m.retainageOutstanding(j))} outstanding.`
            : `Invoice ${fi?.number}, ${fmtShort(fi!.invoicedOn)}.${j.retainagePct > 0 ? " Retainage received." : ""}`;
    return (
      <button key={j.id} className={"jycard" + (late ? " late" : st === "wait" ? " soon" : "")} onClick={() => open(j.id)}>
        <b>
          {j.number} {j.customer}
        </b>
        <span className={"q" + (late ? " r" : "")}>{line}</span>
      </button>
    );
  };
  const col = (title: string, items: React.ReactNode[], empty: string, key: string) => (
    <div className="jycol" data-billcol={key}>
      <h3>
        {title}
        <span>{items.length}</span>
      </h3>
      {items.length ? (
        items
      ) : (
        <p className="note" style={{ margin: 4 }}>
          {empty}
        </p>
      )}
    </div>
  );

  return (
    <>
      <h1>Billing</h1>
      <p className="lead">
        Each job bills one of three ways: a final invoice only, monthly progress invoices, or milestones. Whatever is due lands here with an alert. Draft invoices in Sage as usual, then record the number
        here. TMI Ops never writes to Sage.
      </p>
      <div className="kpis" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
        <div className={"kpi" + (lateProg ? " warn" : "")}>
          <div className="v num">{prog.length}</div>
          <div className="l">Progress invoices due{lateProg ? `, ${lateProg} late` : ""}</div>
        </div>
        <div className={"kpi" + (ready.length + ms.length ? " warn" : "")}>
          <div className="v num">{ready.length + ms.length}</div>
          <div className="l">Final and milestone invoices ready, {usd(readyCents)}</div>
        </div>
        <div className="kpi">
          <div className="v num">{wait.length}</div>
          <div className="l">Complete, waiting on customer sign-off</div>
        </div>
        <div className="kpi">
          <div className="v num">{usd(held.reduce((a, j) => a + m.retainageOutstanding(j), 0))}</div>
          <div className="l">
            Retainage outstanding on {held.length} job{held.length === 1 ? "" : "s"}, finished and running
          </div>
        </div>
      </div>
      <p className="note">
        Open jobs by billing method: {count("final")} final only, {count("monthly")} monthly, {count("milestone")} milestone. Set the method in each job’s billing section.
      </p>

      <h2>Monthly progress billing</h2>
      <p className="note">One pay application per job per month, due by the {s.payAppDay}th. The suggested amount is revenue recognized from the Monday percent complete, less what’s already billed.</p>
      {prog.length ? (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Month</th>
                <th>Due</th>
                <th className="r">Recognized</th>
                <th className="r">Billed</th>
                <th className="r">Suggested</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {prog.map(({ j, p }) => (
                <tr key={j.id + p}>
                  <td>
                    <button className="jl" onClick={() => open(j.id)}>
                      {j.number} {j.customer}
                    </button>
                  </td>
                  <td>{monthLabel(p, true)}</td>
                  <td>
                    {m.progressLate(p) && <span className="tag red">Late</span>} {fmtShort(m.payDue(p))}
                  </td>
                  <td className="r num">{usd(m.recognized(j))}</td>
                  <td className="r num">{usd(m.billed(j))}</td>
                  <td className="r num">{usd(m.progressSuggest(j))}</td>
                  <td>
                    <button className="btn sec" onClick={() => open(j.id)}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel">
          <p className="note" style={{ margin: 0 }}>
            No progress invoices due.
          </p>
        </div>
      )}

      <h2>Final and milestone invoices</h2>
      <div className="jyboard">
        {col("Waiting on sign-off", wait.map(card), "None", "wait")}
        {col(
          "Ready to invoice",
          [
            ...ms.map(({ j, x }) => (
              <button key={x.id} className="jycard" onClick={() => open(j.id)}>
                <b>
                  {j.number} {j.customer}
                </b>
                <span className="q">
                  Milestone: {x.label}, {x.pct}%, {usd(m.milestoneAmount(j, x))}. Reached {fmtShort(x.reachedOn!)}.
                </span>
              </button>
            )),
            ...ready.map(card),
          ],
          "Nothing to invoice",
          "ready",
        )}
        {col("Invoiced, retainage outstanding", ret.map(card), "None", "ret")}
        {col("Closed", closed.map(card), "None yet", "closed")}
      </div>

      <h2>Final-only jobs running ahead of billing</h2>
      <p className="note">Recognized revenue ahead of billing by more than {usd(s.underBilledFlagCents)} on jobs set to {BILLING_METHOD_LABEL.final.toLowerCase()}. Worth asking whether they should bill monthly.</p>
      {under.length ? (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th className="r">Contract</th>
                <th className="r">Recognized</th>
                <th className="r">Billed</th>
                <th className="r">Under billed</th>
              </tr>
            </thead>
            <tbody>
              {under.map((j) => (
                <tr key={j.id}>
                  <td>
                    <button className="jl" onClick={() => open(j.id)}>
                      {j.number} {j.customer}
                    </button>
                  </td>
                  <td className="r num">{usd(m.contract(j))}</td>
                  <td className="r num">{usd(m.recognized(j))}</td>
                  <td className="r num">{usd(m.billed(j))}</td>
                  <td className="r num">{usd(m.recognized(j) - m.billed(j))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel">
          <p className="note" style={{ margin: 0 }}>
            None.
          </p>
        </div>
      )}
      {openJob && <JobDialog ctx={ctx} jobId={openJob} onClose={() => setOpenJob(null)} billingOpen />}
    </>
  );
}
