/**
 * Pre-written agent responses for the demo.
 *
 * Each entry has keyword triggers and a template function that fills in the
 * user's real numbers from the AgentContext. Edit freely — this file is the
 * "script" for demos. The first entry whose `match` returns true wins; the
 * last entry is the fallback.
 */
import { getVariant, searchFamilies } from "../lib/activities";
import { DAY_NAMES_LONG, formatDuration, intensityOf, multiplierOf } from "../lib/guideline";
import type { AgentContext } from "./context";

export interface ScriptedReply {
  id: string;
  match: (text: string, ctx: AgentContext) => boolean;
  reply: (text: string, ctx: AgentContext) => string;
  suggestions?: string[];
}

const has = (t: string, ...words: string[]) => words.some((w) => t.includes(w));

/** The activity family a message talks about, e.g. "does salsa count?" → dancing. */
function mentionedFamily(t: string) {
  const words = t.replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w.length > 2);
  return words.map((w) => searchFamilies(w)).find((r) => r.length > 0 && r.length < 4)?.[0];
}

function planLine(ctx: AgentContext): string {
  const plan = ctx.chosenPlan ?? ctx.options.find((o) => o.fits) ?? ctx.options[0];
  if (!plan) return "";
  const parts = plan.sessions.map((s) => {
    const { family } = getVariant(s.variantId);
    return `${s.durationMin} min ${family.noun} on ${DAY_NAMES_LONG[s.dayIndex]}`;
  });
  return parts.join(", ");
}

