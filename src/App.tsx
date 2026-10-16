import { useCallback, useEffect, useState, type ComponentType } from "react";
import { DemoPanel } from "./components/DemoPanel";
import { CoachIcon, MedalIcon, ShowcaseIcon, TodayIcon, WeekIcon } from "./components/Icons";
import { ClinicianView } from "./screens/ClinicianView";
import { CoachScreen } from "./screens/CoachScreen";
import { MedalsScreen } from "./screens/MedalsScreen";
import { Onboarding } from "./screens/Onboarding";
import { PreferencesSheet } from "./screens/PreferencesSheet";
import { RecapSheet } from "./screens/RecapSheet";
import { ShowcaseScreen } from "./screens/ShowcaseScreen";
import { TodayScreen } from "./screens/TodayScreen";
import { WeekScreen } from "./screens/WeekScreen";
import { useStore } from "./state/store";
import type { Screen } from "./state/types";

const TABS: Array<{ id: Screen; label: string; Icon: ComponentType<{ className?: string }> }> = [
  { id: "today", label: "Today", Icon: TodayIcon },
  { id: "week", label: "Week", Icon: WeekIcon },
  { id: "medals", label: "Medals", Icon: MedalIcon },
  { id: "coach", label: "Coach", Icon: CoachIcon },
  { id: "showcase", label: "Showcase", Icon: ShowcaseIcon },
];

const SCREENS: Screen[] = ["onboarding", "today", "week", "medals", "coach", "showcase"];

/** Screen lives in the URL hash (#week) so links and refreshes keep your place. */
function readHash(): Screen | null {
  const h = window.location.hash.replace(/^#\/?/, "") as Screen;
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

        {overlay === "clinician" ? (
          <ClinicianView />
        ) : active === "coach" ? (
          <CoachScreen />
        ) : (
          <main className="screen" key={active}>
            {active === "onboarding" && <Onboarding onDone={() => go("today")} />}
            {active === "today" && <TodayScreen go={go} openPrefs={() => dispatch({ type: "overlay", overlay: "prefs" })} />}
            {active === "week" && <WeekScreen />}
            {active === "medals" && <MedalsScreen />}
            {active === "showcase" && <ShowcaseScreen />}
          </main>
        )}

        {active !== "onboarding" && overlay !== "clinician" && (
          <nav className="tabbar" aria-label="Main">
            {TABS.map(({ id, label, Icon }) => (
              <button key={id} className="tab" aria-current={active === id ? "page" : undefined} onClick={() => go(id)}>
                <Icon />
                {label}
              </button>
            ))}
          </nav>
        )}

        {overlay === "prefs" && <PreferencesSheet onClose={close} openClinician={() => dispatch({ type: "overlay", overlay: "clinician" })} />}
        {overlay === "recap" && <RecapSheet onClose={close} onPlan={() => { close(); go("week"); }} />}

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
