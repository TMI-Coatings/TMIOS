import { Fragment, useMemo, useState } from "react";
import { Money } from "../domain/money";
import { buildIndex, eac, isSold } from "../domain/schedule";
import { fadeCents, leaderRows, lostByCause } from "../domain/scorecard";
import { addDays, fmtShort, todayIn } from "../domain/weeks";
import { n0, pct, usd } from "../format";
import type { Ctx } from "../Workspace";

const pts = (v: number) => `${v >= 0 ? "+" : "−"}${(Math.round(Math.abs(v * 1000)) / 10).toLocaleString("en-US")} pts`;
const usdS = (v: number) => (v < 0 ? `(${usd(Math.abs(v))})` : usd(v));
const red = (v: number) => (v < 0 ? { color: "var(--red)" } : undefined);

/** Each leader's finished jobs over the last year plus jobs running now, ranked by field-caused fade. */
export function ScorecardScreen({ ctx }: { ctx: Ctx }) {
  const { viewer, data, repo, run, week } = ctx;
  const ds = data.ds;
  const s = ds.settings;
  const me = viewer.role === "superintendent";
  const canTag = ["admin", "ceo", "cfo", "scheduler", "pm"].includes(viewer.role);
  const idx = useMemo(() => buildIndex(ds), [ds]);
  const m = useMemo(() => new Money(ds, idx, week, todayIn(new Date())), [ds, idx, week]);
  const since = addDays(week, -Math.round(s.scorecardMonths * 30.4));
  const outcomes = ds.outcomes.filter((o) => o.finishedOn >= since);
  const leaders = ds.people.filter((p) => p.kind === "leader" && (!me || p.id === viewer.personId));
  const running = ds.jobs.filter((j) => isSold(j) && ds.actuals.some((a) => a.jobId === j.id));
  const rows = leaderRows(leaders, outcomes, running, s.overrunPct);
  const [open, setOpen] = useState<string | null>(me ? viewer.personId : null);
  const est = outcomes.reduce((a, o) => a + o.estimateHrs, 0);
  const act = outcomes.reduce((a, o) => a + o.actualHrs, 0);
  const causes = lostByCause(outcomes);
  const lost = causes.reduce((a, [, v]) => a + v, 0);
  const anyIllus = outcomes.some((o) => o.illustrative);

  return (
    <>
      <h1>{me ? "My scorecard" : "Leader scorecard"}</h1>
      <p className="lead">
        {me ? "Your" : "Each leader’s"} completed jobs over the last {s.scorecardMonths} months, plus jobs running now. Fade is final margin against bid margin. The PM tags the cause of every overrun at
        closeout, so estimating misses and uncaptured change orders don’t land on the leader. Ranked by field-caused fade.
      </p>
      <div className="kpis" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
        <div className="kpi">
          <div className="v num">{outcomes.length}</div>
          <div className="l">Jobs completed, {s.scorecardMonths} months</div>
        </div>
        <div className={"kpi" + (est && act > est ? " warn" : "")}>
          <div className="v num">{est ? `${act >= est ? "+" : "−"}${n0(Math.abs(act / est - 1) * 100)}%` : "–"}</div>
          <div className="l">Hours against bid</div>
        </div>
        <div className={"kpi" + (lost < 0 ? " warn" : "")}>
          <div className="v num">{usdS(lost)}</div>
          <div className="l">Margin lost to fade</div>
        </div>
        <div className="kpi">
          <div className="num" style={{ fontSize: 14, lineHeight: 1.5 }}>
            {causes.length ? causes.map(([k, v]) => <div key={k}>{`${k}: ${pct(lost ? v / lost : 0)}`}</div>) : "None"}
          </div>
          <div className="l">Lost margin by cause</div>
        </div>
      </div>
      <div className="scroll" style={{ marginTop: 16 }}>
        <table>
          <thead>
            <tr>
              <th>Leader</th>
              <th className="r">Jobs</th>
              <th className="r">Hours vs bid</th>
              <th className="r">Jobs over {s.overrunPct}%</th>
              <th className="r">Margin fade</th>
              <th className="r">Fade $</th>
              <th className="r">Field-caused $</th>
              <th className="r">On time</th>
              <th className="r">Running now</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="note">
                  No finished jobs yet. The scorecard fills in as jobs close out.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const liveFade = r.running.reduce((a, j) => a + m.contract(j) * m.fade(j), 0);
              return (
                <Fragment key={r.leader.id}>
                  <tr style={{ cursor: "pointer" }} onClick={() => setOpen(open === r.leader.id ? null : r.leader.id)} data-leader={r.leader.name}>
                    <td>
                      <button className="jl" aria-expanded={open === r.leader.id}>
                        <strong>{r.leader.name}</strong>
                      </button>{" "}
                      {r.jobs < 4 && <span className="tag yel">Small sample</span>}
                    </td>
                    <td className="r num">{r.jobs}</td>
                    <td className="r num" style={r.hoursVsBid > s.overrunPct / 100 ? { color: "var(--red)" } : undefined}>
                      {r.hoursVsBid >= 0 ? "+" : "−"}
                      {n0(Math.abs(r.hoursVsBid) * 100)}%
                    </td>
                    <td className="r num">{r.over}</td>
                    <td className="r num" style={red(r.fadePts)}>
                      {pts(r.fadePts)}
                    </td>
                    <td className="r num" style={red(r.fadeCents)}>
                      {usdS(r.fadeCents)}
                    </td>
                    <td className="r num" style={red(r.fieldCents)}>
                      {usdS(r.fieldCents)}
                    </td>
                    <td className="r num">{r.onTime == null ? "–" : pct(r.onTime)}</td>
                    <td className="r num" style={red(liveFade)}>
                      {r.running.length ? `${r.running.length} · ${usdS(liveFade)}` : "–"}
                    </td>
                  </tr>
                  {open === r.leader.id && (
                    <tr>
                      <td colSpan={9}>
                        <div className="scroll">
                          <table>
                            <thead>
                              <tr>
                                <th>Job</th>
                                <th>Finished</th>
                                <th className="r">Hours bid</th>
                                <th className="r">Hours actual</th>
                                <th className="r">GP bid</th>
                                <th className="r">GP final</th>
                                <th className="r">Fade</th>
                                <th>On time</th>
                                <th>Cause of overrun</th>
                              </tr>
                            </thead>
                            <tbody>
                              {r.outcomes.map((o) => {
                                const over = o.actualHrs > o.estimateHrs * (1 + s.overrunPct / 100);
                                const tagAllowed = canTag && (viewer.role !== "pm" || o.pmCode === viewer.pmCode);
                                return (
                                  <tr key={o.id}>
                                    <td>
                                      {o.number} {o.customer}
                                      <div className="note">{o.jobType}</div>
                                    </td>
                                    <td>{fmtShort(o.finishedOn)}</td>
                                    <td className="r num">{n0(o.estimateHrs)}</td>
                                    <td className="r num" style={over ? { color: "var(--red)" } : undefined}>
                                      {n0(o.actualHrs)}
                                    </td>
                                    <td className="r num">{pct(o.gpBid)}</td>
                                    <td className="r num">{pct(o.gpFinal)}</td>
                                    <td className="r num" style={red(o.gpFinal - o.gpBid)}>
                                      {pts(o.gpFinal - o.gpBid)}
                                    </td>
                                    <td>{o.onTime ? "Yes" : <span className="tag red">Late</span>}</td>
                                    <td>
                                      {o.actualHrs > o.estimateHrs * 1.03 || fadeCents(o) < 0 || o.cause ? (
                                        tagAllowed ? (
                                          <select value={o.cause ?? ""} aria-label={`Cause of overrun ${o.number}`} onChange={(e) => run(() => repo.tagCause(o.id, e.target.value || null), "Cause tagged.")}>
                                            <option value="">Untagged</option>
                                            {s.closeoutCauses.map((c) => (
                                              <option key={c}>{c}</option>
                                            ))}
                                          </select>
                                        ) : (
                                          o.cause ?? "Untagged"
                                        )
                                      ) : (
                                        <span className="note">On budget</span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                              {r.running.map((j) => (
                                <tr key={j.id}>
                                  <td>
                                    {j.number} {j.customer} <span className="tag blue">Running</span>
                                    <div className="note">{j.jobType}</div>
                                  </td>
                                  <td>Due {fmtShort(j.projectedFinish)}</td>
                                  <td className="r num">{n0(j.estimateHrs)}</td>
                                  <td className="r num">{n0(eac(idx, j))} proj.</td>
                                  <td className="r num">{pct(m.gpBid(j))}</td>
                                  <td className="r num">{pct(m.gpNow(j))} proj.</td>
                                  <td className="r num" style={red(m.fade(j))}>
                                    {pts(m.fade(j))}
                                  </td>
                                  <td />
                                  <td className="note">Tagged at closeout</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="note">
        {me ? "" : "Click a leader to see the jobs behind the numbers. "}
        {anyIllus ? "History before go-live is illustrative sample data. In production the scorecard starts empty and fills in as jobs close out (decision 30)." : ""}
      </p>
    </>
  );
}