export const SCRIPTED_REPLIES: ScriptedReply[] = [
  {
    id: "safety",
    match: (t) => has(t, "chest", "dizzy", "faint", "pain", "hurt", "injur", "breath"),
    reply: () =>
      "That's worth taking seriously. Please stop exercising and check in with a clinician before your next workout, and seek urgent care if symptoms are severe. I'll pause suggestions for vigorous activity until you tell me you've been cleared.",
    suggestions: ["How am I doing this week?"],
  },
  {
    id: "goal-met",
    match: (_t, ctx) => ctx.week.remainingMinutes === 0,
    reply: (_t, ctx) =>
      `You've already hit the goal: ${ctx.week.doneMinutes} guideline minutes this week. Anything else you do is a bonus, so pick whatever sounds fun, or take a rest day. Rest counts too.`,
    suggestions: ["Why 150 minutes?"],
  },
  {
    id: "progress",
    match: (t) => has(t, "how am i", "progress", "doing", "so far", "status", "where am i"),
    reply: (_t, ctx) => {
      const w = ctx.week;
      const vig = w.vigorousMinutes > 0 ? ` Your ${w.vigorousMinutes} vigorous minutes counted double.` : "";
      return `You're at ${w.doneMinutes} of ${ctx.goalMinutes} guideline minutes (${w.percent}%) with ${formatDuration(ctx.timeLeftMinutes)} of free time left this week.${vig} ${w.remainingMinutes} minutes to go, and that's very doable.`;
    },
    suggestions: ["What should I do today?", "Does dancing count?"],
  },
  {
    id: "does-it-count",
    match: (t) => has(t, "count", "worth") || (/^(does|is|do) /.test(t) && !!mentionedFamily(t)),
    reply: (t, ctx) => {
      const fam = mentionedFamily(t);
      if (!fam) return `Most activities count if they get your heart rate up. Tell me the activity and I'll show you the exact conversion. For example, 30 minutes of brisk walking earns 30 guideline minutes.`;
      const lines = fam.variants
        .filter((v) => multiplierOf(v.met) > 0)
        .map((v) => `${v.label} (${v.met} MET, ${intensityOf(v.met)}) earns ${30 * multiplierOf(v.met)} min`);
      const enjoyed = ctx.profile.enjoyedFamilyIds.includes(fam.id) ? "" : ` It isn't on your list yet; add it in your settings if you'd like me to plan with it.`;
      return `Yes. For 30 minutes of ${fam.noun}: ${lines.join("; ")}.${enjoyed}`;
    },
    suggestions: ["What should I do today?"],
  },
  {
    id: "today",
    match: (t) => has(t, "today", "now", "right now", "tonight", "what should", "next"),
    reply: (_t, ctx) => {
      const plan = ctx.chosenPlan ?? ctx.options.find((o) => o.fits) ?? ctx.options[0];
      const todays = plan?.sessions.filter((s) => s.dayIndex === ctx.todayIndex) ?? [];
      if (!plan) return "Tell me a couple of activities you enjoy and I'll build options around them.";
      if (todays.length === 0) {
        const next = plan.sessions[0];
        return `Nothing planned for today, so enjoy the rest. Next up: ${next.durationMin} min of ${getVariant(next.variantId).family.noun} on ${DAY_NAMES_LONG[next.dayIndex]}.`;
      }
      const s = todays[0];
      const { family, variant } = getVariant(s.variantId);
      return `Today: ${s.durationMin} min of ${family.noun} (${variant.label.toLowerCase()}). That's worth ${s.credit} guideline minutes${s.credit > s.durationMin ? ", because vigorous minutes count double" : ""}. Short on time? Even 10 minutes moves the bar.`;
    },
    suggestions: ["I only have 15 minutes", "Why 150 minutes?"],
  },
  {
    id: "short-on-time",
    match: (t) => has(t, "only have", "busy", "no time", "short on", "15 min", "10 min", "20 min"),
    reply: (t, ctx) => {
      const mins = Number(t.match(/(\d+)\s*min/)?.[1] ?? 15);
      const picks = ctx.options.flatMap((o) => o.sessions).sort((a, b) => b.credit / b.durationMin - a.credit / a.durationMin);
      const top = picks[0];
      if (!top) return `${mins} minutes still counts. Any brisk activity you enjoy will move the bar.`;
      const { family, variant } = getVariant(top.variantId);
      const credit = mins * multiplierOf(variant.met);
      return `${mins} minutes of ${family.noun} (${variant.label.toLowerCase()}) earns ${credit} guideline minutes. That would leave ${Math.max(0, ctx.week.remainingMinutes - credit)} to go, and I'll re-plan the rest of the week once your Fitbit syncs.`;
    },
    suggestions: ["How am I doing this week?"],
  },
  {
    id: "vigorous-safety",
    match: (t) => has(t, "vigorous", "intense", "harder", "heart", "condition", "safe"),
    reply: (_t, ctx) =>
      ctx.profile.hasHealthCondition
        ? "Because you mentioned a health condition, please check with your clinician before adding vigorous workouts. Until then I'll stick to moderate options, which still count fully toward the goal."
        : "Vigorous activity (6 MET or more, where talking gets hard) counts double, so it's the fastest route when time is tight. Build up gradually, and check with a clinician first if you have a heart condition or other health concern.",
    suggestions: ["What should I do today?"],
  },
  {
    id: "why-150",
    match: (t) => has(t, "why 150", "why", "guideline", "150", "75"),
    reply: () =>
      "The U.S. Physical Activity Guidelines recommend at least 150 minutes of moderate activity, 75 minutes of vigorous activity, or a mix each week. It's linked to lower risk of heart disease, type 2 diabetes and depression. Any amount helps, and more brings extra benefit.",
    suggestions: ["How am I doing this week?"],
  },
  {
    id: "plan",
    match: (t) => has(t, "plan", "schedule", "options", "week"),
    reply: (_t, ctx) =>
      ctx.options.length
        ? `Here's what I'd suggest for the rest of the week: ${planLine(ctx)}. That closes your ${ctx.week.remainingMinutes}-minute gap. The Plan tab has two other ways to do it.`
        : "Pick a couple of activities you enjoy and I'll put a plan together.",
    suggestions: ["What should I do today?"],
  },
  {
    id: "fallback",
    match: () => true,
    reply: (_t, ctx) =>
      `I can help you plan workouts around ${ctx.enjoyedNames.join(" and ") || "what you enjoy"}, check your progress, or tell you how much an activity counts. You have ${ctx.week.remainingMinutes} guideline minutes to go this week.`,
    suggestions: ["How am I doing this week?", "What should I do today?", "Does salsa count?"],
  },
];

export const STARTER_SUGGESTIONS = ["How am I doing this week?", "What should I do today?", "Does salsa count?", "I only have 15 minutes"];

/**
 * One-line explanation shown under each plan option. With a real LLM this
 * would be generated from the option + user context; here it's templated.
 */
export function explainOption(o: import("../lib/planner").PlanOption, ctx: AgentContext): string {
  const vig = o.sessions.find((s) => s.credit > s.durationMin);
  const families = [...new Set(o.sessions.map((s) => getVariant(s.variantId).family.noun))];
  const blocks = o.sessions.length;
  const parts: string[] = [];
  parts.push(`${blocks} short ${blocks === 1 ? "session" : "sessions"} of ${families.join(" and ")}.`);
  if (vig) parts.push(`${getVariant(vig.variantId).variant.label} is vigorous, so every minute counts double.`);
  else parts.push("All moderate, so you can still hold a conversation.");
  if (!o.fits) parts.push(`It needs ${formatDuration(o.clockMinutes - ctx.timeLeftMinutes)} more than you have free.`);
  return parts.join(" ");
}
