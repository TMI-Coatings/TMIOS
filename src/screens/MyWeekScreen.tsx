import { useEffect, useState } from "react";
import { friendlyError } from "../data/repo";
import type { IsoDate, MyWeek } from "../domain/types";
import { daysBetween, fmtLong, fmtShort } from "../domain/weeks";
import type { Ctx } from "../Workspace";

const day = (s: IsoDate) => new Date(s + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const maps = (a: string) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(a);

/** The phone screen: where you're going, when, and what to bring, this week and next. */
export function MyWeekScreen({ ctx }: { ctx: Ctx }) {
  const { repo, run, data, week } = ctx;
  const [me, setMe] = useState<MyWeek | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    repo.myWeek().then(setMe, (e) => setError(friendlyError(e)));
  }, [repo, data]);

  if (error) return <p role="alert">{error}</p>;
  if (me === undefined) return <p className="note">Loading…</p>;
  if (me === null)
    return (
      <>
        <h1>My week</h1>
        <p className="lead">This sign-in isn’t linked to a person on the roster. Ask an admin to link it on the Access screen.</p>
      </>
    );

  const certs: [string, IsoDate | null][] = [...(me.person.driver ? [["DOT physical", me.person.dotExpires] as [string, IsoDate | null]] : []), ...me.certs.map((c) => [c.name, c.expires] as [string, IsoDate | null])];
  const status = (exp: IsoDate | null) => {
    if (!exp) return null;
    const d = daysBetween(week, exp);
    return d < 0 ? <span className="tag red">Expired</span> : d <= 60 ? <span className="tag yel">{d} days left</span> : <span className="tag grn">Current</span>;
  };

  return (
    <>
      <h1>{me.person.name.split(" ")[0]}’s week</h1>
      <p className="lead">Where you’re going, when, and what to bring. Tap Got it so the scheduler knows you’ve seen it.</p>
      {me.weeks.map((wk, i) => (
        <section key={wk.week}>
          <h2>
            {i === 0 ? "This week" : "Next week"}, week ending {fmtShort(wk.week)}
          </h2>
          {wk.timeOff.length > 0 && (
            <div className="banner" style={{ borderLeftColor: "var(--yellow)" }}>
              Time off: {wk.timeOff.map((t) => `${fmtShort(t.firstDay)}–${fmtShort(t.lastDay)} (${t.type})`).join(", ")}.
            </div>
          )}
          {wk.jobs.length === 0 && <p className="note">No job assigned yet. Your leader or the office will post it here.</p>}
          {wk.jobs.map((j) => (
            <div className="panel" style={{ marginBottom: 10 }} key={j.number}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{j.customer}</div>
              <div className="note">
                {j.jobType}. Job {j.number}.
              </div>
              <ul className="att" style={{ marginTop: 8 }}>
                <li>
                  <span className="tag blue">When</span>
                  <span>
                    {day(j.from)}
                    {j.from !== j.to ? " to " + day(j.to) : ""}, start {j.siteStartTime || "6:30 AM"}
                  </span>
                </li>
                <li>
                  <span className="tag blue">Where</span>
                  <span>
                    {j.siteAddress || j.location}
                    <br />
                    <a className="jl" href={maps(j.siteAddress || j.location)} target="_blank" rel="noopener noreferrer">
                      Open in Maps
                    </a>
                  </span>
                </li>
                <li>
                  <span className="tag blue">Leader</span>
                  <span>
                    {j.leader ?? "To be named"}
                    {j.leaderPhone && (
                      <>
                        , <a className="jl" href={"tel:" + j.leaderPhone}>{j.leaderPhone}</a>
                      </>
                    )}
                  </span>
                </li>
                <li>
                  <span className="tag">Site contact</span>
                  <span>{j.siteContact || "Ask your leader"}</span>
                </li>
                <li>
                  <span className="tag">On arrival</span>
                  <span>{j.siteOrientation || "None"}</span>
                </li>
                <li>
                  <span className="tag yel">PPE</span>
                  <span>{j.sitePpe || "Hard hat, safety glasses, steel toes"}</span>
                </li>
                {j.notes.map((n, k) => (
                  <li key={k}>
                    <span className="tag red">Note</span>
                    <span>{n}</span>
                  </li>
                ))}
                <li>
                  <span className="tag">Crew</span>
                  <span>{j.crew.join(", ")}</span>
                </li>
              </ul>
            </div>
          ))}
          {wk.jobs.length > 0 &&
            (wk.acknowledged ? (
              <p className="note" style={{ color: "var(--green)" }}>
                You acknowledged this week ({wk.acknowledged}).
              </p>
            ) : (
              <button className="btn" onClick={() => run(() => repo.acknowledgeWeek(wk.week), "Thanks. The office can see you’ve got it.").then(() => repo.myWeek().then(setMe))}>
                Got it
              </button>
            ))}
        </section>
      ))}
      <h2>My certifications</h2>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Certification</th>
              <th>Expires</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {certs.length ? (
              certs.map(([n, e]) => (
                <tr key={n}>
                  <td>{n}</td>
                  <td>{e ? fmtLong(e) : "No date"}</td>
                  <td>{status(e)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={3} className="note">
                  No certifications on file. See the scheduler.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="note">The scheduler keeps these current. Reminders go out at {data.ds.settings.certFirstDays} and {data.ds.settings.certSecondDays} days.</p>
    </>
  );
}
