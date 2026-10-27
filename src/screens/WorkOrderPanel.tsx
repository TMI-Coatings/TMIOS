import { useState } from "react";
import type { Job } from "../domain/types";
import { namesOf } from "../domain/views";
import { stepLabel, stepWho, WO_STEPS, WO_TAG, woCanFile, woCanSign, woCanUpload, woDaysWaiting, woIsMine, woLate, woStatus, woWaiting } from "../domain/workOrders";
import { todayIn } from "../domain/weeks";
import { stamp } from "../format";
import type { Ctx } from "../Workspace";

/** The work order box in the job window: status, the four sign-offs, and the next action for this person. */
export function WorkOrderPanel({ ctx, job }: { ctx: Ctx; job: Job }) {
  const { viewer, data, repo, run } = ctx;
  const ds = data.ds;
  const w = ds.workOrders.find((x) => x.jobId === job.id);
  const [comment, setComment] = useState("");
  const [file, setFile] = useState<File | null>(null);
  if (!w) return null;
  const n = namesOf(ds);
  const today = todayIn(new Date());
  const s = woStatus(w);
  const due = ds.settings.woReviewDays;
  const days = woDaysWaiting(w, today);
  const late = woLate(job, w, today, due);
  const sign = woCanSign(viewer, job, w);
  const stateLine =
    s === "Final" ? (w.filed ? "Filed in Procore." : "Waiting on Lori to file it in Procore.") : `Waiting on ${woWaiting(job, w, n)}, ${days} day${days === 1 ? "" : "s"}${late ? "" : "."}`;

  return (
    <div className="wobox" aria-label="Work order">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <b style={{ fontSize: 15 }}>Work order</b>
        <span className={"tag " + WO_TAG[s]}>{s === "Final" ? "Work order final" : "Work order: " + s.toLowerCase()}</span>
      </div>
      <p className="note" style={{ margin: "6px 0 10px" }}>
        {w.fileName ? `${w.final ? "Final" : "Draft"} ${w.fileName}${w.version > 1 ? ` (version ${w.version})` : ""}. ` : "No draft yet. "}
        {stateLine}
        {late && <b style={{ color: "var(--red)" }}>, past the {due}-day deadline.</b>} The job stays booked on the schedule either way.
        {w.filePath && (
          <>
            {" "}
            <button className="jl" onClick={() => repo.woFileUrl(job.id).then((u) => u && window.open(u, "_blank", "noopener"))}>
              Open the draft
            </button>
          </>
        )}
      </p>
      {w.returned && (
        <ul className="att" style={{ margin: "0 0 10px" }}>
          <li>
            <span className="tag red">Sent back</span>
            <span>
              At the {w.returned.role === "PM" ? "PM" : w.returned.role.toLowerCase()} step, {w.returned.by}: {w.returned.comment}
            </span>
          </li>
        </ul>
      )}
      <ol className="chain">
        {WO_STEPS.map((d, i) => {
          const signed = w.signoffs.find((x) => x.step === i);
          const cls = w.final || i < w.currentStep ? "done" : i === w.currentStep && w.fileName && !w.returned ? "cur" : "";
          return (
            <li key={i} className={cls}>
              <b>{d.role}</b>
              <span>{stepWho(job, i, n)}</span>
              <span>{d.what}</span>
              <span>{signed ? `Signed off ${stamp(signed.at)}` : cls === "cur" ? `Waiting, day ${days} of ${due}` : "Pending"}</span>
            </li>
          );
        })}
      </ol>
      {woCanUpload(viewer, w) && (
        <div className="row" style={{ marginTop: 10 }}>
          <label className="field">
            Draft from Claude (PDF or Word)
            <input type="file" accept=".pdf,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <button
            className="btn"
            onClick={() => {
              const name = file?.name ?? `WO-${job.number}-draft-v${w.version + 1}.pdf`;
              if (repo.mode === "live" && !file) return void run(() => Promise.reject(new Error("Choose the draft file.")));
              void run(() => repo.woUpload(job.id, file, name), "Draft uploaded. The estimator is up first.");
            }}
          >
            {w.returned ? "Upload revised draft" : "Upload draft"}
          </button>
          {repo.mode === "sample" && <span className="note">Sample mode keeps only the file name. No file handy? Upload with nothing chosen.</span>}
        </div>
      )}
      {sign && (
        <>
          <div className="field" style={{ marginTop: 10 }}>
            <textarea rows={2} value={comment} placeholder="Comment, required to send it back" aria-label="Work order comment" onChange={(e) => setComment(e.target.value)} />
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <button className="btn" onClick={() => run(() => repo.woApprove(job.id), "Signed off.")}>
              Sign off: {WO_STEPS[w.currentStep].what.toLowerCase()}
            </button>
            <button
              className="btn sec"
              onClick={async () => {
                if (await run(() => repo.woReturn(job.id, comment), "Sent back to Lori.")) setComment("");
              }}
            >
              Send back to Lori
            </button>
            {!woIsMine(viewer, job, w.currentStep) && <span className="note">Acting for {stepLabel(job, w.currentStep, n)}. Logged under your name.</span>}
          </div>
        </>
      )}
      {woCanFile(viewer, w) && (
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => run(() => repo.woMarkFiled(job.id), "Marked filed in Procore.")}>
            Mark filed in Procore
          </button>
          <span className="note">TMI Ops reads Procore and never writes to it, so Lori files the final there.</span>
        </div>
      )}
      {w.history.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary className="note">Work order history ({w.history.length})</summary>
          <ul className="att" style={{ marginTop: 6 }}>
            {w.history.slice(0, 12).map((h, i) => (
              <li key={i}>
                <span className="tag">{stamp(h.at)}</span>
                <span>
                  {h.who}: {h.action}
                  {h.note && (
                    <>
                      <br />
                      <span className="q">“{h.note}”</span>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
