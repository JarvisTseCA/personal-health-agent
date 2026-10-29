/**
 * What to actually do in a session, built from the equipment where the user
 * is exercising today, plus short how-to videos the coach can share.
 *
 * Strength and interval sessions get a circuit of moves (dumbbells at the
 * gym → goblet squats and dumbbell rows; nothing at hand → bodyweight
 * squats and incline push-ups). Other activities get one video for the
 * thing people most often ask about (setting up a spin bike, the salsa
 * basic step, rowing technique).
 *
 * Videos are public YouTube tutorials, chosen in Oct 2026 for being short
 * and beginner-friendly. All allow embedding. The team's clinician should
 * review them before anything beyond the demo.
 */

export interface Video {
  /** YouTube video id */
  id: string;
  title: string;
  channel: string;
  /** "1:06" */
  length: string;
}

export interface Move {
  name: string;
  /** Equipment id it uses, if any */
  uses?: string;
  /** "3 × 10", "30 s on, 30 s off" */
  dose: string;
  video?: Video;
}

export const VIDEOS: Record<string, Video> = {
  "bodyweight-squat": { id: "8uoaYwS6iFM", title: "Squat (Bodyweight)", channel: "IU Health", length: "1:10" },
  "incline-push-up": { id: "Gvm5Q29UHbk", title: "How to do an Incline Push-Up", channel: "National Academy of Sports Medicine (NASM)", length: "0:19" },
  "reverse-lunge": { id: "Ry-wqegeKlE", title: "How To Perform The Reverse Lunge", channel: "Dr. Carl Baird", length: "0:59" },
  plank: { id: "pvIjsG5Svck", title: "Core Exercise: Plank", channel: "Children's Hospital Colorado", length: "1:06" },
  "goblet-squat": { id: "gCESNsDsbqk", title: "Goblet Squats: Proper Form & Technique", channel: "BuiltLean", length: "1:06" },
  "dumbbell-row": { id: "roCP6wCXPqo", title: "How to Perfect Your Dumbbell Row", channel: "Men's Health", length: "3:16" },
  "kettlebell-swing": { id: "cY38L70lxro", title: "How to do a kettlebell swing, for beginners", channel: "Alyssa Kuhn, Arthritis Adventure", length: "1:17" },
  "band-row": { id: "LSkyinhmA8k", title: "How To Do A Resistance Band Row", channel: "Get Healthy U", length: "0:49" },
  burpee: { id: "9yiWAgm3DSU", title: "Beginner Burpees", channel: "Men's Health", length: "1:15" },
  "bike-setup": { id: "UuOCJlwkeXA", title: "How To Set Up Your Bike", channel: "Spinning", length: "3:55" },
  "salsa-basic": { id: "wV8cDpJa2f4", title: "Salsa Basic Step for the Absolute Beginner", channel: "Salsaventura", length: "4:01" },
  "rowing-technique": { id: "4zWu1yuJ0_g", title: "Correct Rowing Machine Technique", channel: "Concept2", length: "1:54" },
};

const m = (name: string, dose: string, video?: keyof typeof VIDEOS, uses?: string): Move => ({ name, dose, uses, video: video ? VIDEOS[video] : undefined });

const BODYWEIGHT: Move[] = [
  m("Bodyweight squat", "3 × 12", "bodyweight-squat"),
  m("Incline push-up", "3 × 8", "incline-push-up"),
  m("Reverse lunge", "3 × 8 each leg", "reverse-lunge"),
  m("Plank", "3 × 30 s", "plank"),
];

