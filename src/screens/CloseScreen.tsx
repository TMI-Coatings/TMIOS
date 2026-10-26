import { useMemo, useState } from "react";
import type { CloseResult } from "../domain/close";
import { closeRows, parseHoursCsv, plannedFor, reviewFlag } from "../domain/close";
import { digestLines, digestTitle } from "../domain/insights";
import { can, canEditJob } from "../domain/permissions";
import { allPlans, buildIndex, hoursLeft } from "../domain/schedule";
import { fmtLong, fmtShort } from "../domain/weeks";
import { n0 } from "../format";
import type { Ctx } from "../Workspace";
import { JobDialog } from "./JobDialog";

type Source = "typed" | "csv" | "import";
const SOURCE_LABEL: Record<Source, string> = { typed: "Typed", csv: "CSV upload", import: "Time-system export" };

/** Friday's close: hours in, exceptions reviewed, finished jobs marked, then the schedule rolls forward. */
export function CloseScreen({ ctx }: { ctx: Ctx }) {
  const { viewer, data, repo, run } = ctx;
  const ds = data.ds;
  const w = data.weekToClose;
  const closer = can.closeWeek(viewer.role);
  const idx = useMemo(() => buildIndex(ds), [ds]);
  const plans = useMemo(() => (w ? allPlans(ds, idx, w) : new Map()), [ds, idx, w]);
  const rows = w ? closeRows(ds, w).filter((j) => closer || canEditJob(viewer, j, "actuals")) : [];
  const saved = new Map(ds.hourEntries.filter((e) => e.week === w).map((e) => [e.jobId, e]));
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries([...saved].map(([id, e]) => [id, String(e.hours)])));
  const [src, setSrc] = useState<Record<string, Source>>(() => Object.fromEntries([...saved].map(([id, e]) => [id, e.source])));
  const [finished, setFinished] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [importRan, setImportRan] = useState(saved.size > 0);
  const [result, setResult] = useState<CloseResult | null>(null);
  const [openJob, setOpenJob] = useState<string | null>(null);

  const banner = result && (
    <div className="banner">
      <b>Week ending {fmtShort(result.week)} closed.</b> {result.entered} jobs entered, {n0(result.total)} hrs.{" "}
      {result.missing ? `${result.missing} missing, named in Monday’s digest. ` : ""}
      {result.alerts} alerts sent. Schedule rolled to week ending {fmtShort(result.nextWeek)}.
    </div>
  );

  if (!w)
    return (
      <>
        {banner}
        <h1>Weekly close</h1>
        <p className="lead">This week is closed. The next close opens on the week ending {fmtLong(data.week)}.</p>
      </>
    );

  const apply = (map: Map<string, number>, label: Source) => {
    const nums = new Set(rows.map((j) => j.number));
    const nv = { ...vals };
    const ns = { ...src };
    for (const j of rows)
      if (map.has(j.number)) {
        nv[j.id] = String(Math.round(map.get(j.number)! * 10) / 10);
        ns[j.id] = label;
      }
    const unmatched = [...map].filter(([k]) => !nums.has(k)).map(([k, h]) => `${k} (${n0(h)} hrs)`);
    setVals(nv);
    setSrc(ns);
    setImportRan(true);
    setNote(`${SOURCE_LABEL[label]}: ${[...map.keys()].filter((k) => nums.has(k)).length} jobs matched.${unmatched.length ? ` Not on the schedule: ${unmatched.join(", ")}. Fix the job code in the time system.` : ""}`);
  };

  // Sample mode only: a pretend export that runs close to plan, with one job burning hot,
  // one job missing and one line coded to a job that isn't on the schedule, as in the demo.
  const sampleImport = () => {
    const map = new Map<string, number>();
    rows.forEach((j, i) => {
      if (i === 3) return;
      const f = i === 1 ? 1.35 : 0.92 + ((i * 37) % 17) / 100;
      map.set(j.number, Math.round(plannedFor(plans, j, w) * f));
    });
    map.set("4999", 24);
    apply(map, "import");
  };

  const entered = rows.filter((j) => (vals[j.id] ?? "").trim() !== "");
  const flags = rows.map((j) => reviewFlag(plannedFor(plans, j, w), (vals[j.id] ?? "").trim() === "" ? null : Number(vals[j.id]), importRan, ds.settings.overrunPct));
  const toReview = flags.filter(Boolean).length;
  const bad = entered.find((j) => !(Number(vals[j.id]) >= 0));

  const saveEntries = async () => {
    if (bad) return void run(() => Promise.reject(new Error(`Hours for ${bad.number} must be a number zero or above.`)));
    await run(async () => {
      for (const j of rows) {
        const v = (vals[j.id] ?? "").trim();
        const before = saved.get(j.id);
        if (v === "" && before) await repo.saveHourEntry(j.id, w, null, "typed");
        else if (v !== "" && (!before || before.hours !== Number(v) || before.source !== (src[j.id] ?? "typed"))) await repo.saveHourEntry(j.id, w, Number(v), src[j.id] ?? "typed");
      }
    }, "Hours saved. The scheduler sees them at the close.");
  };

  const close = async () => {
    if (bad) return void run(() => Promise.reject(new Error(`Hours for ${bad.number} must be a number zero or above.`)));
    const blank = rows.length - entered.length;
    if (blank && !confirm(`${blank} job${blank > 1 ? "s have" : " has"} no hours. Close anyway? They’ll be named in Monday’s digest.`)) return;
    let res: CloseResult | null = null;
    const ok = await run(async () => {
      res = await repo.closeWeek({
        week: w,
        entries: entered.map((j) => ({ jobId: j.id, hours: Number(vals[j.id]), source: src[j.id] ?? "typed" })),
        finished: [...finished],
      });
      const fresh = await repo.load(viewer);
      const fi = buildIndex(fresh.ds);
      await repo.postDigest(digestTitle(fresh.week), digestLines(fresh.ds, fi, allPlans(fresh.ds, fi, fresh.week), fresh.week).join("\n"));
    });
    if (ok && res) {
      setResult(res);
      window.scrollTo(0, 0);
    }
  };

  return (
    <>
      {banner}
      <h1>{closer ? "Close" : "Hours for"} week ending {fmtLong(w)}</h1>
      <p className="lead">
        {closer
          ? "Import the week’s hours from the time system, review the exceptions, then close. Closing archives the week, recalculates hours left and forecasts, fires any alerts, and rolls the schedule forward."
          : "Enter this week’s hours for your jobs and save. The scheduler reviews them and closes the week on Friday."}
      </p>
      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="row">
          {closer && repo.mode === "sample" && (
            <button className="btn" onClick={sampleImport}>
              Import from time system
            </button>
          )}
          <label className="btn sec" style={{ fontWeight: 600 }}>
            Upload a CSV
            <input
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                f.text().then((t) => apply(parseHoursCsv(t), "csv"));
                e.target.value = "";
              }}
            />
          </label>
          <span className="note">
            CSV columns: job number, hours. Anything you type by hand is marked as typed.
            {repo.mode === "live" && closer ? " The time-system connection comes once its export format is confirmed." : ""}
          </span>
        </div>
        {note && (
          <p className="note" style={{ margin: "10px 0 0" }}>
            {note}
          </p>
        )}
      </div>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Job</th>
              <th>Leader</th>
              <th className="r">Planned</th>
              <th className="r">Actual hrs</th>
              <th>Source</th>
              <th>Review</th>
              <th className="r">Hours left</th>
              {closer && <th>Finished</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8}>No jobs need hours this week.</td>
              </tr>
            )}
            {rows.map((j, i) => {
              const v = (vals[j.id] ?? "").trim();
              const flag = flags[i];
              return (
                <tr key={j.id} className={flag ? "exc" : ""} data-close-row={j.number}>
                  <td>
                    <button className="jl" onClick={() => setOpenJob(j.id)}>
                      {j.number} {j.customer}
                    </button>
                  </td>
                  <td>{ds.people.find((p) => p.id === j.leaderId)?.name ?? ""}</td>
                  <td className="r num">{n0(plannedFor(plans, j, w))}</td>
                  <td className="r">
                    <input
                      className={"act num" + (flag === "Missing" ? " miss" : "")}
                      type="number"
                      min={0}
                      step={1}
                      value={vals[j.id] ?? ""}
                      aria-label={`Actual hours ${j.customer}`}
                      onChange={(e) => {
                        setVals({ ...vals, [j.id]: e.target.value });
                        setSrc({ ...src, [j.id]: "typed" });
                      }}
                    />
                  </td>
                  <td className="note">{v === "" ? "" : SOURCE_LABEL[src[j.id] ?? "typed"]}</td>
                  <td>{flag && <span className={"tag " + (flag === "Missing" ? "yel" : "red")}>{flag}</span>}</td>
                  <td className="r num">{n0(hoursLeft(idx, j))}</td>
                  {closer && (
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Mark ${j.customer} finished`}
                        checked={finished.has(j.id)}
                        onChange={(e) => {
                          const f = new Set(finished);
                          if (e.target.checked) f.add(j.id);
                          else f.delete(j.id);
                          setFinished(f);
                        }}
                      />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ marginTop: 14, justifyContent: "flex-end" }}>
        <span className="note" style={{ marginRight: 12 }}>
          {entered.length} of {rows.length} entered{toReview ? `, ${toReview} to review` : ""}
        </span>
        <button className={closer ? "btn sec" : "btn"} onClick={saveEntries} disabled={!rows.length}>
          Save hours
        </button>
        {closer && (
          <button className="btn" onClick={close}>
            Close week and roll forward
          </button>
        )}
      </div>
      {openJob && <JobDialog ctx={ctx} jobId={openJob} onClose={() => setOpenJob(null)} />}
    </>
  );
}
