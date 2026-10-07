import { GameDatePicker, GameTimePicker } from "~/components/GameDateTimePickers";

// The fields shared by the new-game and edit-game forms

export type GameFormDefaults = {
  opponent?: string | null;
  gameDate?: string;
  gameTime?: string | null;
  field?: string | null;
  homeAway?: "home" | "away" | null;
  notesText?: string;
};

type GameFormValues = {
  opponent: string;
  gameDate: string;
  gameTime: string | null;
  field: string | null;
  homeAway: "home" | "away";
};

// Reads and validates the fields for an action. Notes come back separately
// because they're merged into the JSON in games.notes (see game-notes.ts).
export function readGameForm(
  formData: FormData
): { error: string } | { values: GameFormValues; notesText: string } {
  const text = (key: string) => ((formData.get(key) as string | null) ?? "").trim();
  const opponent = text("opponent");
  const gameDate = text("gameDate");
  const gameTime = text("gameTime");
  const homeAway = text("homeAway");

  if (!opponent) return { error: "Opponent is required" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(gameDate)) return { error: "Game date is required" };
  if (gameTime && !/^\d{2}:\d{2}$/.test(gameTime)) return { error: "Game time must look like 09:30" };
  if (homeAway !== "home" && homeAway !== "away") return { error: "Home/Away selection is required" };

  return {
    values: {
      opponent,
      gameDate,
      gameTime: gameTime || null,
      field: text("field") || null,
      homeAway,
    },
    notesText: text("notes"),
  };
}

export function GameFormFields({ defaults = {} }: { defaults?: GameFormDefaults }) {
  return (
    <>
      {/* Opponent */}
      <div>
        <label htmlFor="opponent" className="block text-sm font-medium mb-1">
          Opponent Team <span className="text-red-500">*</span>
        </label>
        <input
          id="opponent"
          name="opponent"
          type="text"
          required
          defaultValue={defaults.opponent ?? ""}
          className="w-full rounded border border-[var(--border)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
          placeholder="e.g., Eagles, Lions, Sharks"
        />
      </div>
      
      {/* Game date and time */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor="gameDate" className="block text-sm font-medium mb-1">
            Game Date <span className="text-red-500">*</span>
          </label>
          <GameDatePicker id="gameDate" name="gameDate" required defaultValue={defaults.gameDate ?? ""} />
        </div>
        
        <div>
          <label htmlFor="gameTime" className="block text-sm font-medium mb-1">
            Game Time (Optional)
          </label>
          <GameTimePicker id="gameTime" name="gameTime" defaultValue={defaults.gameTime ?? ""} />
        </div>
      </div>
      
      {/* Home/Away */}
      <div>
        <label className="block text-sm font-medium mb-3">
          Home or Away Game <span className="text-red-500">*</span>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex items-center gap-2 p-3 border border-[var(--border)] rounded hover:bg-[var(--bg)] cursor-pointer transition">
            <input
              type="radio"
              name="homeAway"
              value="home"
              required
              defaultChecked={defaults.homeAway === "home"}
              className="border-[var(--border)] text-[var(--primary)] focus:ring-[var(--primary)]"
            />
            <span className="text-sm font-medium">🏠 Home Game</span>
          </label>
          <label className="flex items-center gap-2 p-3 border border-[var(--border)] rounded hover:bg-[var(--bg)] cursor-pointer transition">
            <input
              type="radio"
              name="homeAway"
              value="away"
              required
              defaultChecked={defaults.homeAway === "away"}
              className="border-[var(--border)] text-[var(--primary)] focus:ring-[var(--primary)]"
            />
            <span className="text-sm font-medium">✈️ Away Game</span>
          </label>
        </div>
      </div>
      
      {/* Field */}
      <div>
        <label htmlFor="field" className="block text-sm font-medium mb-1">
          Field/Location (Optional)
        </label>
        <input
          id="field"
          name="field"
          type="text"
          defaultValue={defaults.field ?? ""}
          className="w-full rounded border border-[var(--border)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
          placeholder="e.g., Field 1, Central Park, Away Team Field"
        />
      </div>
      
      {/* Notes */}
      <div>
        <label htmlFor="notes" className="block text-sm font-medium mb-1">
          Game Notes (Optional)
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={defaults.notesText ?? ""}
          className="w-full rounded border border-[var(--border)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
          placeholder="e.g., Bring extra water, early warm-up, tournament game"
        />
        <p className="text-xs text-[var(--muted)] mt-1">
          Add any special instructions or reminders for this game
        </p>
      </div>
      
    </>
  );
}