/** The first two "lower body" and "pull" slots get the best equipment on hand. */
function loadedCircuit(eq: string[]): Move[] {
  const has = (id: string) => eq.includes(id);
  const squat = has("kettlebell") ? m("Kettlebell goblet squat", "3 × 10", "goblet-squat", "kettlebell")
    : has("dumbbells") ? m("Dumbbell goblet squat", "3 × 10", "goblet-squat", "dumbbells")
    : has("weight-machines") ? m("Leg press", "3 × 10", undefined, "weight-machines")
    : BODYWEIGHT[0];
  const pull = has("dumbbells") ? m("One-arm dumbbell row", "3 × 10 each side", "dumbbell-row", "dumbbells")
    : has("resistance-bands") ? m("Resistance band row", "3 × 12", "band-row", "resistance-bands")
    : has("weight-machines") ? m("Seated cable row", "3 × 10", undefined, "weight-machines")
    : has("kettlebell") ? m("Kettlebell swing", "3 × 12", "kettlebell-swing", "kettlebell")
    : BODYWEIGHT[2];
  const push = has("weight-machines") && !has("dumbbells") ? m("Chest press machine", "3 × 10", undefined, "weight-machines") : BODYWEIGHT[1];
  return [squat, pull, push, BODYWEIGHT[3]];
}

/**
 * The moves for a session, given the equipment where the user is today.
 * Empty when the activity doesn't need a list (a walk, a bike ride).
 */
export function movesFor(variantId: string, equipmentHere: string[] = []): Move[] {
  switch (variantId) {
    case "strength-bodyweight":
      return BODYWEIGHT;
    case "strength-hard":
      return [m("Squat jump", "40 s on, 20 s off"), m("Incline push-up", "40 s on, 20 s off", "incline-push-up"), m("Reverse lunge", "40 s on, 20 s off", "reverse-lunge"), m("Plank", "40 s on, 20 s off", "plank")];
    case "strength-weights":
    case "strength-supersets":
      return loadedCircuit(equipmentHere);
    case "strength-kettlebell":
      return [m("Kettlebell swing", "4 × 15", "kettlebell-swing", "kettlebell"), m("Kettlebell goblet squat", "4 × 10", "goblet-squat", "kettlebell"), m("Reverse lunge", "3 × 8 each leg", "reverse-lunge"), m("Plank", "3 × 30 s", "plank")];
    case "hiit-moderate":
      return [
        equipmentHere.includes("jump-rope") ? m("Jump rope", "30 s on, 30 s off") : m("Bodyweight squat", "30 s on, 30 s off", "bodyweight-squat"),
        m("Incline push-up", "30 s on, 30 s off", "incline-push-up"),
        m("Reverse lunge", "30 s on, 30 s off", "reverse-lunge"),
        m("Plank", "30 s on, 30 s off", "plank"),
      ];
    case "hiit-vigorous":
      return [m("Beginner burpee", "20 s on, 10 s off", "burpee"), m("Squat jump", "20 s on, 10 s off"), m("Mountain climber", "20 s on, 10 s off"), m("Plank", "20 s on, 10 s off", "plank")];
    default:
      return [];
  }
}

/** One how-to video for activities that don't come as a list of moves. */
const SINGLE: Record<string, { what: string; video: Video }> = {
  "cycling-spin": { what: "setting up the bike", video: VIDEOS["bike-setup"] },
  "cycling-stationary": { what: "setting up the bike", video: VIDEOS["bike-setup"] },
  "dancing-salsa": { what: "the salsa basic step", video: VIDEOS["salsa-basic"] },
  "dancing-video": { what: "the salsa basic step", video: VIDEOS["salsa-basic"] },
  "rowing-moderate": { what: "rowing technique", video: VIDEOS["rowing-technique"] },
  "rowing-vigorous": { what: "rowing technique", video: VIDEOS["rowing-technique"] },
};

/** Everything the coach can show a video for in this session, in order. */
export function howTos(variantId: string, equipmentHere: string[] = []): Array<{ what: string; video: Video }> {
  const one = SINGLE[variantId];
  if (one) return [one];
  const seen = new Set<string>();
  return movesFor(variantId, equipmentHere)
    .filter((x) => x.video && !seen.has(x.video.id) && seen.add(x.video.id))
    .map((x) => ({ what: x.name.toLowerCase(), video: x.video! }));
}

export const thumbnailOf = (v: Video) => `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;
export const embedOf = (v: Video) => `https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1&rel=0&modestbranding=1`;
export const watchOf = (v: Video) => `https://www.youtube.com/watch?v=${v.id}`;
