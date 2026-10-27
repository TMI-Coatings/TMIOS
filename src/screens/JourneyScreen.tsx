import { useState } from "react";
import { can, canSeeJob } from "../domain/permissions";
import { AUTO_LABEL, canCheck, type CheckpointDef, type CheckpointOwner, dueDate, type JourneyStage, leadText, OWNER_LABEL, ownerName } from "../domain/journey";
import type { Job } from "../domain/types";
import { journeyOf, namesOf } from "../domain/views";
import { addDays, fmtShort, todayIn } from "../domain/weeks";
import { pct } from "../format";
import type { Ctx } from "../Workspace";
import { JobDialog } from "./JobDialog";

/** Where every open job stands, from sale to closeout. */
export function JourneyScreen({ ctx }: { ctx: Ctx }) {
  const { viewer, data, repo, run } = ctx;
  const ds = data.ds;
  const [openJob, setOpenJob] = useState<string | null>(null);
  const today = todayIn(new Date());
  const jy = journeyOf(ds, today);
  const n = namesOf(ds);
  const look = ds.settings.journeyLookaheadDays;
  const jobs = ds.jobs.filter((j) => j.status !== "complete" || jy.stageOf(j) < jy.stages.length);
  const startSoon = jobs.filter((j) => j.status !== "complete" && j.start <= addDays(today, look) && jy.inStartup(j));
  const notReady = startSoon.filter((j) => jy.startupDefs().some((c) => jy.isLate(j, c) || jy.isSoon(j, c)));
  const late = jobs.flatMap((j) => jy.lateList(j).map((c) => ({ j, c }))).sort((a, b) => jy.daysLate(b.j, b.c) - jy.daysLate(a.j, a.c));
  const closeIdx = jy.stages.findIndex((s) => s.key === "punch");
  const inClose = jobs.filter((j) => closeIdx >= 0 && jy.stageOf(j) >= closeIdx).length;
  const full = ["admin", "ceo", "cfo"].includes(viewer.role);
  const mine = full
    ? []
    : jobs
        .flatMap((j) => jy.defs.filter((c) => canCheck(viewer, c, canSeeJob(viewer, j) ? j : null) && !jy.isDone(j, c) && dueDate(j, c) <= addDays(today, 14)).map((c) => ({ j, c })))
        .sort((a, b) => dueDate(a.j, a.c).localeCompare(dueDate(b.j, b.c)));

  const row = ({ j, c }: { j: Job; c: CheckpointDef }) => (
    <tr key={j.id + c.key}>
      <td>
        <button className="jl" onClick={() => setOpenJob(j.id)}>
          {j.number} {j.customer}
        </button>
      </td>
      <td>{c.label}</td>
      <td>{ownerName(j, c, n)}</td>
      <td>{fmtShort(dueDate(j, c))}</td>
      <td className="r num">{jy.isLate(j, c) ? jy.daysLate(j, c) : "—"}</td>
      <td>
        {canCheck(viewer, c, j) && (
          <button className="btn sec" onClick={() => run(() => repo.setCheckpoint(j.id, c.key, true), "Marked done.")}>
            Mark done
          </button>
        )}
      </td>
    </tr>
  );
  const head = (
    <thead>
      <tr>
        <th>Job</th>
        <th>Checkpoint</th>
        <th>Owner</th>
        <th>Due</th>
        <th className="r">Days late</th>
        <th />
      </tr>
    </thead>
  );
  const card = (j: Job) => {
    const lt = jy.lateList(j);
    const nx = jy.next(j);
    const si = jy.stageOf(j);
    const soon = !lt.length && nx && jy.isSoon(j, nx);
    const startup = si < jy.stages.length && jy.stages[si].startup;
    return (
      <button key={j.id} className={"jycard" + (lt.length ? " late" : soon ? " soon" : "")} onClick={() => setOpenJob(j.id)}>
        <b>
          {j.number} {j.customer}
        </b>
        <span className="q">
          {startup ? `Starts ${fmtShort(j.start)}` : j.status === "complete" ? `Finished ${fmtShort(j.actualFinish ?? j.projectedFinish)}` : `Finish ${fmtShort(j.projectedFinish)}`}. PM {n.pm(j.pmCode)}.
        </span>
        {nx && (
          <span className={"q" + (lt.length ? " r" : "")}>
            {lt.length ? `${lt.length} overdue. ` : ""}Next: {nx.label.charAt(0).toLowerCase() + nx.label.slice(1)}, {ownerName(j, nx, n)}, due {fmtShort(dueDate(j, nx))}.
          </span>
        )}
        {startup && (
          <span className="jymeter" title={`Startup ${pct(jy.readiness(j))} done`}>
            <i style={{ width: jy.readiness(j) * 100 + "%" }} />
          </span>
        )}
      </button>
    );
  };

  return (
    <>
      <h1>Job journey</h1>
      <p className="lead">Where every open job stands, from sale to closeout. Each checkpoint has an owner and a due date set from the job’s start or finish.</p>
      <div className="kpis" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
        <div className="kpi">
          <div className="v num">{startSoon.length}</div>
          <div className="l">Jobs starting in the next {look} days</div>
        </div>
        <div className={"kpi" + (notReady.length ? " warn" : "")}>
          <div className="v num">{notReady.length}</div>
          <div className="l">Of those, not ready: startup checkpoints late or due this week</div>
        </div>
        <div className={"kpi" + (late.length ? " warn" : "")}>
          <div className="v num">{late.length}</div>
          <div className="l">Checkpoints overdue</div>
        </div>
        <div className="kpi">
          <div className="v num">{inClose}</div>
          <div className="l">Jobs in punch or closeout</div>
        </div>
      </div>
      {mine.length > 0 && (
        <>
          <h2>Your checkpoints, next 2 weeks</h2>
          <div className="scroll">
            <table>
              {head}
              <tbody>{mine.map(row)}</tbody>
            </table>
          </div>
        </>
      )}
      <h2>The board</h2>
      <p className="note">Each job sits at its earliest unfinished stage. Red edge: something is overdue. Yellow: due within a week. The green bar is startup progress.</p>
      <div className="jyboard">
        {jy.stages.map((st, si) => {
          const cj = jobs.filter((j) => jy.stageOf(j) === si).sort((a, b) => jy.lateList(b).length - jy.lateList(a).length || a.start.localeCompare(b.start));
          return (
            <div className="jycol" key={st.key} data-stage={st.key}>
              <h3>
                {st.label}
                <span>{cj.length}</span>
              </h3>
              {cj.length ? (
                cj.map(card)
              ) : (
                <p className="note" style={{ margin: 4 }}>
                  None
                </p>
              )}
            </div>
          );
        })}
      </div>
      <h2>Overdue checkpoints</h2>
      {late.length ? (
        <div className="scroll">
          <table>
            {head}
            <tbody>{late.map(row)}</tbody>
          </table>
        </div>
      ) : (
        <div className="panel">
          <p className="note" style={{ margin: 0 }}>
            Nothing overdue.
          </p>
        </div>
      )}
      {can.editJourney(ctx.viewer.role) && <Stages ctx={ctx} />}
      <Definitions ctx={ctx} />
      {openJob && <JobDialog ctx={ctx} jobId={openJob} onClose={() => setOpenJob(null)} journeyOpen />}
    </>
  );
}

