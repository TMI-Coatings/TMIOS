import { useMemo, useState } from "react";
import { AttText } from "../components/AttText";
import { LoadChart } from "../components/LoadChart";
import { can } from "../domain/permissions";
import { backlogWeeks, firmnessMix, gapWeeks, kpis, needsAttention } from "../domain/insights";
import { FIRMNESS, allPlans, availableMen, buildIndex, capacity, leadersNeeded, loadForWeek } from "../domain/schedule";
import type { Dataset, Firmness, IsoDate } from "../domain/types";
import { fmtLong, fmtShort, todayIn, weekList } from "../domain/weeks";
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
  if (ctx.viewer.role === "sales_rep") return <SalesDashboard ctx={ctx} />;
  const { week, data, go } = ctx;
  const ds = data.ds;
  const s = ds.settings;
  const [openJob, setOpenJob] = useState<string | null>(null);
  const idx = useMemo(() => buildIndex(ds), [ds]);
  const plans = useMemo(() => allPlans(ds, idx, week), [ds, idx, week]);
  const k = kpis(ds, idx, plans, week);
  const att = useMemo(() => needsAttention(ds, idx, plans, week, todayIn(new Date())), [ds, idx, plans, week]);
  const weeks = weekList(week, 13);
  const labels = weeks.map(fmtShort);

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

      <FirmnessMix ds={ds} plans={plans} week={week} />

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

function FirmnessMix({ ds, plans, week }: { ds: Dataset; plans: ReturnType<typeof allPlans>; week: IsoDate }) {
  const mix = firmnessMix(ds, plans, week);
  const share = (f: Firmness) => (mix.total ? mix.byFirmness[f] / mix.total : 0);
  if (!mix.total) return null;
  return (
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
  );
}

/**
 * The sales team's dashboard: company-wide capacity so reps can sell into open weeks.
 * Reps only see their own jobs, so the numbers come from the anonymous company totals
 * (decision 6): hours, dates and firmness, with no customers or dollars.
 */
function SalesDashboard({ ctx }: { ctx: Ctx }) {
  const { week, data } = ctx;
  const ds = data.totals ?? data.ds;
  const s = ds.settings;
  const idx = useMemo(() => buildIndex(ds), [ds]);
  const plans = useMemo(() => allPlans(ds, idx, week), [ds, idx, week]);
  const weeks = weekList(week, 13);
  const rows = weeks.map((w, i) => {
    const load = loadForWeek(ds, plans, w);
    const cap = capacity(ds, idx, w);
    return { w, load, cap, open: cap - load, leadersShort: leadersNeeded(ds, plans, w) - availableMen(ds, idx, w, true), sell: i >= s.openWindowStartWeeks && i <= s.openWindowEndWeeks };
  });
  const sellRows = rows.filter((r) => r.sell);
  const openToSell = sellRows.reduce((a, r) => a + Math.max(0, r.open), 0);
  const gaps = gapWeeks(ds, idx, plans, week).length;

  return (
    <>
      <h1>Capacity to sell</h1>
      <p className="lead">
        Company-wide, sold work only. Open hours are available capacity less scheduled hours. The sell window is {s.openWindowStartWeeks} to {s.openWindowEndWeeks} weeks out: existing accounts run about a month from quote to crews.
      </p>
      <div className="kpis">
        <div className="kpi">
          <div className="v num">{n0(openToSell)}</div>
          <div className="l">
            Open hrs in the sell window, about {n0(openToSell / s.hoursPerManWeek)} man-weeks
          </div>
        </div>
        <div className="kpi">
          <div className="v num">
            {sellRows.filter((r) => r.open >= s.openCapacityHrs).length} <small>/ {sellRows.length}</small>
          </div>
          <div className="l">Sell-window weeks with {n0(s.openCapacityHrs)}+ hrs open</div>
        </div>
        <div className="kpi">
          <div className="v num">
            {n1(backlogWeeks(ds, idx, week))} <small>wks</small>
          </div>
          <div className="l">Sold backlog</div>
        </div>
        <div className={"kpi" + (gaps ? " warn" : "")}>
          <div className="v num">{gaps}</div>
          <div className="l">Over-capacity weeks in the next 8</div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>Hours: scheduled vs available, 13 weeks</h2>
        <LoadChart
          title="Scheduled hours against available hours by week"
          labels={weeks.map(fmtShort)}
          bars={rows.map((r) => r.load)}
          line={rows.map((r) => r.cap)}
          barLabel="Scheduled hrs (sold)"
          lineLabel="Available hrs"
          format={n0}
        />
        <p className="note">Space under the line is open capacity sales needs to fill.</p>
      </div>

      <h2>Open capacity by week</h2>
      <div className="panel scroll">
        <table aria-label="Open capacity by week">
          <thead>
            <tr>
              <th>Week ending</th>
              <th className="r">Scheduled</th>
              <th className="r">Available</th>
              <th className="r">Open hrs</th>
              <th className="r">About men</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.w}>
                <td>{fmtShort(r.w)}</td>
                <td className="r num">{n0(r.load)}</td>
                <td className="r num">{n0(r.cap)}</td>
                <td className="r num">
                  <b>{n0(r.open)}</b>
                </td>
                <td className="r num">{r.open > 0 ? n0(r.open / s.hoursPerManWeek) : "0"}</td>
                <td>
                  {r.open < 0 ? (
                    <span className="tag red">Over capacity</span>
                  ) : r.sell && r.open >= s.openCapacityHrs ? (
                    <span className="tag blue">Sell into</span>
                  ) : r.sell ? (
                    "Sell window"
                  ) : (
                    ""
                  )}
                  {r.leadersShort > 0 && (
                    <>
                      {" "}
                      <span className="tag yel">{n1(r.leadersShort)} leaders short</span>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="note">Leaders short means a big job that week needs a dedicated leader nobody is free to run. Check with Nicole before promising those dates.</p>
      </div>

      <FirmnessMix ds={ds} plans={plans} week={week} />
    </>
  );
}
