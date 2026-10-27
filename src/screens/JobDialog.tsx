import { useEffect, useMemo, useState } from "react";
import { Modal } from "../components/Modal";
import { assignedIds, CREW_ISSUE_LABEL, crewIssues, leaderConflicts, missingQuals, proposeCrew } from "../domain/crew";
import { jobProblem } from "../domain/jobRules";
import { type JobField, JOB_COLUMNS, can, canEditJob } from "../domain/permissions";
import { Money } from "../domain/money";
import { FIRMNESS, actualToDate, bidMargin, buildIndex, eac, hoursLeft, inWindow, isOverrun, offFraction } from "../domain/schedule";
import type { ChangeLogEntry, Job } from "../domain/types";
import { fmtLong, fmtShort, todayIn, weekList } from "../domain/weeks";
import { n0, pct, stamp, usd } from "../format";
import type { Ctx } from "../Workspace";
import { BillingPanel } from "./BillingPanel";
import { JourneyPanel } from "./JourneyPanel";
import { WorkOrderPanel } from "./WorkOrderPanel";
import { STATUS_LABEL, describeChange } from "../domain/changeText";

const STATUS = (Object.keys(STATUS_LABEL) as Job["status"][]).map((k) => ({ k, l: STATUS_LABEL[k] }));

export function JobDialog({ ctx, jobId, onClose, journeyOpen, billingOpen }: { ctx: Ctx; jobId: string; onClose: () => void; journeyOpen?: boolean; billingOpen?: boolean }) {
  const { viewer, week, data, repo, run } = ctx;
  const ds = data.ds;
  const job = ds.jobs.find((j) => j.id === jobId);
  const [form, setForm] = useState<Job | null>(job ? { ...job, firmnessReason: "" } : null);
  const [problem, setProblem] = useState<string | null>(null);
  const [log, setLog] = useState<ChangeLogEntry[] | null>(null);
  const idx = useMemo(() => buildIndex(ds), [ds]);
  const crewWeeks = useMemo(() => (job ? weekList(week, 30).filter((w) => inWindow(job, w)) : []), [job, week]);
  const [crewWeek, setCrewWeek] = useState(crewWeeks[0] ?? null);
  const [addPerson, setAddPerson] = useState("");
  const [proposal, setProposal] = useState<string[] | null>(null);
  const [note, setNote] = useState({ text: "", pinned: false, crew: false });

  useEffect(() => {
    repo.changeLog(jobId).then(setLog, () => setLog([]));
  }, [repo, jobId, data]);

  if (!job || !form) return null;
  const ed = (f: JobField) => canEditJob(viewer, job, f);
  const set = <K extends keyof Job>(k: K, v: Job[K]) => setForm({ ...form, [k]: v });
  const editableGroups = (Object.keys(JOB_COLUMNS) as (keyof typeof JOB_COLUMNS)[]).filter((g) => ed(g));
  const anyEdit = editableGroups.length > 0;

  const save = async () => {
    const allowed = new Set(editableGroups.flatMap((g) => JOB_COLUMNS[g]));
    const patch: Partial<Job> = {};
    for (const k of allowed) {
      if (k === "firmnessReason") continue;
      if (JSON.stringify(form[k]) !== JSON.stringify(job[k])) (patch as Record<string, unknown>)[k] = form[k];
    }
    if (patch.firmness !== undefined || patch.waitsOnJobId !== undefined) {
      if (form.firmnessReason?.trim()) patch.firmnessReason = form.firmnessReason.trim();
      if (form.firmness !== "waiting") patch.waitsOnJobId = null;
    }
    if (patch.status !== undefined && form.status !== "on_hold") {
      patch.holdReason = null;
      patch.holdUntil = null;
    }
    if (patch.mustFinish !== undefined && !form.mustFinish) patch.mustFinishReason = null;
    if (!Object.keys(patch).length) return onClose();
    const p = jobProblem(job, { ...job, ...patch });
    if (p) return setProblem(p);
    if (await run(() => repo.updateJob(job.id, patch), `Job ${job.number} saved.`)) onClose();
  };

  const act = actualToDate(idx, job);
  const e = eac(idx, job);
  const left = hoursLeft(idx, job);
  const span = Math.max(1, (Date.parse(job.projectedFinish) - Date.parse(job.start)) / 864e5);
  const elapsed = Math.min(1, Math.max(0, (Date.parse(week) - Date.parse(job.start)) / 864e5 / span));
  const used = Math.min(1.2, act / Math.max(1, job.projectedHrs));
  const leaders = ds.people.filter((p) => p.kind === "leader" && (p.active || p.id === job.leaderId));
  const leaderClash = leaderConflicts(ds, form.leaderId, form.start, form.projectedFinish, job.id);
  const others = ds.jobs.filter((o) => o.id !== job.id && o.active && o.status !== "complete").sort((a, b) => a.number.localeCompare(b.number));
  const repName = ds.reps.find((r) => r.code === job.repCode)?.name ?? job.repCode;
  const pmName = ds.pms.find((r) => r.code === job.pmCode)?.name ?? job.pmCode;
  const notes = ds.notes.filter((n) => n.jobId === job.id).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt));
  const actuals = ds.actuals.filter((a) => a.jobId === job.id).sort((a, b) => a.week.localeCompare(b.week));

  const crewEdit = ed("crew");
  const assigned = crewWeek ? assignedIds(ds, job.id, crewWeek) : [];
  const issues = crewWeek ? crewIssues(ds, idx, [crewWeek]).filter((i) => i.job.id === job.id) : [];
  const busy = new Set(crewWeek ? ds.assignments.filter((a) => a.week === crewWeek && a.jobId !== job.id).map((a) => a.personId) : []);
  const addable = crewWeek
    ? ds.people
        .filter((p) => p.active && p.kind !== "leadership" && !assigned.includes(p.id) && !busy.has(p.id) && offFraction(idx, p, crewWeek) === 0)
        .sort((a, b) => missingQuals(a, job, crewWeek).length - missingQuals(b, job, crewWeek).length || a.name.localeCompare(b.name))
    : [];

  const field = (label: string, g: JobField, input: React.ReactNode) => (
    <label className="field">
      {label}
      {input}
      {!ed(g) && <span className="sr">(read only)</span>}
    </label>
  );

  return (
    <Modal
      title={`${job.number} ${job.customer}`}
      sub={
        <>
          {job.jobType}, {job.location}
          {job.exterior ? ", exterior" : ""}. Rep {repName}, PM {pmName}, estimator {job.estimator}.{" "}
          {can.seeMoney(viewer.role) ? (
            <>
              Contract {usd(job.contractCents)}. Estimate: {n0(job.estimateHrs)} hrs, {usd(job.materialCostCents)} materials,{" "}
              {pct(bidMargin(job.contractCents, job.materialCostCents, job.estimateHrs, job.burdenedRateCents))} GP
              {job.status !== "complete" ? `; now ${pct(new Money(ds, idx, week, todayIn(new Date())).gpNow(job))} GP` : ""}. Materials revenue {usd(job.materialRevenueCents)}, labor{" "}
              {usd(job.contractCents - job.materialRevenueCents)}.
            </>
          ) : (
            <>Estimate: {n0(job.estimateHrs)} hrs.</>
          )}
          {job.retainagePct > 0 &&
            ` Retainage ${job.retainagePct}%, released at ${job.retainageRelease === "substantial_completion" ? "substantial completion" : job.retainageRelease === "final_completion" ? "final completion" : job.retainageReleaseNote || "terms in contract"}.`}
        </>
      }
      onClose={onClose}
      footer={
        <>
          {problem && <span className="err-text" role="alert" style={{ marginRight: "auto" }}>{problem}</span>}
          <button className="btn sec" onClick={onClose}>
            {anyEdit ? "Cancel" : "Close"}
          </button>
          {anyEdit && (
            <button className="btn" onClick={save}>
              Save changes
            </button>
          )}
        </>
      }
    >
      <BillingPanel ctx={ctx} job={job} open={billingOpen} />
      <JourneyPanel ctx={ctx} job={job} open={journeyOpen} />
      <WorkOrderPanel ctx={ctx} job={job} />
      <div className="stat">
        <div>
          Actual to date<b className="num">{n0(act)}</b>
        </div>
        <div>
          Hours left<b className="num" style={left < 0 ? { color: "var(--red)" } : undefined}>{n0(left)}</b>
        </div>
        <div>
          On pace to finish at<b className="num" style={isOverrun(idx, job, ds.settings) ? { color: "var(--red)" } : undefined}>{n0(e)}</b>
        </div>
        <div>
          vs. estimate
          <b className="num">
            {job.projectedHrs >= job.estimateHrs ? "+" : "−"}
            {n0(Math.abs(job.projectedHrs - job.estimateHrs))}
          </b>
        </div>
      </div>
      <div className="note">Hours used {pct(act / Math.max(1, job.projectedHrs))}</div>
      <div className="meter">
        <i className={used > elapsed + 0.1 ? "r" : ""} style={{ width: Math.min(100, used * 100) + "%" }} />
      </div>
      <div className="note">Schedule elapsed {pct(elapsed)}</div>
      <div className="meter">
        <i style={{ width: elapsed * 100 + "%", opacity: 0.5 }} />
      </div>

      {can.seeMoney(viewer.role) && job.status !== "complete" && (() => {
        const m = new Money(ds, idx, week, todayIn(new Date()));
        return (
          <>
            <div className="stat" style={{ marginTop: 14 }}>
              <div>
                Materials complete<b className="num">{pct(m.matDone(job))}</b>
              </div>
              <div>
                Labor complete<b className="num" style={m.diverges(job) ? { color: "var(--red)" } : undefined}>{pct(m.labDone(job))}</b>
              </div>
              <div>
                Recognized<b className="num">{usd(m.recognized(job))}</b>
              </div>
              <div>
                Over (under) billed<b className="num">{m.overUnder(job) < 0 ? `(${usd(-m.overUnder(job))})` : usd(m.overUnder(job))}</b>
              </div>
            </div>
            <p className="note" style={{ marginTop: -6 }}>Hours suggest labor is {pct(m.suggestLabor(job))} complete. Update percentages on the Revenue tab.</p>
          </>
        );
      })()}
      <div className="fg" style={{ marginTop: 14 }}>
        {field(
          "Status",
          "status",
          <select
            value={form.status}
            disabled={!ed("status")}
            onChange={(e) => {
              const status = e.target.value as Job["status"];
              // Marking a job complete fills in the actual finish, as in the demo.
              setForm({ ...form, status, actualFinish: status === "complete" && !form.actualFinish && ed("actualFinish") ? todayIn(new Date()) : form.actualFinish });
            }}
          >
            {STATUS.map((s) => (
              <option key={s.k} value={s.k}>
                {s.l}
              </option>
            ))}
          </select>,
        )}
        {field(
          "Date firmness",
          "firmness",
          <select value={form.firmness} disabled={!ed("firmness")} onChange={(e) => set("firmness", e.target.value as Job["firmness"])}>
            {FIRMNESS.map((x) => (
              <option key={x.key} value={x.key} title={x.description}>
                {x.label}
              </option>
            ))}
          </select>,
        )}
        {field(
          "Can’t start until this job finishes",
          "firmness",
          <select value={form.waitsOnJobId ?? ""} disabled={!ed("firmness") || form.firmness !== "waiting"} onChange={(e) => set("waitsOnJobId", e.target.value || null)}>
            <option value="">None</option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.number} {o.customer}
              </option>
            ))}
          </select>,
        )}
        {field(
          job.firmness === "locked" ? "Reason for leaving Locked" : "Reason for the firmness change",
          "firmness",
          <input
            value={form.firmnessReason ?? ""}
            disabled={!ed("firmness")}
            placeholder={job.firmness === "locked" ? "Required when moving off Locked" : "Optional; goes in the notes"}
            onChange={(e) => set("firmnessReason", e.target.value)}
          />,
        )}
        {field(
          "On hold: reason",
          "status",
          <input value={form.holdReason ?? ""} disabled={!ed("status") || form.status !== "on_hold"} placeholder="Required when on hold" onChange={(e) => set("holdReason", e.target.value)} />,
        )}
        {field(
          "On hold: expected restart",
          "status",
          <input type="date" value={form.holdUntil ?? ""} disabled={!ed("status") || form.status !== "on_hold"} onChange={(e) => set("holdUntil", e.target.value || null)} />,
        )}
        {field(
          "Job leader",
          "leaderId",
          <select value={form.leaderId ?? ""} disabled={!ed("leaderId")} onChange={(e) => set("leaderId", e.target.value || null)}>
            <option value="">None</option>
            {leaders.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>,
        )}
        {ed("leaderId") && leaderClash.length > 0 && (
          <p className="err-text" role="status" style={{ gridColumn: "1 / -1", margin: 0 }}>
            {leaders.find((p) => p.id === form.leaderId)?.name} already leads {leaderClash.map((o) => `${o.number} ${o.customer} (${fmtShort(o.start)}–${fmtShort(o.projectedFinish)})`).join(", ")}.
          </p>
        )}
        {field(
          "Crew size",
          "crewSize",
          <input type="number" min={1} max={40} value={form.crewSize} disabled={!ed("crewSize")} onChange={(e) => set("crewSize", Math.max(1, Number(e.target.value) || 1))} />,
        )}
        {field(
          "Projected hrs",
          "projectedHrs",
          <input type="number" min={0} step={10} value={form.projectedHrs} disabled={!ed("projectedHrs")} onChange={(e) => set("projectedHrs", Math.max(0, Number(e.target.value) || 0))} />,
        )}
        {field("Start", "start", <input type="date" value={form.start} disabled={!ed("start")} onChange={(e) => set("start", e.target.value || job.start)} />)}
        {field(
          "Projected finish",
          "projectedFinish",
          <input type="date" value={form.projectedFinish} disabled={!ed("projectedFinish")} onChange={(e) => set("projectedFinish", e.target.value || job.projectedFinish)} />,
        )}
        {field("Actual finish", "actualFinish", <input
            type="date"
            value={form.actualFinish ?? ""}
            disabled={!ed("actualFinish")}
            onChange={(e) => {
              const actualFinish = e.target.value || null;
              // An actual finish means the job is complete.
              setForm({ ...form, actualFinish, status: actualFinish && ed("status") ? "complete" : form.status });
            }}
          />)}
        {field(
          "Must finish (shutdown or contract only)",
          "mustFinish",
          <input type="date" value={form.mustFinish ?? ""} disabled={!ed("mustFinish")} onChange={(e) => set("mustFinish", e.target.value || null)} />,
        )}
        {field(
          "Deadline type",
          "mustFinish",
          <select value={form.mustFinishReason ?? ""} disabled={!ed("mustFinish")} onChange={(e) => set("mustFinishReason", (e.target.value || null) as Job["mustFinishReason"])}>
            <option value="">None</option>
            <option value="shutdown">Shutdown</option>
            <option value="contract">Contract obligation</option>
          </select>,
        )}
      </div>
      <p className="note" style={{ marginTop: 8 }}>
        Baseline finish {fmtLong(job.baselineFinish)}. Dates, crew and status changes are logged with your name.
      </p>

      {ed("intake") && (
        <details className="panel" style={{ marginTop: 12 }}>
          <summary>
            <b>Job details from intake</b> <span className="q">Correct the customer, people, contract terms and requirements. The estimate’s dollars and hours stay as bid.</span>
          </summary>
          <div className="fg" style={{ marginTop: 10 }}>
            {field("Job number", "intake", <input value={form.number} inputMode="numeric" maxLength={4} onChange={(e) => set("number", e.target.value.trim())} />)}
            {field("Customer", "intake", <input value={form.customer} onChange={(e) => set("customer", e.target.value)} />)}
            {field("Job type", "intake", <input value={form.jobType} onChange={(e) => set("jobType", e.target.value)} />)}
            {field("Location", "intake", <input value={form.location} onChange={(e) => set("location", e.target.value)} />)}
            {field(
              "Sales rep",
              "intake",
              <select value={form.repCode} onChange={(e) => set("repCode", e.target.value)}>
                {ds.reps.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.name}
                  </option>
                ))}
              </select>,
            )}
            {field(
              "Project manager",
              "intake",
              <select value={form.pmCode} onChange={(e) => set("pmCode", e.target.value)}>
                {ds.pms.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.name}
                  </option>
                ))}
              </select>,
            )}
            {field(
              "Estimator",
              "intake",
              <select value={form.estimator} onChange={(e) => set("estimator", e.target.value)}>
                {[...new Set([form.estimator, ...ds.staff.estimators])].filter(Boolean).map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>,
            )}
            {field("Customer PO", "intake", <input value={form.customerPo} onChange={(e) => set("customerPo", e.target.value)} />)}
            {field("Bill to", "intake", <input value={form.billTo} onChange={(e) => set("billTo", e.target.value)} />)}
            {field("Retainage %", "intake", <input value={form.retainagePct} inputMode="decimal" onChange={(e) => set("retainagePct", Number(e.target.value) || 0)} />)}
            {field(
              "Retainage released at",
              "intake",
              <select value={form.retainageRelease ?? ""} onChange={(e) => set("retainageRelease", (e.target.value || null) as Job["retainageRelease"])}>
                <option value="">No retainage</option>
                <option value="substantial_completion">Substantial completion</option>
                <option value="final_completion">Final completion</option>
                <option value="other">Other (note)</option>
              </select>,
            )}
            {form.retainageRelease === "other" && field("Release terms", "intake", <input value={form.retainageReleaseNote ?? ""} onChange={(e) => set("retainageReleaseNote", e.target.value || null)} />)}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <label className="q">
              <input type="checkbox" checked={form.exterior} onChange={(e) => set("exterior", e.target.checked)} /> Exterior work
            </label>
            <label className="q">
              <input type="checkbox" checked={form.lienWaivers} onChange={(e) => set("lienWaivers", e.target.checked)} /> Lien waivers
            </label>
            <label className="q">
              <input type="checkbox" checked={form.certifiedPayroll} onChange={(e) => set("certifiedPayroll", e.target.checked)} /> Certified payroll
            </label>
            {ds.qualifications.map((q) => (
              <label className="q" key={q}>
                <input type="checkbox" checked={form.requirements.includes(q)} onChange={(e) => set("requirements", e.target.checked ? [...form.requirements, q] : form.requirements.filter((x) => x !== q))} /> Needs{" "}
                {q.toLowerCase()}
              </label>
            ))}
          </div>
          <p className="note">Changes to the rep, PM or estimator move this job’s open work order and journey steps to the new person.</p>
        </details>
      )}

      <h2 style={{ fontSize: 15, margin: "18px 0 8px" }}>Notes</h2>
      {notes.length ? (
        <ul className="att">
          {notes.map((n) => (
            <li key={n.id}>
              <span className={"tag" + (n.pinned ? " yel" : "")}>{n.pinned ? "Pinned" : "Note"}</span>
              <span>
                {n.text}
                <br />
                <span className="q">
                  {n.author}, {stamp(n.createdAt)}.{n.crewVisible ? " Crew can see this." : ""}
                </span>
                {ed("pinNotes") && (
                  <>
                    {" "}
                    <button className="jl" onClick={() => run(() => repo.setNotePinned(n.id, !n.pinned))}>
                      {n.pinned ? "Unpin" : "Pin"}
                    </button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="note">No notes yet.</p>
      )}
      {ed("notes") && (
        <>
          <div className="field" style={{ marginTop: 8 }}>
            <textarea
              rows={2}
              value={note.text}
              placeholder="Gate codes, customer requests, safety issues, anything the next person needs to know"
              aria-label="New note"
              onChange={(e) => setNote({ ...note, text: e.target.value })}
            />
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            {ed("pinNotes") && (
              <label className="q">
                <input type="checkbox" checked={note.pinned} onChange={(e) => setNote({ ...note, pinned: e.target.checked })} /> Pin as important
              </label>
            )}
            <label className="q">
              <input type="checkbox" checked={note.crew} onChange={(e) => setNote({ ...note, crew: e.target.checked })} /> Crew can see it
            </label>
            <button
              className="btn sec"
              disabled={!note.text.trim()}
              onClick={async () => {
                if (await run(() => repo.addNote(job.id, note.text.trim(), note.pinned, note.crew), "Note added.")) setNote({ text: "", pinned: false, crew: false });
              }}
            >
              Add note
            </button>
          </div>
        </>
      )}

      <h2 style={{ fontSize: 15, margin: "18px 0 8px" }}>Site details for the crew</h2>
      <div className="fg">
        {(
          [
            ["siteAddress", "Site address"],
            ["siteStartTime", "Start time"],
            ["siteContact", "Site contact"],
            ["siteOrientation", "Orientation or badging"],
            ["sitePpe", "PPE and permits"],
          ] as const
        ).map(([k, l]) => (
          <label className="field" key={k}>
            {l}
            <input value={form[k]} disabled={!ed("site")} onChange={(e) => set(k, e.target.value)} />
          </label>
        ))}
      </div>

      <h2 style={{ fontSize: 15, margin: "18px 0 8px" }}>Crew</h2>
      {!crewWeek ? (
        <p className="note">No weeks left on this job.</p>
      ) : (
        <>
          <div className="row" style={{ marginBottom: 8 }}>
            <label className="field">
              Week ending
              <select value={crewWeek} onChange={(e) => { setCrewWeek(e.target.value); setProposal(null); }}>
                {crewWeeks.map((w) => (
                  <option key={w} value={w}>
                    {fmtShort(w)}
                  </option>
                ))}
              </select>
            </label>
            <span className="note">
              {assigned.length} of {job.crewSize} assigned.{job.requirements.length ? " Requires " + job.requirements.join(" and ") + "." : ""}
              {ds.confirmations.some((c) => c.jobId === job.id && c.week === crewWeek) ? " Confirmed by leader." : ""}
            </span>
          </div>
          <ul className="crewl">
            {assigned.map((pid) => {
              const p = ds.people.find((x) => x.id === pid);
              if (!p) return null;
              const pi = issues.filter((i) => i.person?.id === pid);
              return (
                <li key={pid}>
                  <span className="nm">{p.name}</span>
                  <span className="q">
                    {p.kind === "leader" ? "Leader. " : ""}
                    {Object.keys(p.quals).join(", ") || "No quals"}
                  </span>
                  {pi.map((i, k) => (
                    <span key={k} className={"tag " + (i.kind === "double" || i.kind === "off" ? "red" : "yel")}>
                      {CREW_ISSUE_LABEL[i.kind]}
                      {i.kind === "qual" ? ": " + i.missing!.join(", ") : ""}
                      {i.kind === "double" ? ": " + i.otherJob!.customer : ""}
                    </span>
                  ))}
                  {crewEdit && (
                    <button className="jl" style={{ marginLeft: "auto" }} onClick={() => run(() => repo.unassign(job.id, pid, crewWeek))}>
                      Remove
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {crewEdit && (
            <div className="row" style={{ marginTop: 10 }}>
              <label className="field">
                Add a person
                <select value={addPerson} onChange={(e) => setAddPerson(e.target.value)}>
                  <option value="">Select…</option>
                  {addable.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {missingQuals(p, job, crewWeek).length ? " (not qualified)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="btn sec"
                disabled={!addPerson}
                onClick={async () => {
                  if (await run(() => repo.assign(job.id, addPerson, crewWeek))) setAddPerson("");
                }}
              >
                Add
              </button>
              <button className="btn sec" disabled={assigned.length >= job.crewSize} onClick={() => setProposal(proposeCrew(ds, idx, job, crewWeek))}>
                Fill to crew size
              </button>
            </div>
          )}
          {crewEdit && proposal && (
            <div className="wobox" style={{ marginTop: 10 }} role="region" aria-label="Proposed crew">
              {proposal.length ? (
                <>
                  <b>Proposed for week ending {fmtShort(crewWeek)}:</b>{" "}
                  {proposal.map((id) => ds.people.find((p) => p.id === id)?.name).join(", ")}.
                  <p className="note" style={{ margin: "4px 0 8px" }}>
                    Leader first, then last week’s crew, then qualified people who are free. Nothing is assigned until you accept.
                  </p>
                  <div className="row">
                    <button
                      className="btn"
                      onClick={async () => {
                        const ids = proposal;
                        if (await run(async () => { for (const id of ids) await repo.assign(job.id, id, crewWeek); }, `${ids.length} added to the crew.`)) setProposal(null);
                      }}
                    >
                      Add these {proposal.length}
                    </button>
                    <button className="btn sec" onClick={() => setProposal(null)}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  Nobody suitable is free that week.{" "}
                  <button className="jl" onClick={() => setProposal(null)}>
                    OK
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}

      <div className="grid2" style={{ marginTop: 14 }}>
        <div>
          <h2 style={{ marginTop: 0, fontSize: 15 }}>Actual hours by week</h2>
          {actuals.length ? (
            <div className="scroll">
              <table>
                <tbody>
                  {actuals.map((a) => (
                    <tr key={a.week}>
                      <td>{fmtShort(a.week)}</td>
                      <td className="r num">{n0(a.hours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="note">Not started.</p>
          )}
        </div>
        <div>
          <h2 style={{ marginTop: 0, fontSize: 15 }}>Changes</h2>
          {log === null ? (
            <p className="note">Loading…</p>
          ) : log.length ? (
            <ul className="att">
              {log.slice(0, 12).map((c) => (
                <li key={c.id}>
                  <span className="tag">{stamp(c.at)}</span>
                  <span>
                    {c.who}: {describeChange(c, ds)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="note">No changes yet.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
