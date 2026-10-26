import { useMemo, useState } from "react";
import { assignedIds, crewIssues } from "../domain/crew";
import { can, canEditJob, seesCompanyTotals } from "../domain/permissions";
import {
  FIRMNESS,
  allPlans,
  buildIndex,
  firmnessLabel,
  isOnHold,
  isOverrun,
  isPastFinish,
  isPastMustFinish,
  isSold,
  isWinterWeek,
  mustFinishInWeek,
  needsDateConfirm,
  predecessorIssue,
  weekTotals,
} from "../domain/schedule";
import type { Firmness, IsoDate, Job } from "../domain/types";
import { fmtShort, weekList } from "../domain/weeks";
import { n0, n1 } from "../format";
import type { Ctx } from "../Workspace";
import { AddJobDialog } from "./AddJobDialog";
import { JobDialog } from "./JobDialog";

const EDGE: Record<Firmness, string> = {
  locked: "f-lock",
  confirmed: "f-conf",
  waiting: "f-wait",
  flexible: "f-flex",
  best_guess: "f-guess",
  fill_in: "f-fill",
};
type Sort = "start" | "finish" | "rep" | "pm" | "customer";

export function ScheduleScreen({ ctx }: { ctx: Ctx }) {
  const { viewer, week, data, repo, run } = ctx;
  const ds = data.ds;
  const [f, setF] = useState<{ rep: string; pm: string; firm: string; sort: Sort }>({ rep: "", pm: "", firm: "", sort: "start" });
  const [openJob, setOpenJob] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const weeks = useMemo(() => weekList(week, 13), [week]);
  const idx = useMemo(() => buildIndex(ds), [ds]);
  const plans = useMemo(() => allPlans(ds, idx, week), [ds, idx, week]);
  const issues = useMemo(() => crewIssues(ds, idx, weekList(week, 6)), [ds, idx, week]);
  const totals = useMemo(() => {
    if (!seesCompanyTotals(viewer.role)) return null;
    const src = data.totals ?? ds;
    const i = src === ds ? idx : buildIndex(src);
    return weekTotals(src, i, src === ds ? plans : allPlans(src, i, week), weeks);
  }, [data.totals, ds, idx, plans, week, weeks, viewer.role]);

  const repName = (c: string) => ds.reps.find((r) => r.code === c)?.name ?? c;
  const pmName = (c: string) => ds.pms.find((r) => r.code === c)?.name ?? c;
  const personName = (id: string | null) => ds.people.find((p) => p.id === id)?.name ?? "No leader";

  const allJobs = ds.jobs.filter((j) => isSold(j) && (plans.get(j.id)?.size ?? 0) > 0);
  const key: Record<Sort, (j: Job) => string> = {
    start: (j) => j.start,
    finish: (j) => j.projectedFinish,
    rep: (j) => repName(j.repCode),
    pm: (j) => pmName(j.pmCode),
    customer: (j) => j.customer,
  };
  const jobs = allJobs
    .filter((j) => (!f.rep || j.repCode === f.rep) && (!f.pm || j.pmCode === f.pm) && (!f.firm || (f.firm === "hold" ? isOnHold(j) : !isOnHold(j) && j.firmness === f.firm)))
    .sort((a, b) => key[f.sort](a).localeCompare(key[f.sort](b)) || a.start.localeCompare(b.start));
  const reps = [...new Set(allJobs.map((j) => j.repCode))].sort((a, b) => repName(a).localeCompare(repName(b)));
  const pms = [...new Set(allJobs.map((j) => j.pmCode))].sort();
  const anyPlanEdit = jobs.some((j) => canEditJob(viewer, j, "plan"));
  const pinned = (j: Job) => ds.notes.filter((n) => n.jobId === j.id && n.pinned);

  const commit = (j: Job, w: IsoDate, raw: string, current: number) => {
    const v = raw.trim() === "" ? null : Math.max(0, Math.round(Number(raw)));
    if (v !== null && (Number.isNaN(v) || v === current)) return;
    void run(() => repo.setPlanCell(j.id, w, v));
  };

  const tags = (j: Job) => {
    const t: React.ReactNode[] = [];
    if (isOverrun(idx, j, ds.settings)) t.push(<span key="o" className="tag red">Overrun</span>);
    if (isPastFinish(j, week)) t.push(<span key="l" className="tag yel">Late</span>);
    if (isPastMustFinish(j)) t.push(<span key="m" className="tag red">Past must-finish</span>);
    if (isOnHold(j))
      t.push(
        <span key="h" className="tag yel" title={j.holdReason ?? ""}>
          On hold{j.holdUntil ? " to " + fmtShort(j.holdUntil) : ""}
        </span>,
      );
    if (needsDateConfirm(j, week, ds.settings)) t.push(<span key="c" className="tag yel">Confirm dates</span>);
    const p = predecessorIssue(idx, j, ds.settings);
    if (p)
      t.push(
        <span key="p" className={"tag" + (p.issue ? " red" : "")}>
          {p.issue === "slip" ? "Blocked by " : p.issue === "over" ? "Watch " : "After "}
          {p.pred.number}
        </span>,
      );
    const pins = pinned(j);
    if (pins.length)
      t.push(
        <span key="n" className="tag yel" title={pins.map((n) => n.text).join(" | ")}>
          Pinned note
        </span>,
      );
    if (issues.some((i) => i.job.id === j.id)) t.push(<span key="i" className="tag yel">Crew issue</span>);
    if (j.exterior) t.push(<span key="x" className="tag blue">Exterior</span>);
    if (ds.confirmations.some((c) => c.jobId === j.id && c.week === week))
      t.push(
        <span key="cf" className="tag grn">
          Confirmed
        </span>,
      );
    return t;
  };

  return (
    <>
      <h1>{viewer.role === "superintendent" ? "Your jobs" : "Schedule"}</h1>
      <p className="lead">
        {anyPlanEdit
          ? "Planned hours spread evenly from today to each job’s finish. Type over any week to set it; the rest of the job rebalances. Clear a week to put it back to automatic. Click a job to change dates, crew or leader."
          : "Planned hours by week. Click a job for its crew, details and history."}
      </p>
      {viewer.role === "superintendent" && (() => {
        const mine = ds.jobs.filter((j) => isSold(j) && !isOnHold(j) && j.leaderId === viewer.personId && (plans.get(j.id)?.get(week) ?? 0) > 0);
        const done = mine.length > 0 && mine.every((j) => ds.confirmations.some((c) => c.jobId === j.id && c.week === week));
        return (
          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="confirm">
              <div>
                <b>Your crews for week ending {fmtShort(week)}</b>
                {mine.length ? (
                  mine.map((j) => (
                    <div className="note" key={j.id}>
                      {j.customer}: {assignedIds(ds, j.id, week).map((id) => ds.people.find((p) => p.id === id)?.name).filter(Boolean).join(", ") || "no crew assigned"}
                    </div>
                  ))
                ) : (
                  <div className="note">No jobs this week.</div>
                )}
              </div>
              {mine.length > 0 &&
                (done ? (
                  <span className="tag grn">Confirmed</span>
                ) : (
                  <button className="btn" onClick={() => run(() => repo.confirmMyCrews(), "Crews confirmed.")}>
                    Confirm my crews
                  </button>
                ))}
            </div>
          </div>
        );
      })()}
      {can.addJob(viewer.role) && (
        <div className="row" style={{ marginBottom: 12 }}>
          <button className="btn" onClick={() => setAdding(true)}>
            Add job from estimate
          </button>
          <span className="note">Sold jobs come in with the estimate’s hours and projected material cost.</span>
        </div>
      )}
      <div className="row" style={{ marginBottom: 12 }}>
        <label className="field">
          Sales rep
          <select value={f.rep} onChange={(e) => setF({ ...f, rep: e.target.value })}>
            <option value="">All reps</option>
            {reps.map((r) => (
              <option key={r} value={r}>
                {repName(r)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Project manager
          <select value={f.pm} onChange={(e) => setF({ ...f, pm: e.target.value })}>
            <option value="">All PMs</option>
            {pms.map((p) => (
              <option key={p} value={p}>
                {pmName(p)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Date firmness
          <select value={f.firm} onChange={(e) => setF({ ...f, firm: e.target.value })}>
            <option value="">All</option>
            {FIRMNESS.map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
              </option>
            ))}
            <option value="hold">On hold</option>
          </select>
        </label>
        <label className="field">
          Sort by
          <select value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value as Sort })}>
            <option value="start">Start date</option>
            <option value="finish">Projected finish</option>
            <option value="rep">Sales rep</option>
            <option value="pm">Project manager</option>
            <option value="customer">Customer</option>
          </select>
        </label>
        <span className="note">
          Showing {jobs.length} of {allJobs.length} jobs.
          {totals && (f.rep || f.pm || f.firm || data.totals) ? " Totals below stay company-wide." : ""}
        </span>
      </div>
      <div className="scroll">
        <table className="sched">
          <thead>
            <tr>
              <th className="job">Job</th>
              {weeks.map((w, i) => (
                <th key={w} className={"wk" + (i === 0 ? " now" : "")}>
                  {fmtShort(w)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 && (
              <tr>
                <td className="job" colSpan={14}>
                  No open jobs.
                </td>
              </tr>
            )}
            {jobs.map((j) => {
              const plan = plans.get(j.id)!;
              const ov = new Set(ds.overrides.filter((o) => o.jobId === j.id).map((o) => o.week));
              const full = j.crewSize * ds.settings.hoursPerManWeek;
              const edit = canEditJob(viewer, j, "plan");
              return (
                <tr key={j.id} className={isOnHold(j) ? "hrow" : ""} data-job-row={j.number}>
                  <td className={"job " + EDGE[j.firmness]}>
                    <button className="jl c" onClick={() => setOpenJob(j.id)}>
                      {j.number} {j.customer}
                    </button>{" "}
                    {tags(j).map((t, i) => (
                      <span key={i}>{t} </span>
                    ))}
                    <div className="m">
                      {j.jobType}, {j.location}. Rep <b>{repName(j.repCode)}</b>, PM <b>{pmName(j.pmCode)}</b>. {personName(j.leaderId)}, crew {j.crewSize}
                    </div>
                    <div className="m">
                      {isOnHold(j) ? `On hold: ${j.holdReason || "no reason given"}. ` : firmnessLabel(j.firmness) + ". "}
                      {j.status === "active" ? "In progress. " : ""}Start {fmtShort(j.start)}. Projected {fmtShort(j.projectedFinish)}.
                      {j.mustFinish && (
                        <b>
                          {" "}
                          {j.mustFinishReason === "shutdown" ? "Shutdown" : "Contract obligation"} deadline {fmtShort(j.mustFinish)}.
                        </b>
                      )}
                    </div>
                  </td>
                  {weeks.map((w) => {
                    const h = plan.get(w);
                    const must = mustFinishInWeek(j, w);
                    if (h == null) return <td key={w} className={"cell" + (must ? " must" : "")} />;
                    const cls = ["cell", ov.has(w) && "ov", j.exterior && isWinterWeek(w, ds.settings) && "wint", must && "must"].filter(Boolean).join(" ");
                    const a = Math.min(1, h / Math.max(1, full));
                    const style = { background: `color-mix(in srgb, var(--blue) ${Math.round(8 + a * 30)}%, transparent)` };
                    return (
                      <td key={w} className={cls} style={style}>
                        {edit ? (
                          <input
                            key={h + "|" + ov.has(w)}
                            type="number"
                            min={0}
                            step={10}
                            defaultValue={h}
                            aria-label={`${j.customer} hours week ending ${fmtShort(w)}`}
                            onBlur={(e) => commit(j, w, e.target.value, h)}
                            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                          />
                        ) : (
                          <span>{n0(h)}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {totals && (
              <>
                <tr className="tot">
                  <td className="job">Scheduled hrs (sold)</td>
                  {totals.map((t) => (
                    <td key={t.week} className="cell">
                      <span>{n0(t.sold)}</span>
                    </td>
                  ))}
                </tr>
                {totals.some((t) => t.onHold > 0) && (
                  <tr className="tot">
                    <td className="job">On hold, not counted</td>
                    {totals.map((t) => (
                      <td key={t.week} className="cell">
                        <span>{t.onHold ? n0(t.onHold) : ""}</span>
                      </td>
                    ))}
                  </tr>
                )}
                <tr className="tot">
                  <td className="job">Available hrs</td>
                  {totals.map((t) => (
                    <td key={t.week} className="cell">
                      <span>{n0(t.available)}</span>
                    </td>
                  ))}
                </tr>
                <tr className="tot">
                  <td className="job">Open (+) or short (−)</td>
                  {totals.map((t) => (
                    <td key={t.week} className={"cell " + (t.open < 0 ? "gap" : "open")}>
                      <span>
                        {t.open < 0 ? "−" : "+"}
                        {n0(Math.abs(t.open))}
                      </span>
                    </td>
                  ))}
                </tr>
                <tr className="tot">
                  <td className="job">Leaders needed / available</td>
                  {totals.map((t) => (
                    <td key={t.week} className={"cell" + (t.leadersNeeded > t.leadersAvailable ? " gap" : "")}>
                      <span>
                        {n1(t.leadersNeeded)}/{n1(t.leadersAvailable)}
                      </span>
                    </td>
                  ))}
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
      <div className="legend">
        {FIRMNESS.map((x) => (
          <span key={x.key}>
            <i
              className="fe"
              style={{
                borderLeft: `6px ${x.key === "waiting" ? "dashed" : x.key === "best_guess" || x.key === "fill_in" ? "dotted" : "solid"} ${
                  { locked: "var(--text)", confirmed: "var(--blue)", waiting: "var(--blue)", flexible: "color-mix(in srgb, var(--blue) 40%, transparent)", best_guess: "var(--muted)", fill_in: "var(--line)" }[x.key]
                }`,
              }}
            />
            {x.label}
          </span>
        ))}
        <span>
          <i style={{ background: "color-mix(in srgb, var(--blue) 38%, transparent)" }} />
          Darker means closer to full crew
        </span>
        <span>
          <i style={{ outline: "2px dashed var(--muted)", outlineOffset: -3 }} />
          Exterior work in a winter week
        </span>
        <span>
          <i style={{ boxShadow: "inset -3px 0 0 var(--red)" }} />
          Shutdown or contract deadline
        </span>
        {anyPlanEdit && (
          <span>
            <i style={{ boxShadow: "inset 3px 0 0 var(--blue)" }} />
            Week set by hand
          </span>
        )}
        {totals && (
          <span>
            <i className="hazard" />
            Short on men or leaders
          </span>
        )}
      </div>
      {openJob && <JobDialog ctx={ctx} jobId={openJob} onClose={() => setOpenJob(null)} />}
      {adding && <AddJobDialog ctx={ctx} onClose={() => setAdding(false)} />}
    </>
  );
}
