import { useEffect, useState } from "react";
import { fieldLabel, valueText } from "../domain/changeText";
import { friendlyError } from "../data/repo";
import type { ChangeLogEntry } from "../domain/types";
import { stamp } from "../format";
import type { Ctx } from "../Workspace";

/** Every change: who, when, what, old value, new value (hard rule 5). */
export function LogScreen({ ctx }: { ctx: Ctx }) {
  const { repo, data } = ctx;
  const [rows, setRows] = useState<ChangeLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    repo.changeLog().then(setRows, (e) => setError(friendlyError(e)));
  }, [repo, data]);
  const shown = (rows ?? []).filter((r) => !q || [r.who, r.recordLabel, fieldLabel(r.field), valueText(r.field, r.oldValue, data.ds, r.table), valueText(r.field, r.newValue, data.ds, r.table)].join(" ").toLowerCase().includes(q.toLowerCase()));
  const ds = data.ds;
  const val = (r: ChangeLogEntry, v: string | null) => (r.field === "added" && v === null ? "" : valueText(r.field, v, ds, r.table));
  return (
    <>
      <h1>Change log</h1>
      <p className="lead">The latest 300 changes, newest first. Nothing is deleted; removed items are marked inactive and show here.</p>
      {error && <p role="alert">{error}</p>}
      <div className="row" style={{ marginBottom: 10 }}>
        <label className="field" style={{ flex: 1, maxWidth: 320 }}>
          Filter
          <input type="search" value={q} placeholder="Job number, person, field" onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      {!rows ? (
        <p className="note">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="note">No changes yet.</p>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>What</th>
                <th>Field</th>
                <th>Was</th>
                <th>Now</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td>{stamp(r.at)}</td>
                  <td>{r.who}</td>
                  <td>{r.recordLabel || r.table}</td>
                  <td>{fieldLabel(r.field)}</td>
                  <td style={{ whiteSpace: "normal" }}>{val(r, r.oldValue)}</td>
                  <td style={{ whiteSpace: "normal" }}>{val(r, r.newValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
