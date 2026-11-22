/**
 * Settings: the two things users set by hand.
 *  - "Tell us what you love doing": the activity table's categories, each 👍 like, 👎 dislike or
 *    no preference (the same chips as onboarding). Disliked categories are never suggested.
 *  - The weekly plan: time per day, the same options as onboarding. Changing a day updates that
 *    day's target, like *Update my goals* on Progress.
 */
import { CATEGORY_HELP, CategoryChips } from "../components/CategoryChips";
import { PlanDays } from "../components/PlanDays";
import { useStore } from "../state/store";

export function SettingsScreen() {
  const { state, dispatch } = useStore();
  return (
    <>
      <div className="screen-head">
        <div>
          <h1>Settings</h1>
          <p className="sub">What you like, and how much time you have each day</p>
        </div>
      </div>

      <section className="settings-section" aria-labelledby="likes-h">
        <h2 id="likes-h">Tell us what you love doing</h2>
        <p className="sub help muted small">{CATEGORY_HELP} I'll suggest more of what you like and never what you don't.</p>
        <CategoryChips
          prefs={state.profile.categoryPrefs}
          onChange={(category, pref) => dispatch({ type: "setCategoryPref", category, pref })}
        />
      </section>

      <section className="settings-section" aria-labelledby="plan-h">
        <h2 id="plan-h">Weekly plan</h2>
        <p className="sub help muted small">
          How much time you have each day. Mark days you can't exercise at all as Off. The weekly goal stays the same; days with more time get more of it.
        </p>
        <PlanDays plan={state.plan} onPick={(day, slot) => dispatch({ type: "setSlot", day, slot })} />
      </section>
    </>
  );
}
