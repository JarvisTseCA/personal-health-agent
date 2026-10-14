import { useCallback, useEffect, useState, type ComponentType } from "react";
import { DemoPanel } from "./components/DemoPanel";
import { CoachIcon, PlanIcon, ShowcaseIcon, WeekIcon } from "./components/Icons";
import { CoachScreen } from "./screens/CoachScreen";
import { Onboarding } from "./screens/Onboarding";
import { PlanScreen } from "./screens/PlanScreen";
import { ShowcaseScreen } from "./screens/ShowcaseScreen";
import { WeekScreen } from "./screens/WeekScreen";
import { useStore } from "./state/store";
import type { Screen } from "./state/types";

const TABS: Array<{ id: Screen; label: string; Icon: ComponentType<{ className?: string }> }> = [
  { id: "week", label: "This week", Icon: WeekIcon },
  { id: "plan", label: "Plan", Icon: PlanIcon },
  { id: "coach", label: "Coach", Icon: CoachIcon },
  { id: "showcase", label: "Showcase", Icon: ShowcaseIcon },
];

const SCREENS: Screen[] = ["onboarding", "week", "plan", "coach", "showcase"];

/** Screen lives in the URL hash (#/plan) so links and refreshes keep your place. */
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
  const { state } = useStore();
  const [screen, setScreen] = useState<Screen>(() => readHash() ?? "week");

  const go = useCallback((s: Screen) => {
    setScreen(s);
    if (window.location.hash !== `#/${s}`) window.history.pushState(null, "", `#/${s}`);
  }, []);

  useEffect(() => {
    const onPop = () => setScreen(readHash() ?? "week");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Showcase works without onboarding (it's for visitors); everything else needs it.
  const active: Screen = !state.onboarded && screen !== "showcase" ? "onboarding" : screen === "onboarding" && state.onboarded ? "week" : screen;

  return (
    <div className="desk">
      <section className="desk-intro">
        <h1>Make It Count</h1>
        <p>
          A personal health agent for busy adults. It turns the activities you enjoy into minutes toward the weekly
          physical activity guideline, and plans the rest of your week around the time you actually have.
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

        {active === "coach" ? (
          <CoachScreen />
        ) : (
          <main className="screen" key={active}>
            {active === "onboarding" && <Onboarding onDone={() => go("week")} />}
            {active === "week" && <WeekScreen go={go} />}
            {active === "plan" && <PlanScreen go={go} />}
            {active === "showcase" && <ShowcaseScreen />}
          </main>
        )}

        {active !== "onboarding" && (
          <nav className="tabbar" aria-label="Main">
            {TABS.map(({ id, label, Icon }) => (
              <button key={id} className="tab" aria-current={active === id ? "page" : undefined} onClick={() => go(id)}>
                <Icon />
                {label}
              </button>
            ))}
          </nav>
        )}
      </div>

      <DemoPanel go={go} />
    </div>
  );
}
