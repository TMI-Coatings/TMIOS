import { useEffect, useMemo, useState } from "react";
import { StackedBars } from "../components/StackedBars";
import { TrendChart } from "../components/TrendChart";
import { backlogCents, backlogWeeks, firmnessMix } from "../domain/insights";
import { Money, revenueByPeriod } from "../domain/money";
import { allPlans, buildIndex } from "../domain/schedule";
import { fmtLong, fmtShort, todayIn } from "../domain/weeks";
import { n1, pct, usd } from "../format";
import type { Ctx } from "../Workspace";

const dp = (a: number, b: number) => `${b - a >= 0 ? "+" : "−"}${Math.abs(Math.round((b - a) * 100))} pts`;

/** The board view and its PDF pack: four numbers the board can check quarter to quarter (decision 12: no board login). */
export function BoardScreen({ ctx }: { ctx: Ctx }) {
  const { data, repo, week } = ctx;
  const ds = data.ds;
  const s = ds.settings;
  const [counts, setCounts] = useState<{ changes: number; alerts: number; digests: number; closes: number; acknowledgments: number } | null>(null);
  useEffect(() => {
    repo.boardCounts().then(setCounts, () => setCounts(null));
  }, [repo, data]);
  const idx = useMemo(() => buildIndex(ds), [ds]);
  const plans = useMemo(() => allPlans(ds, idx, week), [ds, idx, week]);
  const m = useMemo(() => new Money(ds, idx, week, todayIn(new Date())), [ds, idx, week]);
  const months = revenueByPeriod(ds, m, plans, week, "month");

  // Illustrative weeks carry backlog in weeks only; fill dollars at today's dollars-per-week.
  const bw = backlogWeeks(ds, idx, week);
  const ratio = bw ? backlogCents(ds, idx) / bw : 0;
  const series = [...ds.metrics]
    .sort((a, b) => a.week.localeCompare(b.week))
    .map((x) => ({ ...x, backlogCents: x.backlogCents ?? (x.backlogWeeks ?? 0) * ratio }));
  // On-time is only measured in weeks that finished a job; carry the last value forward.
  let lastOnTime: number | null = null;
  for (const x of series) {
    if (x.onTime == null) x.onTime = lastOnTime;
    else lastOnTime = x.onTime;
  }
  const f = series[0];
  const l = series.at(-1);
  const real = series.filter((x) => !x.illustrative).length;
  const labels = series.map((x) => fmtShort(x.week));
  const ill = series.map((x) => x.illustrative);
  const mix = firmnessMix(ds, plans, week);

  if (!f || !l)
    return (
      <>
        <h1>Board view</h1>
        <p className="lead">The board numbers start with the first weekly close.</p>
      </>
    );

  const card = (title: string, val: string, delta: string, good: boolean, sub: string, chart: React.ReactNode) => (
    <div className="panel bm">
      <div className="note">{title}</div>
      <div className="big num">{val}</div>
      <div className={"d" + (good ? "" : " bad")}>
        {delta} since {fmtShort(f.week)}
      </div>
      <div className="note">{sub}</div>
      <div style={{ marginTop: 8 }}>{chart}</div>
    </div>
  );

  return (
    <div className="board-pack">
      <div className="print-only" style={{ marginBottom: 12 }}>
        <b>TMI Coatings · Board pack</b>
        <div className="note">
          Week ending {fmtLong(week)}. Prepared {fmtLong(todayIn(new Date()))} from TMI Ops.
        </div>
      </div>
      <div className="confirm">
        <h1 style={{ margin: 0 }}>Board view</h1>
        <button className="btn no-print" onClick={() => window.print()}>
          Export board pack (PDF)
        </button>
      </div>
      <p className="lead">
        Four numbers the board can check quarter to quarter.{" "}
        {series.some((x) => x.illustrative)
          ? `Dashed grey weeks are illustrative sample history; ${real ? `the last ${real} come from weeks closed in the app.` : "close a week and it lands here as real data."}`
          : `${real} weeks of closed data.`}
      </p>
      <p className="note no-print">Export opens your browser’s print window; choose Save as PDF. The pack is the board’s copy; there is no board login (decision 12).</p>
      <div className="board4">
        {card(
          "Crew utilization",
          pct(l.utilization ?? 0),
          dp(f.utilization ?? 0, l.utilization ?? 0),
          (l.utilization ?? 0) >= (f.utilization ?? 0),
          `Against the ${s.targetHeadcount}-man working target. Against the full roster: ${pct(l.utilizationRoster ?? 0)}.`,
          <TrendChart title="Crew utilization by week" labels={labels} values={series.map((x) => x.utilization)} illustrative={ill} format={(v) => pct(v)} />,
        )}
        {card(
          "Sold backlog",
          `${n1(l.backlogWeeks ?? 0)} wks`,
          `${(l.backlogWeeks ?? 0) - (f.backlogWeeks ?? 0) >= 0 ? "+" : "−"}${n1(Math.abs((l.backlogWeeks ?? 0) - (f.backlogWeeks ?? 0)))} weeks`,
          (l.backlogWeeks ?? 0) >= (f.backlogWeeks ?? 0),
          `${usd(l.backlogCents ?? 0)} of sold work not yet performed.`,
          <TrendChart title="Sold backlog in weeks" labels={labels} values={series.map((x) => x.backlogWeeks)} illustrative={ill} format={(v) => n1(v) + " wks"} />,
        )}
        {card(
          "Forecast accuracy",
          pct(l.accuracy ?? 0),
          dp(f.accuracy ?? 0, l.accuracy ?? 0),
          (l.accuracy ?? 0) >= (f.accuracy ?? 0),
          "Actual hours against the forecast made four weeks earlier.",
          <TrendChart title="Forecast accuracy by week" labels={labels} values={series.map((x) => x.accuracy)} illustrative={ill} format={(v) => pct(v)} />,
        )}
        {card(
          "On-time completion",
          pct(l.onTime ?? 0),
          dp(f.onTime ?? 0, l.onTime ?? 0),
          (l.onTime ?? 0) >= (f.onTime ?? 0),
          "Shutdown and contract jobs against their deadline; all others against the finish date set when first scheduled.",
          <TrendChart title="On-time completion by week" labels={labels} values={series.map((x) => x.onTime)} illustrative={ill} format={(v) => pct(v)} />,
        )}
      </div>
      {mix.total > 0 && (
        <p className="note">
          Next 8 weeks: {pct((mix.byFirmness.locked + mix.byFirmness.confirmed + mix.byFirmness.waiting) / mix.total)} of scheduled hours locked or confirmed with the customer,{" "}
          {pct(mix.byFirmness.best_guess / mix.total)} TMI’s best guess, {pct((mix.byFirmness.flexible + mix.byFirmness.fill_in) / mix.total)} flexible or fill-in.
        </p>
      )}
      <h2>Revenue by month</h2>
      <div className="panel">
        <StackedBars
          title="Revenue recognized and forecast by month"
          labels={months.map((x) => x.label)}
          highlight={0}
          format={usd}
          series={[
            { label: "Recognized", color: "var(--series-1)", values: months.map((x) => x.actual) },
            { label: "Forecast", color: "var(--series-2)", values: months.map((x) => x.lab + x.mat) },
          ]}
        />
        <p className="note">Recognized from Monday percent complete; forecast from the schedule. Sold work only.</p>
      </div>
      <h2>Communication record</h2>
      <div className="kpis" style={{ gridTemplateColumns: "repeat(5,1fr)" }}>
        {[
          [counts?.changes, "Changes logged with name and time"],
          [counts?.alerts, "Alerts sent to leadership"],
          [counts?.digests, "Monday digests sent"],
          [counts?.closes, "Weeks closed in the system"],
          [counts?.acknowledgments, "Field schedule acknowledgments"],
        ].map(([v, lab]) => (
          <div className="kpi" key={lab as string}>
            <div className="v num">{v ?? "–"}</div>
            <div className="l">{lab}</div>
          </div>
        ))}
      </div>
      <h2>Before and after</h2>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Question the board asks</th>
              <th>Before</th>
              <th>Now</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Are crews busy?", "Estimated from job cost after the fact", "Utilization every week, against target and full roster"],
              ["How much work is sold ahead?", "Read off a spreadsheet by eye", "Backlog in weeks and dollars, trended"],
              ["Can we trust the schedule?", "No way to tell", "Each week’s actual against the forecast made four weeks before"],
              ["Do we finish when we say?", "Not tracked", "Shutdown and contract deadlines tracked to the date; every other job against the finish date set when it was scheduled"],
              ["What revenue lands this quarter?", "Estimated at month end", "Weekly WIP from the Monday job cost meeting: recognized revenue, over and under billing, margin fade, forecast from the schedule"],
              ["Do we have the right people?", "Known by memory", "Crew assignments checked for double-booking, time off and qualifications"],
              ["Who knew about a change?", "One person’s workbook, overwritten weekly", "Full change log, automatic alerts, Monday digest, leader sign-off, and every crew member sees and acknowledges their week"],
            ].map(([q, b, n]) => (
              <tr key={q}>
                <td style={{ whiteSpace: "normal" }}>{q}</td>
                <td style={{ whiteSpace: "normal" }}>{b}</td>
                <td style={{ whiteSpace: "normal" }}>{n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
