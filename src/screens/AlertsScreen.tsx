import { useEffect, useState } from "react";
import { friendlyError } from "../data/repo";
import { digestLines, digestTitle } from "../domain/insights";
import { can } from "../domain/permissions";
import { allPlans, buildIndex } from "../domain/schedule";
import { ALERT_RULES, type Alert, type AlertRule } from "../domain/types";
import { stamp } from "../format";
import type { Ctx } from "../Workspace";
import { JobDialog } from "./JobDialog";

const BORDER: Partial<Record<AlertRule, string>> = { overrun: "r-overrun", gap: "r-gap", date: "r-date", digest: "r-digest" };

/** What would post to the leadership Teams channel, with email as backup, filtered to what reaches you. */
export function AlertsScreen({ ctx }: { ctx: Ctx }) {
  const { viewer, data, repo, run, week } = ctx;
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [muted, setMuted] = useState<AlertRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openJob, setOpenJob] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([repo.alerts(), repo.mutedRules()]).then(
      ([a, m]) => {
        setAlerts(a);
        setMuted(m);
      },
      (e) => setError(friendlyError(e)),
    );
  }, [repo, data]);

  const field = viewer.role === "field_crew" || viewer.role === "superintendent";
  const shown = (alerts ?? []).filter((a) => !muted.includes(a.rule));
  const sendDigest = () => {
    const ds = data.ds;
    const idx = buildIndex(ds);
    void run(() => repo.postDigest(digestTitle(week), digestLines(ds, idx, allPlans(ds, idx, week), week).join("\n")), "Digest posted.");
  };

  return (
    <>
      <h1>Alerts</h1>
      <p className="lead">
        {field
          ? "Notices that reach you: certification reminders, and changes to jobs you’re on."
          : "What posts to the leadership Teams channel, with email as backup. Each person chooses which rules reach them. Every change anyone makes is on the Change log."}
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="grid2" style={{ gridTemplateColumns: "3fr 2fr" }}>
        <div>
          <h2 style={{ marginTop: 0 }}>{field ? "Your messages" : "Teams channel"}</h2>
          <div className="feed">
            {alerts === null ? (
              <p className="note">Loading…</p>
            ) : shown.length ? (
              shown.slice(0, 60).map((a) => (
                <div key={a.id} className={"card " + (BORDER[a.rule] ?? "")}>
                  <div className="h">
                    <span className="t">{a.title}</span>
                    <span className="when">{stamp(a.at)}</span>
                  </div>
                  <div className="b">{a.body}</div>
                  <div className="to">
                    {ALERT_RULES.find((r) => r.id === a.rule)?.name} to {a.recipients.join(", ")}
                    {a.jobId && data.ds.jobs.some((j) => j.id === a.jobId) && (
                      <>
                        {" · "}
                        <button className="jl" onClick={() => setOpenJob(a.jobId)}>
                          Open job
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <p className="note">No alerts yet. Move a job’s dates on the Schedule or close a week to see them arrive.</p>
            )}
          </div>
        </div>
        <div>
          <h2 style={{ marginTop: 0 }}>Rules that reach you</h2>
          <div className="panel">
            {ALERT_RULES.map((r) => (
              <label className="toggle" key={r.id}>
                <span>
                  <b>{r.name}</b>
                  <br />
                  <span className="note">{r.desc}</span>
                </span>
                <input
                  type="checkbox"
                  aria-label={`${r.name} alerts on`}
                  checked={!muted.includes(r.id)}
                  onChange={(e) => {
                    const m = e.target.checked ? muted.filter((x) => x !== r.id) : [...muted, r.id];
                    setMuted(m);
                    void run(() => repo.setMuted(r.id, !e.target.checked));
                  }}
                />
              </label>
            ))}
          </div>
          {can.sendDigest(viewer.role) && (
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn sec" onClick={sendDigest}>
                Send Monday digest now
              </button>
            </div>
          )}
          <p className="note">Delivery to Teams and email starts once Veracity approves those connections. Until then alerts show here.</p>
        </div>
      </div>
      {openJob && <JobDialog ctx={ctx} jobId={openJob} onClose={() => setOpenJob(null)} />}
    </>
  );
}
