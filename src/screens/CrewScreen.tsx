import { useMemo, useState } from "react";
import { assignedIds, proposeWeek } from "../domain/crew";
import { can } from "../domain/permissions";
import { allPlans, availableMen, buildIndex, isSold, leadersNeeded } from "../domain/schedule";
import type { Person, TimeOffType } from "../domain/types";
import { addDays, fmtLong, fmtShort, mondayOf, weekList } from "../domain/weeks";
import { n1 } from "../format";
import type { Ctx } from "../Workspace";

const TYPES: TimeOffType[] = ["PTO", "Holiday", "Hunting", "Medical", "Other"];

export function CrewScreen({ ctx }: { ctx: Ctx }) {
  const { viewer, week, data, repo, run } = ctx;
  const ds = data.ds;
  const edit = can.editCrewRecords(viewer.role);
  const roster = can.setRosterActive(viewer.role);
  const weeks = useMemo(() => weekList(week, 13), [week]);
  const idx = useMemo(() => buildIndex(ds), [ds]);
  const plans = useMemo(() => allPlans(ds, idx, week), [ds, idx, week]);
  const avail = weeks.map((w) => availableMen(ds, idx, w));
  const lav = weeks.map((w) => availableMen(ds, idx, w, true));
  const minA = Math.min(...avail);
  const active = ds.people.filter((p) => p.active && p.kind !== "leadership");
  const upcoming = ds.timeOff.filter((t) => t.active && t.lastDay >= mondayOf(week)).sort((a, b) => a.firstDay.localeCompare(b.firstDay));
  const byId = new Map(ds.people.map((p) => [p.id, p]));
  const [q, setQ] = useState("");
  const fillWeek = addDays(week, 7 * ds.settings.autoFillWeeksOut);
  const [fill, setFill] = useState<ReturnType<typeof proposeWeek> | null>(null);
  const [to, setTo] = useState({ personId: "", first: addDays(week, 3), last: addDays(week, 7), type: "PTO" as TimeOffType });
  const [np, setNp] = useState({ name: "", kind: "field" as Person["kind"], state: "MN", phone: "", driver: false, dot: "" });

  const nextOff = (p: Person) => {
    const t = upcoming.find((x) => x.personId === p.id);
    return t ? `${fmtShort(t.firstDay)}${t.lastDay !== t.firstDay ? "–" + fmtShort(t.lastDay) : ""} (${t.type})` : "";
  };
  const thisWeek = (p: Person) => ds.jobs.find((j) => isSold(j) && assignedIds(ds, j.id, week).includes(p.id))?.customer ?? "";

  return (
    <>
      <h1>Crew</h1>
      <p className="lead">
        {active.length} on the active roster, {active.filter((p) => p.kind === "leader").length} of them job leaders. Qualified:{" "}
        {ds.qualifications.map((qq) => `${qq} ${active.filter((p) => qq in p.quals).length}`).join(", ")}. Time off entered here flows straight into capacity and flags anyone already assigned. The scheduler keeps qualifications and expiry dates current here.
      </p>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Week ending</th>
              {weeks.map((w) => (
                <th key={w} className="r">
                  {fmtShort(w)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Men available</td>
              {avail.map((v, i) => (
                <td key={i} className="r num" style={v === minA ? { color: "var(--red)", fontWeight: 700 } : undefined}>
                  {n1(v)}
                </td>
              ))}
            </tr>
            <tr>
              <td>Leaders available</td>
              {lav.map((v, i) => (
                <td key={i} className="r num" style={v < leadersNeeded(ds, plans, weeks[i]) ? { color: "var(--red)", fontWeight: 700 } : undefined}>
                  {n1(v)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {can.editCrewRecords(viewer.role) && (
        <>
          <h2>Crew auto-fill</h2>
          <div className="panel">
            <div className="row">
              <span className="note" style={{ flex: 1 }}>
                Fills short crews for the week ending {fmtShort(fillWeek)} ({ds.settings.autoFillWeeksOut} weeks out): leader first, then last week’s crew, then qualified people who are free. You see the list
                before anything is assigned.
              </span>
              <button className="btn sec" onClick={() => setFill(proposeWeek(ds, idx, fillWeek))}>
                Preview auto-fill
              </button>
            </div>
            {fill && (
              <div style={{ marginTop: 10 }} role="region" aria-label="Auto-fill preview">
                {fill.length === 0 ? (
                  <p className="note">Every crew that week is full, or nobody suitable is free.</p>
                ) : (
                  <>
                    <ul className="att">
                      {fill.map((f) => (
                        <li key={f.job.id}>
                          <span className="tag blue">{f.job.number}</span>
                          <span>
                            {f.job.customer}: add {f.add.map((id) => byId.get(id)?.name).join(", ")}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div className="row" style={{ marginTop: 8 }}>
                      <button
                        className="btn"
                        onClick={async () => {
                          const list = fill;
                          const n = list.reduce((a, f) => a + f.add.length, 0);
                          const ok = await run(async () => {
                            for (const f of list) for (const pid of f.add) await repo.assign(f.job.id, pid, fillWeek);
                          }, `${n} people assigned for the week ending ${fmtShort(fillWeek)}.`);
                          if (ok) setFill(null);
                        }}
                      >
                        Assign all
                      </button>
                      <button className="btn sec" onClick={() => setFill(null)}>
                        Cancel
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {edit && (
        <>
          <h2>Add time off</h2>
          <div className="panel">
            <div className="row">
              <label className="field">
                Person
                <select value={to.personId} aria-label="Person taking time off" onChange={(e) => setTo({ ...to, personId: e.target.value })}>
                  <option value="">Select…</option>
                  {[...active]
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.kind === "leader" ? " (leader)" : ""}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                First day
                <input type="date" value={to.first} onChange={(e) => setTo({ ...to, first: e.target.value })} />
              </label>
              <label className="field">
                Last day
                <input type="date" value={to.last} onChange={(e) => setTo({ ...to, last: e.target.value })} />
              </label>
              <label className="field">
                Type
                <select value={to.type} aria-label="Time off type" onChange={(e) => setTo({ ...to, type: e.target.value as TimeOffType })}>
                  {TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <button
                className="btn"
                disabled={!to.personId || !to.first || !to.last}
                onClick={() => {
                  if (to.last < to.first) return void run(() => Promise.reject(new Error("Pick a first day and a last day on or after it.")));
                  void run(() => repo.addTimeOff(to.personId, to.first, to.last, to.type), "Time off added.");
                }}
              >
                Add time off
              </button>
            </div>
          </div>
        </>
      )}

      <h2>Upcoming time off</h2>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Dates</th>
              <th>Type</th>
              {edit && <th />}
            </tr>
          </thead>
          <tbody>
            {upcoming.length === 0 && (
              <tr>
                <td colSpan={4}>None entered.</td>
              </tr>
            )}
            {upcoming.slice(0, 60).map((t) => (
              <tr key={t.id}>
                <td>{byId.get(t.personId)?.name}</td>
                <td>
                  {fmtShort(t.firstDay)}–{fmtShort(t.lastDay)}
                </td>
                <td>{t.type}</td>
                {edit && (
                  <td>
                    <button className="jl" onClick={() => run(() => repo.removeTimeOff(t.id), "Time off removed. It stays in the change log.")}>
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {upcoming.length > 60 && <p className="note">Showing the next 60 of {upcoming.length}.</p>}

      <h2>Roster</h2>
      <div className="row" style={{ marginBottom: 10 }}>
        <label className="field" style={{ flex: 1, maxWidth: 320 }}>
          Find a person
          <input type="search" value={q} placeholder="Name" onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <div className="scroll">
        <table id="roster">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>State</th>
              <th>Qualifications</th>
              <th>This week</th>
              <th>Next time off</th>
              <th>DOT physical expires</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {ds.people
              .filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()))
              .map((p) => {
                const expired = p.driver && (!p.dotExpires || p.dotExpires < week);
                const soon = p.driver && !expired && !!p.dotExpires && p.dotExpires <= addDays(week, ds.settings.certFirstDays);
                const dotTag = expired ? <span className="tag red">{p.dotExpires ? "Expired" : "Not on file"}</span> : soon ? <span className="tag yel">Expires soon</span> : null;
                return (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{p.kind === "leader" ? "Leader" : p.kind === "field" ? "Field" : "Leadership"}</td>
                    <td>{p.state}</td>
                    <td className="q">
                      {edit ? (
                        <>
                          {ds.qualifications.map((qq) => (
                            <span key={qq} style={{ marginRight: 10, whiteSpace: "nowrap", display: "inline-block" }}>
                              <label>
                                <input
                                  type="checkbox"
                                  checked={qq in p.quals}
                                  onChange={(e) => run(() => repo.setQualification(p.id, qq, e.target.checked, e.target.checked ? addDays(week, 365) : null))}
                                />{" "}
                                {qq}
                              </label>
                              {qq in p.quals && (
                                <input
                                  type="date"
                                  className={p.quals[qq] && p.quals[qq]! < week ? "act miss" : "act"}
                                  style={{ width: 140, marginLeft: 4, textAlign: "left" }}
                                  defaultValue={p.quals[qq] ?? ""}
                                  aria-label={`${p.name} ${qq} expires`}
                                  title="Expiry date from the card or certificate"
                                  onBlur={(e) => e.target.value && e.target.value !== (p.quals[qq] ?? "") && run(() => repo.setQualification(p.id, qq, true, e.target.value))}
                                />
                              )}
                            </span>
                          ))}
                          <label style={{ whiteSpace: "nowrap" }}>
                            <input type="checkbox" checked={p.driver} onChange={(e) => run(() => repo.updatePerson(p.id, { driver: e.target.checked }))} /> Driver
                          </label>
                        </>
                      ) : (
                        (Object.keys(p.quals).join(", ") || "None") + (p.driver ? ", driver" : "")
                      )}
                    </td>
                    <td>{thisWeek(p)}</td>
                    <td>{nextOff(p)}</td>
                    <td>
                      {!p.driver ? (
                        <span className="q">Not a driver</span>
                      ) : edit ? (
                        <>
                          <input
                            type="date"
                            className={expired ? "act miss" : "act"}
                            style={{ width: 150, textAlign: "left" }}
                            defaultValue={p.dotExpires ?? ""}
                            aria-label={`${p.name} DOT physical expires`}
                            onBlur={(e) => e.target.value !== (p.dotExpires ?? "") && run(() => repo.updatePerson(p.id, { dotExpires: e.target.value || null }))}
                          />{" "}
                          {dotTag}
                        </>
                      ) : (
                        <>
                          {p.dotExpires ? fmtLong(p.dotExpires) : "Not on file"} {dotTag}
                        </>
                      )}
                    </td>
                    <td>
                      {roster ? (
                        <input type="checkbox" checked={p.active} aria-label={`${p.name} active`} onChange={(e) => run(() => repo.updatePerson(p.id, { active: e.target.checked }))} />
                      ) : p.active ? (
                        "Yes"
                      ) : (
                        "No"
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {can.addPerson(viewer.role) && (
        <>
          <h2>Add a person</h2>
          <div className="panel">
            <div className="row">
              <label className="field">
                Name
                <input value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} />
              </label>
              <label className="field">
                Role
                <select value={np.kind} onChange={(e) => setNp({ ...np, kind: e.target.value as Person["kind"] })}>
                  <option value="field">Field</option>
                  <option value="leader">Leader</option>
                </select>
              </label>
              <label className="field">
                State
                <input value={np.state} maxLength={2} style={{ width: 60 }} onChange={(e) => setNp({ ...np, state: e.target.value.toUpperCase() })} />
              </label>
              <label className="field">
                Phone
                <input value={np.phone} onChange={(e) => setNp({ ...np, phone: e.target.value })} />
              </label>
              <label className="q">
                <input type="checkbox" checked={np.driver} onChange={(e) => setNp({ ...np, driver: e.target.checked })} /> Driver
              </label>
              {np.driver && (
                <label className="field">
                  DOT physical expires
                  <input type="date" value={np.dot} onChange={(e) => setNp({ ...np, dot: e.target.value })} />
                </label>
              )}
              <button
                className="btn"
                disabled={!np.name.trim()}
                onClick={async () => {
                  const ok = await run(
                    () => repo.addPerson({ name: np.name.trim(), kind: np.kind, state: np.state, phone: np.phone, driver: np.driver, dotExpires: np.driver ? np.dot || null : null }),
                    `${np.name.trim()} added to the roster.`,
                  );
                  if (ok) setNp({ name: "", kind: "field", state: "MN", phone: "", driver: false, dot: "" });
                }}
              >
                Add person
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
