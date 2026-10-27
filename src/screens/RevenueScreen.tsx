import { useEffect, useMemo, useState } from "react";
import { StackedBars } from "../components/StackedBars";
import { Money, monthLabel, revenueByPeriod, wipCsv, wipRows, type WipRow, type WipSnapshotRow } from "../domain/money";
import { can, canEditJob } from "../domain/permissions";
import { allPlans, buildIndex, isSold } from "../domain/schedule";
import { fmtShort, mondayOf, todayIn } from "../domain/weeks";
import { pct, usd } from "../format";
import type { Ctx } from "../Workspace";
import { JobDialog } from "./JobDialog";

const signed = (v: number) => (v < 0 ? `(${usd(Math.abs(v))})` : usd(v));

/** Revenue and WIP: Monday percent complete, recognized revenue, billing position and margin. */
export function RevenueScreen({ ctx }: { ctx: Ctx }) {
  const { viewer, data, repo, run, week } = ctx;
  const ds = data.ds;
  const s = ds.settings;
  const [view, setView] = useState<"month" | "week">("month");
  const [openJob, setOpenJob] = useState<string | null>(null);
  const idx = useMemo(() => buildIndex(ds), [ds]);
  const plans = useMemo(() => allPlans(ds, idx, week), [ds, idx, week]);
  const today = todayIn(new Date());
  const m = useMemo(() => new Money(ds, idx, week, today), [ds, idx, week, today]);
  const pmName = (c: string) => ds.pms.find((p) => p.code === c)?.name ?? c;

  const rows = revenueByPeriod(ds, m, plans, week, view);
  const months = view === "month" ? rows : revenueByPeriod(ds, m, plans, week, "month");
  const m0 = months[0];
  // Open jobs, plus jobs finished this month or last.
  const jobs = ds.jobs
    .filter((j) => isSold(j) || (j.status === "complete" && (j.actualFinish ?? "").slice(0, 7) >= prevMonthOf(week.slice(0, 7))))
    .sort((a, b) => Number(m.forReview(b)) - Number(m.forReview(a)) || a.start.localeCompare(b.start));
  const visibleRemaining = ds.jobs.filter(isSold).reduce((a, j) => a + m.remaining(j), 0);
  const visibleReview = ds.jobs.filter((j) => m.forReview(j)).length;
  const net = ds.jobs.filter((j) => m.billed(j) > 0 || m.recognized(j) > 0).reduce((a, j) => a + m.overUnder(j), 0);

  const commit = (jobId: string, kind: "mat" | "lab", raw: string) => {
    const j = ds.jobs.find((x) => x.id === jobId)!;
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0 || v > 100) return void run(() => Promise.reject(new Error("Percent complete is between 0 and 100.")));
    const mat = kind === "mat" ? v : Math.round(m.matDone(j) * 100);
    const lab = kind === "lab" ? v : Math.round(m.labDone(j) * 100);
    if (mat === Math.round(m.matDone(j) * 100) && lab === Math.round(m.labDone(j) * 100) && !m.stale(j)) return;
    void run(() => repo.recordPercent(jobId, mat, lab), "Saved for this week’s meeting.");
  };

  return (
    <>
      <h1>Revenue and WIP</h1>
      <p className="lead">
        Updated at the Monday job cost meeting (this week: {fmtShort(mondayOf(week))}). Each contract splits into materials and labor
        by the estimate’s costs. Materials and labor are both recognized by percent complete. The forecast spreads what’s left across the schedule, so moving a job moves its revenue.
      </p>
      <div className="kpis">
        <div className="kpi">
          <div className="v num">{usd(m0.actual)}</div>
          <div className="l">Recognized so far in {m0.label}</div>
        </div>
        <div className="kpi">
          <div className="v num">{usd(m0.actual + m0.lab + m0.mat)}</div>
          <div className="l">{m0.label} forecast, recognized plus scheduled</div>
        </div>
        <div className="kpi">
          <div className="v num">{usd(months[1].lab + months[1].mat)}</div>
          <div className="l">{months[1].label} forecast</div>
        </div>
        <div className="kpi">
          <div className="v num">{usd(visibleRemaining)}</div>
          <div className="l">Sold revenue not yet recognized</div>
        </div>
        <div className={"kpi" + (visibleReview ? " warn" : "")}>
          <div className="v num">{visibleReview}</div>
          <div className="l">Jobs for Monday’s review: stale %, % vs hours, or margin fade</div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="confirm">
          <h2 style={{ margin: 0 }}>Revenue by {view}, sold work</h2>
          <div role="group" aria-label="Revenue period" style={{ display: "flex", gap: 6 }}>
            <button className={"btn" + (view === "month" ? "" : " sec")} aria-pressed={view === "month"} onClick={() => setView("month")}>
              Monthly
            </button>
            <button className={"btn" + (view === "week" ? "" : " sec")} aria-pressed={view === "week"} onClick={() => setView("week")}>
              Weekly
            </button>
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <StackedBars
            title="Recognized and forecast revenue by period"
            labels={rows.map((r) => (view === "week" ? fmtShort(r.key) : r.label))}
            highlight={rows.findIndex((r) => r.current)}
            format={usd}
            series={[
              { label: "Recognized", color: "var(--series-1)", values: rows.map((r) => r.actual) },
              { label: "Forecast labor", color: "var(--series-2)", values: rows.map((r) => r.lab) },
              { label: "Forecast materials", color: "var(--series-3)", values: rows.map((r) => r.mat) },
            ]}
          />
        </div>
        <p className="note">
          {view === "week"
            ? "The past four weeks show what was recognized at each Monday meeting; this week and the next twelve are forecast from the schedule."
            : `${m0.label} combines what’s already recognized with what the schedule says is left this month.`}
        </p>
        <div className="scroll" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>{view === "week" ? "Week ending" : "Month"}</th>
                <th className="r">Recognized</th>
                <th className="r">Forecast labor</th>
                <th className="r">Forecast materials</th>
                <th className="r">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} style={r.current ? { fontWeight: 700 } : undefined}>
                  <td>
                    {view === "week" ? fmtShort(r.key) : r.label}
                    {r.current ? " (current)" : ""}
                  </td>
                  <td className="r num">{r.actual ? usd(r.actual) : ""}</td>
                  <td className="r num">{r.lab ? usd(r.lab) : ""}</td>
                  <td className="r num">{r.mat ? usd(r.mat) : ""}</td>
                  <td className="r num">
                    <b>{usd(r.actual + r.lab + r.mat)}</b>
                  </td>
                </tr>
              ))}
              <tr>
                <td>
                  <b>Total shown</b>
                </td>
                {(["actual", "lab", "mat"] as const).map((k) => (
                  <td key={k} className="r num">
                    <b>{usd(rows.reduce((a, r) => a + r[k], 0))}</b>
                  </td>
                ))}
                <td className="r num">
                  <b>{usd(rows.reduce((a, r) => a + r.actual + r.lab + r.mat, 0))}</b>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <h2>WIP schedule</h2>
        <button className="btn sec" onClick={() => download(`TMI WIP ${today.slice(0, 7)}.csv`, wipCsv(wipRows(ds, m, today.slice(0, 7)), pmName))}>
          Export WIP (CSV)
        </button>
      </div>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Job</th>
              <th className="r">Contract</th>
              <th className="r">Materials %</th>
              <th className="r">Labor %</th>
              <th className="r">Recognized</th>
              <th className="r">Billed to date</th>
              <th className="r">Over (under) billed</th>
              <th className="r">Left to recognize</th>
              <th className="r">GP %, bid → now</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => {
              const ed = j.status !== "complete" && canEditJob(viewer, j, "percent");
              const ob = m.overUnder(j);
              const fade = m.fade(j);
              const latest = m.latest(j);
              return (
                <tr key={j.id} className={m.forReview(j) ? "exc" : ""} data-wip-row={j.number}>
                  <td>
                    <button className="jl" onClick={() => setOpenJob(j.id)}>
                      {j.number} {j.customer}
                    </button>
                    <div className="q">{j.jobType}</div>
                    {m.stale(j) && <span className="tag yel">Not updated {latest ? "since " + fmtShort(mondayOf(latest.week)) : "yet"}</span>}{" "}
                    {m.diverges(j) && <span className="tag red">% vs hours</span>} {fade < -s.marginFadePts / 100 && <span className="tag red">Margin fade</span>}
                  </td>
                  <td className="r num">
                    {usd(m.contract(j))}
                    <div className="q">{usd(m.materialRev(j))} materials rev.</div>
                    <div className="q">{usd(m.materialCost(j))} material cost</div>
                  </td>
                  <td className="r">
                    <input
                      key={"m" + m.matDone(j)}
                      className="act num"
                      type="number"
                      min={0}
                      max={100}
                      step={5}
                      defaultValue={Math.round(m.matDone(j) * 100)}
                      disabled={!ed}
                      aria-label={`Materials percent complete ${j.customer}`}
                      onBlur={(e) => ed && commit(j.id, "mat", e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    />
                  </td>
                  <td className="r">
                    <input
                      key={"l" + m.labDone(j)}
                      className="act num"
                      type="number"
                      min={0}
                      max={100}
                      step={5}
                      defaultValue={Math.round(m.labDone(j) * 100)}
                      disabled={!ed}
                      aria-label={`Labor percent complete ${j.customer}`}
                      onBlur={(e) => ed && commit(j.id, "lab", e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    />
                    <div className="q">
                      Hours say {pct(m.suggestLabor(j))}
                      {m.diverges(j) && ed && (
                        <>
                          {" "}
                          <button className="jl" onClick={() => run(() => repo.recordPercent(j.id, Math.round(m.matDone(j) * 100), Math.round(m.suggestLabor(j) * 100)), "Labor % set from hours.")}>
                            Use
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                  <td className="r num">{usd(m.recognized(j))}</td>
                  <td className="r num">{usd(m.billed(j))}</td>
                  <td className="r num" style={Math.abs(ob) > (m.contract(j) * s.overBilledFlagPct) / 100 ? { color: "var(--red)", fontWeight: 700 } : undefined}>
                    {signed(ob)}
                  </td>
                  <td className="r num">{usd(m.remaining(j))}</td>
                  <td className="r num">
                    {pct(m.gpBid(j))} → <b style={fade < -s.marginFadePts / 100 ? { color: "var(--red)" } : fade > s.marginFadePts / 100 ? { color: "var(--green)" } : undefined}>{pct(m.gpNow(j))}</b>
                  </td>
                </tr>
              );
            })}
            <tr className="tot">
              <td>
                <b>Total</b>
              </td>
              <td className="r num">
                <b>{usd(jobs.reduce((a, j) => a + m.contract(j), 0))}</b>
              </td>
              <td />
              <td />
              <td className="r num">
                <b>{usd(jobs.reduce((a, j) => a + m.recognized(j), 0))}</b>
              </td>
              <td className="r num">
                <b>{usd(jobs.reduce((a, j) => a + m.billed(j), 0))}</b>
              </td>
              <td className="r num">
                <b>{signed(net)}</b>
              </td>
              <td className="r num">
                <b>{usd(jobs.reduce((a, j) => a + m.remaining(j), 0))}</b>
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <p className="note">
        Review rows sort to the top: percentages not updated at this week’s meeting, a labor % {s.laborDivergencePts}+ points from what hours suggest, or margin down {s.marginFadePts}+ points from bid. GP now
        uses hours at completion at the burdened labor rate the job was set up with, plus material cost; both include approved change orders. Over-billed is cash ahead of the work; under-billed is work not yet
        invoiced.
      </p>
      {can.recordInvoices(viewer.role) && <MonthEnd ctx={ctx} pmName={pmName} />}
      {openJob && <JobDialog ctx={ctx} jobId={openJob} onClose={() => setOpenJob(null)} />}
    </>
  );
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Month-end WIP: lock the month for the books, then compare it with the month before. */
function MonthEnd({ ctx, pmName }: { ctx: Ctx; pmName: (c: string) => string }) {
  const { repo, run, data } = ctx;
  const [snaps, setSnaps] = useState<WipSnapshotRow[] | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  useEffect(() => {
    repo.wipSnapshots().then(setSnaps, () => setSnaps([]));
  }, [repo, data]);
  if (!snaps) return null;
  const cur = todayIn(new Date()).slice(0, 7);
  const months = [...new Set(snaps.map((x) => x.month))].sort().reverse();
  const shown = pick ?? months[0] ?? null;
  const rows = snaps.filter((x) => x.month === shown);
  const prior = months[months.indexOf(shown ?? "") + 1];
  const before = new Map(snaps.filter((x) => x.month === prior).map((x) => [x.jobId, x]));
  const sum = (rs: WipRow[], k: keyof WipRow) => rs.reduce((a, r) => a + (r[k] as number), 0);
  const priorRows = [...before.values()];
  return (
    <>
      <h2>Month-end WIP</h2>
      <div className="panel">
        <div className="row">
          {!months.includes(cur) && (
            <button className="btn" onClick={() => run(() => repo.takeWipSnapshot(cur), `WIP for ${monthLabel(cur)} locked.`)}>
              Lock WIP for {monthLabel(cur)}
            </button>
          )}
          {months.length > 0 && (
            <label className="field">
              Month
              <select value={shown ?? ""} onChange={(e) => setPick(e.target.value)}>
                {months.map((mo) => (
                  <option key={mo} value={mo}>
                    {monthLabel(mo)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {shown && (
            <button className="btn sec" onClick={() => download(`TMI WIP ${shown} locked.csv`, wipCsv(rows, pmName))}>
              Download {monthLabel(shown)} (CSV)
            </button>
          )}
        </div>
        {!shown ? (
          <p className="note">No month locked yet. Lock the WIP at month end; once locked, a month can’t change, so the books and the board see the same numbers.</p>
        ) : (
          <>
            <p className="note">
              Locked {new Date(rows[0].takenAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} by {rows[0].takenBy}. {rows.length} jobs.
              {prior ? ` Changes are against ${monthLabel(prior)}.` : " The next month will compare against this one."}
            </p>
            <div className="scroll">
              <table aria-label="Month-end WIP">
                <thead>
                  <tr>
                    <th>Job</th>
                    <th className="r">Contract</th>
                    <th className="r">Recognized</th>
                    <th className="r">This month</th>
                    <th className="r">Billed</th>
                    <th className="r">Over (under)</th>
                    <th className="r">Cost to complete</th>
                    <th className="r">GP bid → now</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.jobId}>
                      <td>
                        {r.number} {r.customer}
                      </td>
                      <td className="r num">{usd(r.contractCents)}</td>
                      <td className="r num">{usd(r.recognizedCents)}</td>
                      <td className="r num">{prior ? usd(r.recognizedCents - (before.get(r.jobId)?.recognizedCents ?? 0)) : ""}</td>
                      <td className="r num">{usd(r.billedCents)}</td>
                      <td className="r num">{signed(r.overUnderCents)}</td>
                      <td className="r num">{usd(r.costToCompleteCents)}</td>
                      <td className="r num">
                        {pct(r.gpBid)} → {pct(r.gpNow)}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td>
                      <b>Total</b>
                    </td>
                    <td className="r num">
                      <b>{usd(sum(rows, "contractCents"))}</b>
                    </td>
                    <td className="r num">
                      <b>{usd(sum(rows, "recognizedCents"))}</b>
                    </td>
                    <td className="r num">
                      <b>{prior ? usd(sum(rows, "recognizedCents") - sum(priorRows.filter((p) => rows.some((r) => r.jobId === p.jobId)), "recognizedCents")) : ""}</b>
                    </td>
                    <td className="r num">
                      <b>{usd(sum(rows, "billedCents"))}</b>
                    </td>
                    <td className="r num">
                      <b>{signed(sum(rows, "overUnderCents"))}</b>
                    </td>
                    <td className="r num">
                      <b>{usd(sum(rows, "costToCompleteCents"))}</b>
                    </td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function prevMonthOf(p: string) {
  const [y, mo] = p.split("-").map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
}
