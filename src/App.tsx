import { useEffect, useMemo, useState } from "react";
import { SampleRepo } from "./data/sampleRepo";
import { SupabaseRepo } from "./data/supabaseRepo";
import { currentViewer, signInWithMicrosoft, signOut, supabase } from "./data/supabase";
import type { Repo } from "./data/repo";
import type { Viewer } from "./domain/types";
import { ROLE_LABEL } from "./domain/types";
import { Workspace } from "./Workspace";

const SAMPLE = import.meta.env.VITE_DATA_MODE === "sample";

export function App() {
  return SAMPLE ? <SampleApp /> : <LiveApp />;
}

/** Sample data in the browser, with the demo's "Viewing as" picker. */
function SampleApp() {
  const repo = useMemo(() => new SampleRepo(), []);
  const users = repo.users();
  const [userId, setUserId] = useState(() => {
    try {
      return sessionStorage.getItem("tmi-ops-sample-viewer") ?? users[0].userId;
    } catch {
      return users[0].userId;
    }
  });
  const viewer = users.find((u) => u.userId === userId) ?? users[0];
  repo.setViewer(viewer);
  const pick = (id: string) => {
    setUserId(id);
    try {
      sessionStorage.setItem("tmi-ops-sample-viewer", id);
    } catch {
      /* fine without it */
    }
  };
  const header = (
    <>
      <span className="sample-flag" title="Invented data held in this browser only">Sample data</span>
      <label className="who">
        Viewing as
        <select value={viewer.userId} onChange={(e) => pick(e.target.value)} aria-label="Viewing as">
          {users.map((u) => (
            <option key={u.userId} value={u.userId}>
              {u.name} ({ROLE_LABEL[u.role]})
            </option>
          ))}
        </select>
      </label>
      {viewer.role === "admin" && (
        <button
          className="ghost"
          onClick={() => {
            if (confirm("Reset the sample to its starting data? Everything entered here is cleared.")) {
              repo.reset();
              location.reload();
            }
          }}
        >
          Reset sample
        </button>
      )}
    </>
  );
  return <Workspace key={viewer.userId} repo={repo} viewer={viewer} header={header} />;
}

type AuthState = { k: "loading" } | { k: "out" } | { k: "no-access"; email: string } | { k: "in"; viewer: Viewer } | { k: "error"; message: string };

/** Production: Microsoft sign-in, then the database decides what this person can see. */
function LiveApp() {
  const [auth, setAuth] = useState<AuthState>({ k: "loading" });
  const repo = useMemo<Repo | null>(() => {
    try {
      return new SupabaseRepo(supabase());
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!repo) {
      setAuth({ k: "error", message: "This site isn't connected to its database yet. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Netlify." });
      return;
    }
    const check = async () => {
      try {
        const v = await currentViewer();
        if (v === null) setAuth({ k: "out" });
        else if (v === "no-access") {
          const { data } = await supabase().auth.getUser();
          setAuth({ k: "no-access", email: data.user?.email ?? "" });
        } else setAuth({ k: "in", viewer: v });
      } catch (e) {
        setAuth({ k: "error", message: e instanceof Error ? e.message : String(e) });
      }
    };
    void check();
    const { data } = supabase().auth.onAuthStateChange((event) => {
      // Re-check access when the session refreshes too, so someone switched off on the Access screen
      // loses the screens within the hour, not just their data.
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "TOKEN_REFRESHED") void check();
    });
    return () => data.subscription.unsubscribe();
  }, [repo]);

  if (auth.k === "loading") return <Center><p className="note">Loading…</p></Center>;
  if (auth.k === "error") return <Center><p>{auth.message}</p></Center>;
  if (auth.k === "out")
    return (
      <Center>
        <h1>TMI Ops</h1>
        <p className="lead">Sign in with your TMI Microsoft account.</p>
        <button className="btn" onClick={() => signInWithMicrosoft().catch((e) => setAuth({ k: "error", message: String(e.message ?? e) }))}>
          Sign in with Microsoft
        </button>
      </Center>
    );
  if (auth.k === "no-access")
    return (
      <Center>
        <h1>No access yet</h1>
        <p className="lead">{auth.email || "This account"} isn't set up in TMI Ops. Ask an admin to add you, then sign in again.</p>
        <button className="btn sec" onClick={() => signOut()}>Sign out</button>
      </Center>
    );
  const header = (
    <>
      <span className="who">
        {auth.viewer.name} · {ROLE_LABEL[auth.viewer.role]}
      </span>
      <button className="ghost" onClick={() => signOut()}>Sign out</button>
    </>
  );
  return <Workspace repo={repo!} viewer={auth.viewer} header={header} />;
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <main className="center">
      <div className="panel">
        <div className="brand" style={{ justifyContent: "center", marginBottom: 12 }}>
          <span className="mark">TMI</span>
        </div>
        {children}
      </div>
    </main>
  );
}
