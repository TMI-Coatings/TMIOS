import { useEffect, useState } from "react";
import type { AccessUser } from "../data/repo";
import { friendlyError } from "../data/repo";
import { ROLES, ROLE_LABEL, type Role } from "../domain/types";
import type { Ctx } from "../Workspace";

/** Roles that only work once linked to a leader, a rep code or a PM code. */
const needsLink = (u: { role: Role; personId: string | null; repCode: string | null; pmCode: string | null }) =>
  (u.role === "superintendent" || u.role === "field_crew") && !u.personId ? true : u.role === "sales_rep" ? !u.repCode : u.role === "pm" ? !u.pmCode : false;

const blank = { email: "", name: "", role: "estimator" as Role, personId: null as string | null, repCode: null as string | null, pmCode: null as string | null, active: true };

/** Who can sign in and as what. People sign in with Microsoft; access only works for emails listed here. */
export function AccessScreen({ ctx }: { ctx: Ctx }) {
  const { repo, run, data, viewer } = ctx;
  const ds = data.ds;
  const [users, setUsers] = useState<AccessUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState(blank);
  // A role change waiting for its link (leader, rep or PM code) before it can be saved.
  const [pending, setPending] = useState<Record<string, typeof blank>>({});

  const load = () => repo.listUsers().then(setUsers, (e) => setError(friendlyError(e)));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const save = async (u: Parameters<typeof repo.saveUser>[0], done: string) => {
    if (await run(() => repo.saveUser(u), done)) {
      await load();
      return true;
    }
    return false;
  };

  const links = (u: { role: Role; personId: string | null; repCode: string | null; pmCode: string | null }, change: (p: Partial<typeof blank>) => void) =>
    u.role === "superintendent" || u.role === "field_crew" ? (
      <select value={u.personId ?? ""} onChange={(e) => change({ personId: e.target.value || null })} aria-label={u.role === "field_crew" ? "Person on the roster" : "Leader on the roster"}>
        <option value="">{u.role === "field_crew" ? "Pick the person…" : "Pick the leader…"}</option>
        {ds.people
          .filter((p) => (u.role === "field_crew" ? p.kind !== "leadership" : p.kind === "leader"))
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </select>
    ) : u.role === "sales_rep" ? (
      <select value={u.repCode ?? ""} onChange={(e) => change({ repCode: e.target.value || null })} aria-label="Rep code">
        <option value="">Pick the rep…</option>
        {ds.reps.map((r) => (
          <option key={r.code} value={r.code}>
            {r.name} ({r.code})
          </option>
        ))}
      </select>
    ) : u.role === "pm" ? (
      <select value={u.pmCode ?? ""} onChange={(e) => change({ pmCode: e.target.value || null })} aria-label="PM code">
        <option value="">Pick the PM…</option>
        {ds.pms.map((r) => (
          <option key={r.code} value={r.code}>
            {r.name} ({r.code})
          </option>
        ))}
      </select>
    ) : (
      <span className="q">Sees all jobs</span>
    );

  return (
    <>
      <h1>Access</h1>
      <p className="lead">
        People sign in with their TMI Microsoft account. Only emails listed here get in, and the role decides what they see. Turning someone off here ends their access at their next page load;
        turning off their Microsoft account ends it at sign-in.
      </p>
      {error && <p role="alert">{error}</p>}
      <h2>Add someone</h2>
      <div className="panel">
        <div className="row">
          <label className="field">
            Microsoft email
            <input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
          </label>
          <label className="field">
            Name
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label className="field">
            Role
            <select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as Role, personId: null, repCode: null, pmCode: null })}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Linked to
            {links(draft, (p) => setDraft({ ...draft, ...p }))}
          </label>
          <button
            className="btn"
            disabled={!draft.email.trim() || !draft.name.trim()}
            onClick={async () => {
              if (await save(draft, `${draft.name} can now sign in.`)) setDraft(blank);
            }}
          >
            Give access
          </button>
        </div>
      </div>
      <h2>Everyone with access</h2>
      {!users ? (
        <p className="note">Loading…</p>
      ) : (
        <div className="scroll">
          <table className="users">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Linked to</th>
                <th>Signed in yet</th>
                <th>Access on</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const p = pending[u.id];
                const shown = p ? { ...u, ...p } : u;
                const self = u.email.toLowerCase() === viewer.email.toLowerCase();
                const clear = () => setPending(({ [u.id]: _, ...rest }) => rest);
                const change = (c: Partial<typeof blank>) => {
                  const next = { ...shown, ...c };
                  if (needsLink(next)) return setPending({ ...pending, [u.id]: { ...blank, ...next } });
                  clear();
                  void save(next, `${u.name} updated.`);
                };
                return (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td>{u.email}</td>
                    <td>
                      <select
                        value={shown.role}
                        aria-label={`${u.name} role`}
                        disabled={self}
                        title={self ? "Ask another admin to change your own access." : undefined}
                        onChange={(e) => change({ role: e.target.value as Role, personId: null, repCode: null, pmCode: null })}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {links(shown, change)}
                      {p && (
                        <>
                          {" "}
                          <span className="q">Pick a link to save the new role.</span>{" "}
                          <button className="jl" onClick={clear}>
                            Cancel
                          </button>
                        </>
                      )}
                    </td>
                    <td>{u.linked ? "Yes" : "Not yet"}</td>
                    <td>
                      <input
                        type="checkbox"
                        checked={u.active}
                        disabled={self}
                        title={self ? "Ask another admin to change your own access." : undefined}
                        aria-label={`${u.name} access on`}
                        onChange={(e) => change({ active: e.target.checked })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
