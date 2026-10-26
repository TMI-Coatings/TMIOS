import { useMemo, useState } from "react";
import { AttText } from "../components/AttText";
import { LoadChart } from "../components/LoadChart";
import { can } from "../domain/permissions";
import { firmnessMix, kpis, needsAttention } from "../domain/insights";
import { FIRMNESS, allPlans, availableMen, buildIndex, capacity, leadersNeeded, loadForWeek } from "../domain/schedule";
import type { Firmness } from "../domain/types";
import { fmtLong, fmtShort, weekList } from "../domain/weeks";
import { n0, n1, pct, usd } from "../format";
import type { Ctx } from "../Workspace";
import { JobDialog } from "./JobDialog";

const FIRM_COLOR: Record<Firmness, string> = {
  locked: "var(--text)",
  confirmed: "var(--blue)",
  waiting: "var(--blue-strong)",
  flexible: "color-mix(in srgb, var(--blue) 40%, transparent)",
  best_guess: "var(--yellow)",
  fill_in: "var(--muted)",
};

export function DashboardScreen({ ctx }: { ctx: Ctx }) {
  const { week, data, go } = ctx;
  const ds = data.ds;
  const s = ds.settings;
  const [openJob, setOpenJob] = useState<string | null>(null);
  const idx = useMemo(() => buildIndex(ds), [ds]);
  const plans = useMemo(() => allPlans(ds, idx, week), [ds, idx, week]);
  const k = kpis(ds, idx, plans, week);
  const att = useMemo(() => needsAttention(ds, idx, plans, week), [ds, idx, plans, week]);
  const weeks = weekList(week, 13);
  const labels = weeks.map(fmtShort);
  const mix = firmnessMix(ds, plans, week);
  const share = (f: Firmness) => (mix.total ? mix.byFirmness[f] / mix.total : 0);

  return (
    <>
      <h1>Week ending {fmtLong(week)}</h1>
      <p className="lead">
        Sold work only. Capacity is the active roster less time off, at {s.hoursPerManWeek} hrs a man-week less {s.absencePct}% absence.
      </p>
      <div className="kpis">
        <div className="kpi">
          <div className="v num">
            {n0(k.menScheduled)} <small>/ {n0(s.targetHeadcount)}</small>
          </div>
          <div className="l">
            Men scheduled vs. {n0(s.targetHeadcount)}-man target ({n0(k.menAvailable)} available)
          </div>
        </div>
        <div className={"kpi" + (k.leadersNeeded > k.leadersAvailable ? " warn" : "")}>
          <div className="v num">
            {n1(k.leadersNeeded)} <small>/ {n1(k.leadersAvailable)}</small>
          </div>
          <div className="l">Leaders needed / available</div>
        </div>
        <div className="kpi">
          <div className="v num">
            {n1(k.backlogWeeks)} <small>wks</small>
          </div>
          <div className="l">Sold backlog, {usd(k.backlogCents)}</div>
        </div>
        <div className={"kpi" + (k.overruns ? " warn" : "")}>
          <div className="v num">{k.overruns}</div>
          <div className="l">Jobs on pace to overrun</div>
        </div>
        <div className={"kpi" + (k.gaps ? " warn" : "")}>
          <div className="v num">{k.gaps}</div>
          <div className="l">Gap weeks in the next 8</div>
        </div>
      </div>

      <div className="grid2" style={{ marginTop: 16 }}>
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Hours: scheduled vs available, 13 weeks</h2>
          <LoadChart
            title="Scheduled hours against available hours by week"
            labels={labels}
            bars={weeks.map((w) => loadForWeek(ds, plans, w))}
            line={weeks.map((w) => capacity(ds, idx, w))}
            barLabel="Scheduled hrs (sold)"
            lineLabel="Available hrs"
            format={n0}
          />
          <p className="note">Space under the line is open capacity sales needs to fill.</p>
        </div>
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Job leaders: needed vs available</h2>
          <LoadChart
            title="Leaders needed against leaders available by week"
            labels={labels}
            bars={weeks.map((w) => leadersNeeded(ds, plans, w))}
            line={weeks.map((w) => availableMen(ds, idx, w, true))}
            barLabel="Leaders needed"
            lineLabel="Leaders available"
            format={n1}
          />
          <p className="note">
            Jobs over {n0(s.dedicatedLeaderHrs)} projected hrs need a dedicated leader; smaller jobs count as {s.smallJobLeaderWeight}.
          </p>
        </div>
      </div>

      {mix.total > 0 && (
        <>
          <h2>How firm the next 8 weeks are</h2>
          <div className="panel">
            <p className="note" style={{ margin: 0 }}>
              {pct(share("locked") + share("confirmed") + share("waiting"))} of scheduled hours are locked or confirmed with the customer. {pct(share("best_guess"))} are TMI’s best guess.
              {mix.hold ? ` ${n0(mix.hold)} hrs on hold are left out of capacity.` : ""}
            </p>
            <div className="firmbar" role="img" aria-label="Scheduled hours by date firmness">
              {FIRMNESS.map((f) =>
                mix.byFirmness[f.key] ? <span key={f.key} style={{ width: share(f.key) * 100 + "%", background: FIRM_COLOR[f.key] }} title={`${f.label}: ${n0(mix.byFirmness[f.key])} hrs`} /> : null,
              )}
            </div>
            <div className="firmkey">
              {FIRMNESS.map((f) => (
                <div key={f.key}>
                  <i style={{ background: FIRM_COLOR[f.key] }} />
                  <span>
                    {f.label}: <b className="num">{n0(mix.byFirmness[f.key])}</b> hrs
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <h2>Needs attention</h2>
      <div className="panel">
        {att.length ? (
          <ul className="att">
            {att.map((a, i) => (
              <li key={i}>
                <span className={"tag" + (a.tone ? " " + a.tone : "")}>{a.tag}</span>
                <AttText text={a.text} jobs={ds.jobs} onJob={setOpenJob} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="note" style={{ margin: 0 }}>
            Nothing needs attention this week.
          </p>
        )}
      </div>
      {can.editSettings(ctx.viewer.role) && (
        <p className="note">
          The thresholds behind these numbers are on the{" "}
          <button className="jl" onClick={() => go("settings")}>
            Settings
          </button>{" "}
          tab.
        </p>
      )}
      {openJob && <JobDialog ctx={ctx} jobId={openJob} onClose={() => setOpenJob(null)} />}
    </>
  );
}
