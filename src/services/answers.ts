/**
 * Answers to the one-tap clarification questions. Grounded, not improvised:
 * definitions come from this fixed glossary (reviewed by the team's
 * clinician), "Why this?" reads the ranker's actual reasons, and "How did you
 * calculate this?" shows the calculator's numbers and Compendium code.
 */
import { getFamily, getVariant } from "../lib/activities";
import { countsTowardGoal, creditFor, fmt, fmtGoal } from "../lib/met";
import type { Suggestion } from "../lib/suggest";
import type { AgentContext } from "./context";

export const QUESTIONS = {
  met: "What's a MET?",
  why: "Why this activity?",
  how: "How did you calculate this?",
  walking: "Does walking count?",
  goal: "Why is my goal 7.5?",
  medals: "How do medals work?",
} as const;

export type QuestionId = keyof typeof QUESTIONS;

function list(xs: string[]): string {
  const l = xs.map((x) => x.charAt(0).toLowerCase() + x.slice(1));
  return l.length <= 1 ? l.join("") : `${l.slice(0, -1).join(", ")} and ${l.at(-1)}`;
}

export function answer(q: QuestionId, ctx: AgentContext, s?: Suggestion): string {
  switch (q) {
    case "met": {
      const ex = s ? getVariant(s.variantId) : getVariant("cycling-easy");
      return `A MET measures how hard an activity is compared with sitting still. Sitting is 1 MET; ${ex.family.noun} (${ex.variant.label.toLowerCase()}) is ${ex.variant.met}, so it uses about ${ex.variant.met}× the energy. We multiply METs by hours to see how much each workout counts.`;
    }
    case "why": {
      if (!s) return "Ask me once I've suggested something and I'll show you exactly why I picked it.";
      return `I picked ${getFamily(s.familyId).noun} because: ${list(s.reasons)}.`;
    }
    case "how": {
      if (!s) return "Every workout is MET value × minutes ÷ 60. The MET values come from the 2024 Adult Compendium of Physical Activities.";
      const { family, variant } = getVariant(s.variantId);
      if (!countsTowardGoal(variant.met)) {
        return `${family.name} (${variant.label.toLowerCase()}) is ${variant.met} MET in the 2024 Adult Compendium (code ${variant.code}). That's under 3 MET, so it earns today's bronze medal but doesn't count toward the goal for now.`;
      }
      const credit = creditFor(variant.met, s.durationMin);
      const pct = ctx.todayTarget > 0 ? ` That's ${Math.round((credit / ctx.todayTarget) * 100)}% of today's ${fmt(ctx.todayTarget)} target.` : "";
      return `${family.name} (${variant.label.toLowerCase()}) is ${variant.met} MET in the 2024 Adult Compendium (code ${variant.code}). ${variant.met} × ${s.durationMin} min ÷ 60 = ${fmt(credit)} MET-hours.${pct}`;
    }
    case "walking":
      return "Yes. Walking at about 3 mph is 3.8 MET, so 30 minutes earns 1.9 MET-hours, and brisk walking counts a bit more. A slow stroll under 3 MET earns a bronze medal but doesn't count toward the goal.";
    case "goal": {
      const base = "The guideline is 150 minutes of moderate activity or 75 of vigorous a week. Moderate starts at 3 MET and vigorous at 6, so both come to 7.5 MET-hours.";
      if (ctx.goalBy === "clinician") return `${base} Your clinician set yours to ${fmtGoal(ctx.goal)}.`;
      if (ctx.steppingStone) return `${base} Yours is ${fmtGoal(ctx.goal)} for now, a stepping stone back up to it.`;
      if (ctx.goal > 7.5) return `${base} You've been beating it, so yours is ${fmtGoal(ctx.goal)}.`;
      return base;
    }
    case "medals":
      return "Any activity earns a bronze for the day. Hit the day's target and it's silver. Reach the weekly goal and every medal that week turns gold. Your streak counts days in a row with at least a bronze.";
  }
}
