/**
 * Pre-written coach replies for the Coach tab (free-form questions).
 *
 * Each entry has keyword triggers and a template that fills in the user's
 * real numbers from the AgentContext. The first entry whose `match` returns
 * true wins; the last is the fallback. Edit freely: this file is the demo
 * script. Short answers to the one-tap questions live in answers.ts.
 */
import { getVariant, searchFamilies } from "../lib/activities";
import { creditFor, fmt, fmtGoal, intensityOf } from "../lib/met";
import { answer } from "./answers";
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

export const SCRIPTED_REPLIES: ScriptedReply[] = [
  {
    id: "safety",
    match: (t) => has(t, "chest", "dizzy", "faint", "pain", "hurt", "injur", "breath", "knee", "sore"),
    reply: () =>
      "That's worth taking seriously. Please stop exercising and check in with a clinician before your next workout, and seek urgent care if symptoms are severe. I'll keep suggestions gentle and skip vigorous activity until you've been cleared.",
    suggestions: ["How am I doing this week?"],
  },
  {
    id: "met",
    match: (t) => has(t, "what is met", "what's a met", "what is a met", "mets", " met?", "met-hour", "met hour"),
    reply: (_t, ctx) => answer("met", ctx, ctx.state.today.accepted ?? ctx.state.today.current?.lead),
    suggestions: ["Why is my goal 7.5?", "Does dancing count?"],
  },
  {
    id: "goal",
    match: (t) => has(t, "7.5", "why my goal", "goal", "guideline", "150"),
    reply: (_t, ctx) => answer("goal", ctx),
    suggestions: ["How am I doing this week?"],
  },
  {
    id: "medals",
    match: (t) => has(t, "medal", "streak", "gold", "silver", "bronze"),
    reply: (_t, ctx) => `${answer("medals", ctx)} You're on a ${ctx.streak.current}-day streak${ctx.streak.todayPending ? "; any activity today keeps it going" : ""}.`,
    suggestions: ["What should I do today?"],
  },
  {
    id: "progress",
    match: (t) => has(t, "how am i", "progress", "doing", "so far", "status", "where am i"),
    reply: (_t, ctx) =>
      ctx.left <= 0
        ? `You've reached ${fmt(ctx.week.done)} of ${fmtGoal(ctx.goal)} MET-hours, so this week is gold. Anything else is a bonus.`
        : `You're at ${fmt(ctx.week.done)} of ${fmtGoal(ctx.goal)} MET-hours this week, with ${fmt(ctx.left)} to go. Today's target is ${fmt(ctx.todayTarget)}, and you're on a ${ctx.streak.current}-day streak.`,
    suggestions: ["What should I do today?", "Does dancing count?"],
  },
  {
    id: "does-it-count",
    match: (t) => has(t, "count", "worth") || (/^(does|is|do) /.test(t) && !!mentionedFamily(t)),
    reply: (t) => {
      const fam = mentionedFamily(t);
      if (!fam) return "Almost anything that gets you moving counts. Tell me the activity and I'll show you the conversion; for example, 30 minutes of brisk walking earns 2.4 MET-hours.";
      const lines = fam.variants.map((v) => {
        const c = creditFor(v.met, 30);
        return c > 0 ? `${v.label.toLowerCase()} (${v.met} MET) earns ${fmt(c)}` : `${v.label.toLowerCase()} (${v.met} MET) is light: a medal, not goal credit`;
      });
      return `Yes. For 30 minutes of ${fam.noun}: ${lines.join("; ")}.`;
    },
    suggestions: ["What's a MET?"],
  },
  {
    id: "today",
    match: (t) => has(t, "today", "now", "tonight", "what should", "next"),
    reply: (_t, ctx) => {
      const s = ctx.state.today.accepted ?? ctx.state.today.current?.lead;
      if (!s) return "Head to the Today tab and answer three quick questions; I'll hand you one workout that fits.";
      const { family, variant } = getVariant(s.variantId);
      return `Today's pick is ${s.durationMin} min of ${family.noun} (${variant.label.toLowerCase()}, ${intensityOf(variant.met)}). That's ${fmt(s.credit)} MET-hours toward today's ${fmt(ctx.todayTarget)}.`;
    },
    suggestions: ["Why this activity?", "I only have 10 minutes"],
  },
  {
    id: "why-this",
    match: (t) => has(t, "why this", "why did you", "why that"),
    reply: (_t, ctx) => answer("why", ctx, ctx.state.today.accepted ?? ctx.state.today.current?.lead),
    suggestions: ["How did you calculate this?"],
  },
  {
    id: "how-calc",
    match: (t) => has(t, "calculat", "how did you", "math"),
    reply: (_t, ctx) => answer("how", ctx, ctx.state.today.accepted ?? ctx.state.today.current?.lead),
    suggestions: ["What's a MET?"],
  },
  {
    id: "short-on-time",
    match: (t) => has(t, "only have", "busy", "no time", "short on", "10 min", "15 min", "5 min"),
    reply: () => "Short still counts. On the Today tab, pick 10 min (or 0 min if you're stuck at your desk) and I'll find something that fits. Every day you move earns at least a bronze.",
    suggestions: ["How do medals work?"],
  },
  {
    id: "fallback",
    match: () => true,
    reply: (_t, ctx) =>
      `I can tell you what to do today, explain how an activity counts, or check your progress. You have ${fmt(ctx.left)} MET-hours to go this week.`,
    suggestions: ["How am I doing this week?", "What's a MET?", "Does salsa count?"],
  },
];

export const STARTER_SUGGESTIONS = ["How am I doing this week?", "What's a MET?", "Why is my goal 7.5?", "Does salsa count?"];
