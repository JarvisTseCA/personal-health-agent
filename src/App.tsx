import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import { DemoPanel } from "./components/DemoPanel";
import { ChatIcon, ProgressIcon, GearIcon, SummaryIcon, TodayIcon } from "./components/Icons";
import { ChatScreen } from "./screens/ChatScreen";
import { Onboarding } from "./screens/Onboarding";
import { PreferencesSheet } from "./screens/PreferencesSheet";
import { ProgressScreen } from "./screens/ProgressScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { ShowcaseScreen } from "./screens/ShowcaseScreen";
import { SummaryScreen } from "./screens/SummaryScreen";
import { TodayScreen } from "./screens/TodayScreen";
import { useStore } from "./state/store";
import type { Screen } from "./state/types";
import { isHidden } from "./state/screens";
import { buildAgentContext, reachedToday } from "./services/context";

const TABS: Array<{ id: Screen; label: string; Icon: ComponentType<{ className?: string }> }> = [
  { id: "today", label: "Today", Icon: TodayIcon },
  { id: "progress", label: "Progress", Icon: ProgressIcon },
  { id: "chat", label: "Chat", Icon: ChatIcon },
  { id: "summary", label: "Summary", Icon: SummaryIcon },
  { id: "settings", label: "Settings", Icon: GearIcon },
];

const SCREENS: Screen[] = ["onboarding", "today", "progress", "chat", "summary", "showcase", "settings"];
/** Old links: Week and Medals are now part of Progress; Coach is now Chat; Clinician is now Summary. */
const RENAMED: Record<string, Screen> = { week: "progress", medals: "progress", coach: "chat", clinician: "summary" };

/** Screen lives in the URL hash (#progress) so links and refreshes keep your place. */
function readHash(): Screen | null {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const h = (RENAMED[raw] ?? raw) as Screen;
  return SCREENS.includes(h) && !isHidden(h) ? h : null;
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
  // A text checkmark (✓) on the Today tab once today's target is reached; gone the next day, when the new day starts at 0.
  const todayComplete = useMemo(() => state.onboarded && reachedToday(buildAgentContext(state)), [state]);
  /** A red dot, like an app badge, until today's target is reached (not on a day marked off) */
  const todayOpen = state.onboarded && !todayComplete && (!!state.weekSetup || state.plan[state.todayIndex] !== "off");
  const [screen, setScreen] = useState<Screen>(() => readHash() ?? "today");

  const go = useCallback((to: Screen) => {
    const s = isHidden(to) ? "today" : to;
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
        <h1>VO2 Max Pal</h1>
        <p>
          We help you raise your VO2 max, the best single measure of cardio fitness, without having to plan a thing.
          Each day the agent hands you one workout that fits your time, the equipment where you are, and the activities
          you enjoy, then counts it in MET-hours toward the weekly guideline: the training that builds VO2 max.
        </p>
        <p className="team">Demo build. Fitbit data and VO2 max readings are simulated unless a real Fitbit is connected through the backend. The agent's replies are scripted.</p>
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

        {active === "chat" ? (
          <ChatScreen />
        ) : (
          <main className="screen" key={active}>
            {active === "onboarding" && <Onboarding onDone={() => go("today")} />}
            {active === "today" && <TodayScreen go={go} openPrefs={() => dispatch({ type: "overlay", overlay: "prefs" })} />}
            {active === "progress" && <ProgressScreen />}
            {active === "summary" && <SummaryScreen go={go} />}
            {active === "showcase" && <ShowcaseScreen />}
            {active === "settings" && <SettingsScreen />}
          </main>
        )}

        {active !== "onboarding" && (
          <nav className="tabbar" aria-label="Main">
            {TABS.filter((t) => !isHidden(t.id)).map(({ id, label, Icon }) => (
              <button key={id} className="tab" aria-current={active === id ? "page" : undefined} onClick={() => go(id)}>
                <span className="tab-icon">
                  <Icon />
                  {id === "today" && todayComplete && <span className="tab-badge" aria-hidden>{"\u2713\uFE0E"}</span>}
                  {id === "today" && todayOpen && <span className="tab-dot" aria-hidden />}
                </span>
                {label}
                {id === "today" && todayComplete && <span className="sr-only">, today's target reached</span>}
                {id === "today" && todayOpen && <span className="sr-only">, today's target not reached yet</span>}
              </button>
            ))}
          </nav>
        )}

        {overlay === "prefs" && <PreferencesSheet onClose={close} openSummary={() => { close(); go("summary"); }} openSettings={() => { close(); go("settings"); }} />}

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
