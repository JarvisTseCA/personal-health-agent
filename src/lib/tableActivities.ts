/**
 * Activities from the activity table (activity_tables/…csv), as the backend suggests them.
 *
 * The app's own library has 15 activity families. When Today's suggestions come from the table
 * (VITE_SUGGEST_SOURCE=table), each row the backend returns becomes a one-variant family with the
 * id "table-<code>", registered so getFamily / getVariant find it. Everything that looks
 * activities up (the card, MET-hours, sessions, Progress, the verifier) keeps working, and the rows
 * are saved with the app state so a reload still knows today's pick and past sessions.
 */
import { libraryVariantByCode, onUnknownActivity, registerActivities, type ActivityFamily, type ActivityKind } from "./activities";
import { tableRow } from "./tableMatch";
import { categoryOfCode } from "./categories";

export type TablePlace = "gym" | "home" | "outside";

/** One row of the table, as POST /api/suggest/table returns it. */
export interface TableActivity {
  code: string;
  /** The table's major_heading, e.g. "Bicycling" */
  heading: string;
  description: string;
  /** The description up to its effort level, e.g. "Bicycling, stationary, 60 watts" */
  label: string;
  met: number;
  places: TablePlace[];
}

const PREFIX = "table-";
export const tableId = (code: string) => `${PREFIX}${code}`;
export const isTableId = (id: string) => id.startsWith(PREFIX);
export const codeOfTableId = (id: string) => id.slice(PREFIX.length);

/** One color per category, so table picks read apart on the card and on Progress. */
const COLOR: Record<string, string> = {
  Bicycling: "#2F8F7A", "Conditioning Exercise": "#6A5AE0", Dancing: "#B4469E", Running: "#E0457B",
  Sports: "#D98A1C", Walking: "#4F7C6B", "Water Activities": "#2A9BB8", "Winter Activities": "#3D5A80",
  "Video Games": "#C8642B",
};

/** The broad kind, used for variety ("a different type") and the clinician's "add strength days". */
function kindOf(row: TableActivity): ActivityKind {
  const d = row.description.toLowerCase();
  switch (row.heading) {
    case "Dancing": return "dance";
    case "Sports": return "sport";
    case "Water Activities": return "water";
    case "Conditioning Exercise":
      if (/yoga|pilates|stretch|tai chi/.test(d)) return "mind-body";
      if (/resistance|weight|strength|calisthenics|kettlebell|body weight|circuit/.test(d)) return "strength";
      return "cardio";
    default: return "cardio";
  }
}

const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

/** The library family for one table row: one variant, the row itself. */
export function tableFamily(row: TableActivity): ActivityFamily {
  const id = tableId(row.code);
  return {
    id,
    name: row.label,
    noun: lowerFirst(row.label),
    color: COLOR[row.heading] ?? "#8C89A6",
    kind: kindOf(row),
    // Done only outside → outdoor; anything that can be done at the gym or at home counts as indoor.
    setting: row.places.includes("gym") || row.places.includes("home") ? "indoor" : "outdoor",
    variants: [{ id, label: row.label, code: row.code, met: row.met, description: row.description }],
  };
}

// An activity-table id nobody registered yet is looked up in the table bundled with the app.
onUnknownActivity((id) => {
  if (!isTableId(id)) return false;
  const row = tableRow(codeOfTableId(id));
  if (!row) return false;
  registerTable([row]);
  return true;
});

/** Make these rows known to getFamily / getVariant. Safe to call again with the same rows. */
export function registerTable(rows: Iterable<TableActivity>): void {
  registerActivities([...rows].map(tableFamily));
}

/** The table's category of an activity id, for table ids ("table-01216" → "Bicycling"). */
export function tableHeading(id: string): string | undefined {
  return isTableId(id) ? categoryOfCode(codeOfTableId(id)) : undefined;
}

/**
 * For "Show me how" and circuits: a table row with the same Compendium code as a library
 * activity uses that activity's how-to. Any other id is returned as it is.
 */
export function howToId(variantId: string): string {
  if (!isTableId(variantId)) return variantId;
  return libraryVariantByCode(codeOfTableId(variantId))?.id ?? variantId;
}
