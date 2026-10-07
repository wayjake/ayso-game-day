import { AirplaneTilt, House } from "@phosphor-icons/react";
import { GameDatePicker, GameTimePicker } from "~/components/GameDateTimePickers";
import { hintClass, inputClass, labelClass } from "~/components/ui";

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

const Required = () => (
  <span className="text-danger" aria-hidden="true">
    *
  </span>
);

const Optional = () => <span className="font-normal text-subtle">(optional)</span>;

const choiceClass =
  "flex min-h-12 cursor-pointer items-center gap-2.5 rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm font-medium transition hover:bg-surface-2 has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:checked]:text-primary-ink has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/30";

export function GameFormFields({ defaults = {} }: { defaults?: GameFormDefaults }) {
  return (
    <>
      {/* Opponent */}
      <div>
        <label htmlFor="opponent" className={labelClass}>
          Opponent <Required />
        </label>
        <input
          id="opponent"
          name="opponent"
          type="text"
          required
          defaultValue={defaults.opponent ?? ""}
          className={inputClass}
          placeholder="e.g. Eagles, Lions, Sharks"
        />
      </div>

      {/* Game date and time */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-4">
        <div>
          <label htmlFor="gameDate" className={labelClass}>
            Game date <Required />
          </label>
          <GameDatePicker id="gameDate" name="gameDate" required defaultValue={defaults.gameDate ?? ""} />
        </div>

        <div>
          <label htmlFor="gameTime" className={labelClass}>
            Game time <Optional />
          </label>
          <GameTimePicker id="gameTime" name="gameTime" defaultValue={defaults.gameTime ?? ""} />
        </div>
      </div>

      {/* Home/Away */}
      <fieldset>
        <legend className={labelClass}>
          Home or away <Required />
        </legend>
        <div className="grid grid-cols-2 gap-3">
          <label className={choiceClass}>
            <input
              type="radio"
              name="homeAway"
              value="home"
              required
              defaultChecked={defaults.homeAway === "home"}
              className="h-4 w-4 accent-primary"
            />
            <House size={18} />
            Home
          </label>
          <label className={choiceClass}>
            <input
              type="radio"
              name="homeAway"
              value="away"
              required
              defaultChecked={defaults.homeAway === "away"}
              className="h-4 w-4 accent-primary"
            />
            <AirplaneTilt size={18} />
            Away
          </label>
        </div>
      </fieldset>

      {/* Field */}
      <div>
        <label htmlFor="field" className={labelClass}>
          Field or location <Optional />
        </label>
        <input
          id="field"
          name="field"
          type="text"
          defaultValue={defaults.field ?? ""}
          className={inputClass}
          placeholder="e.g. Field 1, Central Park, away team's field"
        />
      </div>

      {/* Notes */}
      <div>
        <label htmlFor="notes" className={labelClass}>
          Notes <Optional />
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={defaults.notesText ?? ""}
          className={inputClass}
          placeholder="e.g. Bring extra water, early warm-up, tournament game"
          aria-describedby="notes-hint"
        />
        <p id="notes-hint" className={hintClass}>
          Special instructions or reminders for this game.
        </p>
      </div>
    </>
  );
}
