import { useCallback, useEffect, useState } from "react";
import type { LoadResult, Repo } from "./data/repo";
import { friendlyError } from "./data/repo";
import { type Tab, tabsFor } from "./domain/permissions";
import type { Viewer } from "./domain/types";
import { AccessScreen } from "./screens/AccessScreen";
import { AlertsScreen } from "./screens/AlertsScreen";
import { CloseScreen } from "./screens/CloseScreen";
import { DashboardScreen } from "./screens/DashboardScreen";
import { MyWeekScreen } from "./screens/MyWeekScreen";
import { CrewScreen } from "./screens/CrewScreen";
import { LogScreen } from "./screens/LogScreen";
import { ScheduleScreen } from "./screens/ScheduleScreen";
import { SettingsScreen } from "./screens/SettingsScreen";

export interface Ctx {
  repo: Repo;
  viewer: Viewer;
  week: string;
  data: LoadResult;
  /** Run a change, report a failure in plain words, then reload. Returns true if it worked. */
  run: (action: () => Promise<unknown>, done?: string) => Promise<boolean>;
  /** Switch tabs, e.g. a dashboard link to the journey. */
  go: (t: Tab) => void;
}

export function Workspace({ repo, viewer, header }: { repo: Repo; viewer: Viewer; header: React.ReactNode }) {
  const tabs = tabsFor(viewer.role);
  const [tab, setTab] = useState<Tab | null>(() => {
    const h = location.hash.slice(1) as Tab;
    return tabs.some((t) => t.id === h) ? h : tabs[0]?.id ?? null;
  });
  const [data, setData] = useState<LoadResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; err: boolean } | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await repo.load(viewer));
      setLoadError(null);
    } catch (e) {
      setLoadError(friendlyError(e));
    }
  }, [repo, viewer]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.err ? 6000 : 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const run = useCallback(
    async (action: () => Promise<unknown>, done?: string) => {
      try {
        await action();
        if (done) setToast({ text: done, err: false });
        await reload();
        return true;
      } catch (e) {
        setToast({ text: friendlyError(e), err: true });
        await reload();
        return false;
      }
    },
    [reload],
  );

  const go = (t: Tab) => {
    setTab(t);
    history.replaceState(null, "", "#" + t);
    window.scrollTo(0, 0);
  };

  const ctx: Ctx | null = data ? { repo, viewer, week: data.week, data, run, go } : null;

  return (
    <>
      <header className="top">
        <div className="bar">
          <div className="brand">
            <span className="mark">TMI</span>
            <div>
              <b>TMI Ops</b>
              <small>Crew schedule and forecast</small>
            </div>
          </div>
          {header}
        </div>
        {tabs.length > 0 && (
          <nav className="tabs" aria-label="Sections">
            {tabs.map((t) => (
              <button key={t.id} aria-current={t.id === tab ? "page" : undefined} onClick={() => go(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
        )}
      </header>
      <main>
        {!tabs.length ? (
          <>
            <h1>Welcome, {viewer.name}</h1>
            <p className="lead">Your weekly job and crew screen is coming in a later phase. Until then your leader will send your schedule.</p>
          </>
        ) : loadError ? (
          <p className="lead" role="alert">
            Couldn’t load the schedule: {loadError}
          </p>
        ) : !ctx ? (
          <p className="note">Loading…</p>
        ) : tab === "me" ? (
          <MyWeekScreen ctx={ctx} />
        ) : tab === "dashboard" ? (
          <DashboardScreen ctx={ctx} />
        ) : tab === "close" ? (
          <CloseScreen ctx={ctx} />
        ) : tab === "alerts" ? (
          <AlertsScreen ctx={ctx} />
        ) : tab === "schedule" ? (
          <ScheduleScreen ctx={ctx} />
        ) : tab === "crew" ? (
          <CrewScreen ctx={ctx} />
        ) : tab === "access" ? (
          <AccessScreen ctx={ctx} />
        ) : tab === "settings" ? (
          <SettingsScreen ctx={ctx} />
        ) : tab === "log" ? (
          <LogScreen ctx={ctx} />
        ) : null}
      </main>
      {toast && (
        <div className={"toast" + (toast.err ? " err" : "")} role={toast.err ? "alert" : "status"}>
          {toast.text}
        </div>
      )}
    </>
  );
}
