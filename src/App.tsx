import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { DemoPanel } from "./components/DemoPanel";
import { CoachIcon, MedalIcon, ShowcaseIcon, StethoscopeIcon, TodayIcon } from "./components/Icons";
import { ClinicianScreen } from "./screens/ClinicianScreen";
import { CoachScreen } from "./screens/CoachScreen";
import { Onboarding } from "./screens/Onboarding";
import { PreferencesSheet } from "./screens/PreferencesSheet";
import { ProgressScreen } from "./screens/ProgressScreen";
import { ShowcaseScreen } from "./screens/ShowcaseScreen";
import { TodayScreen } from "./screens/TodayScreen";
import { useStore } from "./state/store";
import type { Screen } from "./state/types";

const TABS: Array<{ id: Screen; label: string; Icon: ComponentType<{ className?: string }> }> = [
  { id: "today", label: "Today", Icon: TodayIcon },
  { id: "progress", label: "Progress", Icon: MedalIcon },
  { id: "coach", label: "Coach", Icon: CoachIcon },
  { id: "clinician", label: "Clinician", Icon: StethoscopeIcon },
  { id: "showcase", label: "Showcase", Icon: ShowcaseIcon },
];

const SCREENS: Screen[] = ["onboarding", "today", "progress", "coach", "clinician", "showcase"];
/** Old links: Week and Medals are now part of Progress. */
const RENAMED: Record<string, Screen> = { week: "progress", medals: "progress" };

/** Screen lives in the URL hash (#progress) so links and refreshes keep your place. */
function readHash(): Screen | null {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const h = (RENAMED[raw] ?? raw) as Screen;
  return SCREENS.includes(h) ? h : null;
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return <span>{now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M/i, "")}</span>;
}

export default function App() {
  const { state, dispatch } = useStore();
  const [screen, setScreen] = useState<Screen>(() => readHash() ?? "today");

  const go = useCallback((s: Screen) => {
    setScreen(s);
    try {
      if (window.location.hash !== `#${s}`) window.history.pushState(null, "", `#${s}`);
    } catch {
      /* some embedded viewers block history changes; navigation still works in memory */
    }
  }, []);

  useEffect(() => {
    const onPop = () => setScreen(readHash() ?? "today");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!state.toast) return;
    const t = setTimeout(() => dispatch({ type: "toast", text: null }), 6000);
    return () => clearTimeout(t);
  }, [state.toast, dispatch]);

  // Showcase works without onboarding (it's for visitors); everything else needs it.
  const active: Screen = !state.onboarded && screen !== "showcase" ? "onboarding" : screen === "onboarding" && state.onboarded ? "today" : screen;
  const overlay = state.onboarded ? state.overlay : null;
  const close = () => dispatch({ type: "overlay", overlay: null });

  // "Not now" and "Cancel" on the Clinician tab go back to the tab the user came from.
  const lastTab = useRef<Screen>("today");
  useEffect(() => {
    if (active !== "clinician" && active !== "onboarding") lastTab.current = active;
  }, [active]);

  return (
    <div className="desk">
      <section className="desk-intro">
        <h1>Make It Count</h1>
        <p>
          A personal health agent that takes away decision fatigue. Each day it hands you one workout that fits your
          time and the activities you enjoy, counts it in MET-hours toward the weekly guideline, and rewards every day you move.
        </p>
        <p className="team">Demo build. Fitbit data and coach replies are simulated.</p>
      </section>

      <div className="phone">
        <div className="status-bar" aria-hidden>
          <Clock />
          <div className="island" />
          <div className="status-icons">
            <span style={{ width: 3, height: 6 }} /><span style={{ width: 3, height: 8 }} /><span style={{ width: 3, height: 10 }} />
            <span style={{ width: 22, height: 11, borderRadius: 3, marginLeft: 4 }} />
          </div>
        </div>

        {active === "clinician" ? (
          <ClinicianScreen onSaved={() => go("today")} onLeave={() => go(lastTab.current)} />
        ) : active === "coach" ? (
          <CoachScreen />
        ) : (
          <main className="screen" key={active}>
            {active === "onboarding" && <Onboarding onDone={() => go("today")} />}
            {active === "today" && <TodayScreen go={go} openPrefs={() => dispatch({ type: "overlay", overlay: "prefs" })} />}
            {active === "progress" && <ProgressScreen />}
            {active === "showcase" && <ShowcaseScreen />}
          </main>
        )}

        {active !== "onboarding" && active !== "clinician" && (
          <nav className="tabbar" aria-label="Main">
            {TABS.map(({ id, label, Icon }) => (
              <button key={id} className="tab" aria-current={active === id ? "page" : undefined} onClick={() => go(id)}>
                <Icon />
                {label}
              </button>
            ))}
          </nav>
        )}

        {overlay === "prefs" && active !== "clinician" && <PreferencesSheet onClose={close} openClinician={() => { close(); go("clinician"); }} />}

        {state.toast && (
          <div className="toast" role="status">
            <span>{state.toast}</span>
            <button onClick={() => dispatch({ type: "toast", text: null })}>Dismiss</button>
          </div>
        )}
      </div>

      <DemoPanel go={go} />
    </div>
  );
}