/** Admin, CEO and CFO rename, reorder, add or retire stages (decision 23). */
function Stages({ ctx }: { ctx: Ctx }) {
  const { data, repo, run } = ctx;
  const ds = data.ds;
  const all = [...ds.stages].sort((a, b) => a.sort - b.sort);
  const live = all.filter((s) => s.active);
  const [name, setName] = useState("");
  const [startup, setStartup] = useState(true);
  const save = (s: JourneyStage, isNew = false, done = isNew ? "Stage added." : "Stage saved.") => run(() => repo.saveStage(s, isNew), done);
  const move = async (i: number, d: -1 | 1) => {
    const a = live[i];
    const b = live[i + d];
    if (!a || !b) return;
    await run(async () => {
      await repo.saveStage({ ...a, sort: b.sort }, false);
      await repo.saveStage({ ...b, sort: a.sort }, false);
    }, "Stages reordered.");
  };
  return (
    <>
      <h2>Stages</h2>
      <p className="note">Stages before the job starts count toward readiness on the starting-soon list. A stage can only be retired once its checkpoints are moved or retired.</p>
      <div className="scroll">
        <table className="users" aria-label="Journey stages">
          <thead>
            <tr>
              <th>Order</th>
              <th>Stage</th>
              <th>Before the job starts</th>
              <th>In use</th>
            </tr>
          </thead>
          <tbody>
            {all.map((s) => {
              const i = live.indexOf(s);
              return (
                <tr key={s.key} style={s.active ? undefined : { opacity: 0.55 }}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {s.active && (
                      <>
                        <button className="jl" disabled={i === 0} aria-label={`Move ${s.label} up`} onClick={() => move(i, -1)}>
                          ↑
                        </button>{" "}
                        <button className="jl" disabled={i === live.length - 1} aria-label={`Move ${s.label} down`} onClick={() => move(i, 1)}>
                          ↓
                        </button>
                      </>
                    )}
                  </td>
                  <td>
                    <input key={s.label} defaultValue={s.label} aria-label={`${s.label} stage name`} style={{ width: "100%" }} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== s.label && save({ ...s, label: e.target.value.trim() })} />
                  </td>
                  <td>
                    <input type="checkbox" checked={s.startup} aria-label={`${s.label} before the job starts`} onChange={(e) => save({ ...s, startup: e.target.checked })} />
                  </td>
                  <td>
                    <input type="checkbox" checked={s.active} aria-label={`${s.label} in use`} onChange={(e) => save({ ...s, active: e.target.checked }, false, e.target.checked ? "Stage back in use." : "Stage retired.")} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <label className="field">
          New stage
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pre-job safety review" />
        </label>
        <label className="q">
          <input type="checkbox" checked={startup} onChange={(e) => setStartup(e.target.checked)} /> Before the job starts
        </label>
        <button
          className="btn"
          disabled={!name.trim()}
          onClick={async () => {
            const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 36) || "stage";
            let key = base;
            for (let k = 2; ds.stages.some((s) => s.key === key); k++) key = `${base}-${k}`;
            const sort = Math.max(0, ...ds.stages.map((s) => s.sort)) + 1;
            if (await save({ key, label: name.trim(), sort, startup, active: true }, true)) setName("");
          }}
        >
          Add stage
        </button>
      </div>
    </>
  );
}

/** The journey step by step. Admin, CEO and CFO can rename, re-time, reassign, add or retire checkpoints (decision 23). */
function Definitions({ ctx }: { ctx: Ctx }) {
  const { viewer, data, repo, run } = ctx;
  const ds = data.ds;
  const edit = can.editJourney(viewer.role);
  const stages = [...ds.stages].filter((s) => s.active).sort((a, b) => a.sort - b.sort);
  const defs = [...ds.checkpointDefs].sort((a, b) => (stages.findIndex((s) => s.key === a.stageKey) - stages.findIndex((s) => s.key === b.stageKey)) || a.sort - b.sort);
  const [draft, setDraft] = useState<CheckpointDef>({ key: "", stageKey: stages[0]?.key ?? "", label: "", owner: "pm", offsetDays: -7, anchor: "start", autoSource: null, sort: 100, active: true });
  const save = (d: CheckpointDef, isNew = false) => run(() => repo.saveCheckpointDef(d, isNew), isNew ? "Checkpoint added." : "Checkpoint saved.");
  return (
    <>
      <h2>The journey, step by step</h2>
      {edit && <p className="note">Change a name, owner or timing and it applies to every job at once. Retired checkpoints stay in the history.</p>}
      <div className="scroll">
        <table className="users">
          <thead>
            <tr>
              <th>Stage</th>
              <th>Checkpoint</th>
              <th>Owner</th>
              <th>Due</th>
              {edit && <th>In use</th>}
            </tr>
          </thead>
          <tbody>
            {defs
              .filter((c) => edit || c.active)
              .map((c) => (
                <tr key={c.key} style={c.active ? undefined : { opacity: 0.55 }}>
                  <td>{stages.find((s) => s.key === c.stageKey)?.label}</td>
                  <td>
                    {edit && !c.autoSource ? (
                      <input key={c.label} defaultValue={c.label} aria-label={`${c.label} name`} style={{ width: "100%" }} onBlur={(e) => e.target.value.trim() && e.target.value !== c.label && save({ ...c, label: e.target.value.trim() })} />
                    ) : (
                      c.label
                    )}
                    {c.autoSource && <span className="q"> (automatic, from the {AUTO_LABEL[c.autoSource]})</span>}
                  </td>
                  <td>
                    {edit && !c.autoSource ? (
                      <select value={c.owner} aria-label={`${c.label} owner`} onChange={(e) => save({ ...c, owner: e.target.value as CheckpointOwner })}>
                        {Object.entries(OWNER_LABEL).map(([k, l]) => (
                          <option key={k} value={k}>
                            {l}
                          </option>
                        ))}
                      </select>
                    ) : (
                      OWNER_LABEL[c.owner]
                    )}
                  </td>
                  <td>
                    {edit ? (
                      <span style={{ whiteSpace: "nowrap" }}>
                        <input
                          key={c.offsetDays}
                          type="number"
                          defaultValue={c.offsetDays}
                          aria-label={`${c.label} days`}
                          style={{ width: 70 }}
                          onBlur={(e) => Number(e.target.value) !== c.offsetDays && Number.isFinite(Number(e.target.value)) && save({ ...c, offsetDays: Math.round(Number(e.target.value)) })}
                        />{" "}
                        days from{" "}
                        <select value={c.anchor} aria-label={`${c.label} anchor`} onChange={(e) => save({ ...c, anchor: e.target.value as "start" | "finish" })}>
                          <option value="start">start</option>
                          <option value="finish">finish</option>
                        </select>
                      </span>
                    ) : (
                      leadText(c)
                    )}
                  </td>
                  {edit && (
                    <td>
                      <input type="checkbox" checked={c.active} aria-label={`${c.label} in use`} disabled={!!c.autoSource} onChange={(e) => save({ ...c, active: e.target.checked })} />
                    </td>
                  )}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <div className="panel" style={{ marginTop: 12 }}>
          <div className="row">
            <label className="field">
              Stage
              <select value={draft.stageKey} onChange={(e) => setDraft({ ...draft, stageKey: e.target.value })}>
                {stages.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field" style={{ flex: 1, minWidth: 220 }}>
              New checkpoint
              <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
            </label>
            <label className="field">
              Owner
              <select value={draft.owner} onChange={(e) => setDraft({ ...draft, owner: e.target.value as CheckpointOwner })}>
                {Object.entries(OWNER_LABEL).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Days
              <input type="number" value={draft.offsetDays} style={{ width: 80 }} onChange={(e) => setDraft({ ...draft, offsetDays: Math.round(Number(e.target.value) || 0) })} />
            </label>
            <label className="field">
              From
              <select value={draft.anchor} onChange={(e) => setDraft({ ...draft, anchor: e.target.value as "start" | "finish" })}>
                <option value="start">start</option>
                <option value="finish">finish</option>
              </select>
            </label>
            <button
              className="btn"
              disabled={!draft.label.trim()}
              onClick={async () => {
                const base = draft.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 36) || "checkpoint";
                let key = base;
                for (let n = 2; ds.checkpointDefs.some((c) => c.key === key); n++) key = `${base}-${n}`;
                const sort = Math.max(0, ...ds.checkpointDefs.filter((c) => c.stageKey === draft.stageKey).map((c) => c.sort)) + 1;
                if (await save({ ...draft, key, label: draft.label.trim(), sort }, true)) setDraft({ ...draft, label: "" });
              }}
            >
              Add checkpoint
            </button>
          </div>
        </div>
      )}
      <p className="note">Once Procore is connected, submittals, purchase orders and invoices can check themselves off from what’s already entered there.</p>
    </>
  );
}
