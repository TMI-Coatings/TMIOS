import { AUTO_LABEL, canCheck, dueDate, ownerName } from "../domain/journey";
import type { Job } from "../domain/types";
import { journeyOf, namesOf } from "../domain/views";
import { fmtShort, todayIn } from "../domain/weeks";
import { stamp } from "../format";
import type { Ctx } from "../Workspace";

/** The job's journey in the job window: the stage line and every checkpoint with its owner and due date. */
export function JourneyPanel({ ctx, job, open }: { ctx: Ctx; job: Job; open?: boolean }) {
  const { viewer, data, repo, run } = ctx;
  const ds = data.ds;
  const jy = journeyOf(ds, todayIn(new Date()));
  const n = namesOf(ds);
  const si = jy.stageOf(job);
  const late = jy.lateList(job);
  return (
    <details className="wobox" open={open}>
      <summary>
        Job journey: {si >= jy.stages.length ? "complete" : jy.stages[si].label.toLowerCase()}
        {late.length > 0 && <span style={{ color: "var(--red)" }}>, {late.length} overdue</span>}
      </summary>
      <ol className="jyline" aria-label="Job journey stages">
        {jy.stages.map((st, i) => {
          const items = jy.defs.filter((c) => c.stageKey === st.key);
          const cls = items.some((c) => jy.isLate(job, c)) ? "late" : items.every((c) => jy.isDone(job, c)) ? "done" : i === si ? "cur" : "";
          return (
            <li key={st.key} className={cls}>
              {st.label}
            </li>
          );
        })}
      </ol>
      <ul className="jylist">
        {jy.stages.map((st) => [
          <li key={st.key} className="sh">
            {st.label}
          </li>,
          ...jy.defs
            .filter((c) => c.stageKey === st.key)
            .map((c) => {
              const done = jy.isDone(job, c);
              const mark = jy.mark(job, c);
              return (
                <li key={c.key}>
                  <span>
                    {c.label}
                    <span className="q">
                      {ownerName(job, c, n)}.{" "}
                      {done ? (
                        <span className="ok">Done{mark ? ` by ${mark.by}, ${stamp(mark.at)}` : c.autoSource ? `, from the ${AUTO_LABEL[c.autoSource]}` : ""}</span>
                      ) : jy.isLate(job, c) ? (
                        <span className="lt">
                          {jy.daysLate(job, c)} days late, was due {fmtShort(dueDate(job, c))}
                        </span>
                      ) : (
                        `Due ${fmtShort(dueDate(job, c))}`
                      )}
                    </span>
                  </span>
                  {canCheck(viewer, c, true) && (
                    <button className="btn sec" onClick={() => run(() => repo.setCheckpoint(job.id, c.key, !done), done ? "Reopened." : "Marked done.")}>
                      {done ? "Undo" : "Mark done"}
                    </button>
                  )}
                </li>
              );
            }),
        ])}
      </ul>
    </details>
  );
}
