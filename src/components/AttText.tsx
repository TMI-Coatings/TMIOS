import type { Job } from "../domain/types";

/** Text with {job:<id>} markers, the markers drawn as links that open the job. */
export function AttText({ text, jobs, onJob }: { text: string; jobs: Job[]; onJob: (id: string) => void }) {
  const parts = text.split(/(\{job:[^}]+\})/);
  return (
    <span>
      {parts.map((p, i) => {
        const m = p.match(/^\{job:(.+)\}$/);
        if (!m) return <span key={i}>{p}</span>;
        const j = jobs.find((x) => x.id === m[1]);
        return j ? (
          <button key={i} className="jl" onClick={() => onJob(j.id)}>
            {j.number} {j.customer}
          </button>
        ) : (
          <span key={i}>a job you can’t open</span>
        );
      })}
    </span>
  );
}
