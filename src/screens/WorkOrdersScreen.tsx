import { useState } from "react";
import type { Job } from "../domain/types";
import { namesOf } from "../domain/views";
import { WO_STEPS, WO_TAG, woDaysWaiting, woInQueue, woLate, woOpen, woStatus, woWaiting, type WorkOrder } from "../domain/workOrders";
import { daysBetween, fmtShort, todayIn } from "../domain/weeks";
import type { Ctx } from "../Workspace";
import { JobDialog } from "./JobDialog";

const QUEUE_TITLE: Record<string, string> = {
  job_setup: "Your queue: drafts to create, revise or file",
  estimator: "Your queue: drafts to check against the estimate",
  sales_rep: "Your queue: contract terms to confirm",
  pm: "Your queue: execution plans to sign off",
  scheduler: "Your queue: crew and dates to set",
};

export function WorkOrdersScreen({ ctx }: { ctx: Ctx }) {
  const { viewer, data } = ctx;
  const ds = data.ds;
  const [openJob, setOpenJob] = useState<string | null>(null);
  const today = todayIn(new Date());
  const due = ds.settings.woReviewDays;
  const soonDays = ds.settings.woStartSoonDays;
  const n = namesOf(ds);
  const list = ds.jobs
    .filter((j) => j.status !== "complete")
    .map((j) => ({ j, w: ds.workOrders.find((x) => x.jobId === j.id) }))
    .filter((x): x is { j: Job; w: WorkOrder } => !!x.w);
  const open = list.filter((x) => woOpen(x.j, x.w));
  const queue = QUEUE_TITLE[viewer.role] ? list.filter((x) => woInQueue(viewer, x.j, x.w)) : null;
  const soon = open.filter((x) => daysBetween(today, x.j.start) <= soonDays).length;
  const lateN = open.filter((x) => woLate(x.j, x.w, today, due)).length;
  const sorted = [...list].sort((a, b) => Number(woOpen(b.j, b.w)) - Number(woOpen(a.j, a.w)) || a.j.start.localeCompare(b.j.start));

  const table = (rows: { j: Job; w: WorkOrder }[]) => (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            <th>Job</th>
            <th>Starts</th>
            <th>Status</th>
            <th>Sign-offs</th>
            <th>Waiting on</th>
            <th className="r">Days waiting</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="note">
                Nothing waiting on you.
              </td>
            </tr>
          )}
          {rows.map(({ j, w }) => {
            const s = woStatus(w);
            const late = woLate(j, w, today, due);
            const isOpen = woOpen(j, w);
            return (
              <tr key={j.id} data-wo-row={j.number}>
                <td>
                  <button className="jl" onClick={() => setOpenJob(j.id)}>
                    {j.number} {j.customer}
                  </button>
                  <div className="note">
                    {j.jobType}. Estimator {j.estimator}, rep {n.rep(j.repCode)}, PM {n.pm(j.pmCode)}
                  </div>
                </td>
                <td>
                  {fmtShort(j.start)}
                  {isOpen && daysBetween(today, j.start) <= soonDays && <span className="tag yel"> Soon</span>}
                </td>
                <td>
                  <span className={"tag " + WO_TAG[s]}>{s}</span>
                  {w.final && (w.filed ? <span className="note"> In Procore</span> : <span className="tag yel"> File in Procore</span>)}
                </td>
                <td>
                  {!w.fileName && !w.final ? (
                    <span className="note">No draft yet</span>
                  ) : (
                    <span className="wodots" aria-label={`${w.final ? 4 : w.currentStep} of 4 signed off`}>
                      {WO_STEPS.map((d, i) => {
                        const st = w.final || i < w.currentStep ? "done" : i === w.currentStep && !w.returned ? "cur" : "";
                        return <i key={i} className={st} title={`${d.role}: ${st === "done" ? "signed off" : st === "cur" ? "waiting" : "pending"}`} />;
                      })}
                    </span>
                  )}
                </td>
                <td>{woWaiting(j, w, n) || "–"}</td>
                <td className="r num" style={late ? { color: "var(--red)", fontWeight: 700 } : undefined}>
                  {isOpen ? `${woDaysWaiting(w, today)}${late ? " (late)" : ""}` : "–"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const k = (label: string, v: number, warn = false) => (
    <div className={"kpi" + (warn && v ? " warn" : "")}>
      <div className="v num">{v}</div>
      <div className="l">{label}</div>
    </div>
  );

  return (
    <>
      <h1>Work orders</h1>
      <p className="lead">
        Every sold job goes on the schedule as booked the moment it’s added. Its work order runs alongside and never holds the job off the board. Lori drafts it in Claude from the estimate and
        proposal, uploads it here, and it moves through four sign-offs. The final is filed in Procore as the work order of record.
      </p>
      <div className="kpis" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
        {k("Awaiting a draft or revision", open.filter((x) => !x.w.fileName || x.w.returned).length)}
        {k("In sign-off", open.filter((x) => x.w.fileName && !x.w.returned).length)}
        {k(`Past the ${due}-day review deadline`, lateN, true)}
        {k(`Starting within ${soonDays} days, not final`, soon, true)}
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <ol className="chain">
          <li>
            <b>Lori</b>
            <span>Drafts in Claude from the estimate and proposal, uploads it</span>
          </li>
          {WO_STEPS.map((d) => (
            <li key={d.role}>
              <b>{d.role}</b>
              <span>{d.what}</span>
            </li>
          ))}
          <li>
            <b>Procore</b>
            <span>Final filed as the record</span>
          </li>
        </ol>
        <p className="note" style={{ margin: "8px 0 0" }}>
          Each step has {due} days. A late step pings the PM and shows on the dashboard. Anyone in the chain can send it back with a comment; Lori revises it and sign-offs restart with the estimator.
        </p>
      </div>
      {queue && (
        <>
          <h2>{QUEUE_TITLE[viewer.role]}</h2>
          {table(queue)}
        </>
      )}
      <h2>All work orders</h2>
      {table(sorted)}
      {openJob && <JobDialog ctx={ctx} jobId={openJob} onClose={() => setOpenJob(null)} />}
    </>
  );
}
