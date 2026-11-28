// Jobs on events (snacks, setting up the goals): the words and the form rules,
// shared by the server and the pages. Pure, unit tested.

export const JOB_TIMINGS = ["before", "during", "after"] as const;
export type JobTiming = (typeof JOB_TIMINGS)[number];
export const JOB_MODES = ["volunteer", "assigned"] as const;
export type JobMode = (typeof JOB_MODES)[number];

export const TITLE_MAX = 80;
export const DETAILS_MAX = 300;
export const SPOTS_MAX = 20;

export type JobHolder = {
  signupId: string;
  kind: "family" | "staff";
  label: string; // "Mia & Leo's family", or the staff member's name
  playerId: string | null;
  userId: string | null;
};

export type JobView = {
  id: string;
  eventType: "game" | "practice";
  eventId: string;
  title: string;
  details: string | null;
  timing: JobTiming | null;
  mode: JobMode;
  spots: number;
  holders: JobHolder[];
};

// "before the game", "during practice"
export function timingPhrase(timing: JobTiming | null, eventType: "game" | "practice") {
  if (!timing) return null;
  return `${timing} ${eventType === "game" ? "the game" : "practice"}`;
}

export const TIMING_LABELS: Record<JobTiming, string> = { before: "Before", during: "During", after: "After" };

// "Dev's family", "Mia & Leo's family", "Ava, Mia & Leo's family"
export function familyLabel(firstNames: string[]) {
  const names = [...new Set(firstNames.filter(Boolean))];
  if (names.length === 0) return "A family";
  const joined = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
  return `${joined}${joined.endsWith("s") ? "'" : "'s"} family`;
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

export const openSpots = (job: { spots: number; holders: unknown[] }) => Math.max(0, job.spots - job.holders.length);

type FormLike = { get(name: string): unknown };

export type JobFields = { title: string; details: string | null; timing: JobTiming | null; mode: JobMode; spots: number };

// What staff typed in the job form, or what's wrong with it
export function readJobForm(form: FormLike): { error: string } | { values: JobFields } {
  const text = (name: string) => {
    const v = form.get(name);
    return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  };
  const title = text("title");
  if (!title) return { error: "Give the job a name, like Snacks." };
  if (title.length > TITLE_MAX) return { error: `Keep the name under ${TITLE_MAX} characters.` };
  const details = text("details").slice(0, DETAILS_MAX) || null;
  const timing = text("timing");
  const mode = text("mode");
  const spots = Number(text("spots") || "1");
  if (!Number.isInteger(spots) || spots < 1 || spots > SPOTS_MAX) return { error: `How many it needs: 1 to ${SPOTS_MAX}.` };
  return {
    values: {
      title,
      details,
      timing: (JOB_TIMINGS as readonly string[]).includes(timing) ? (timing as JobTiming) : null,
      mode: mode === "assigned" ? "assigned" : "volunteer",
      spots,
    },
  };
}
