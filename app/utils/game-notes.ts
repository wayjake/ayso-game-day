// games.notes holds a JSON object: the coach's own notes as `text`, plus
// `quarterFormations` saved by the lineup planner. Older or hand-entered values
// may be plain text, so never JSON.parse it directly.

export type GameNotes = {
  text?: string;
  quarterFormations?: Record<string, number>;
  [key: string]: unknown;
};

export function parseGameNotes(raw: string | null | undefined): GameNotes {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // plain text
  }
  return { text: raw };
}

export function serializeGameNotes(notes: GameNotes): string | null {
  const cleaned = Object.fromEntries(
    Object.entries(notes).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
  return Object.keys(cleaned).length > 0 ? JSON.stringify(cleaned) : null;
}

// The coach's notes for display, without the planner's data
export function gameNotesText(raw: string | null | undefined) {
  return parseGameNotes(raw).text ?? "";
}
