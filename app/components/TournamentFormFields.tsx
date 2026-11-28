import { GameDatePicker } from "~/components/GameDateTimePickers";
import { hintClass, inputClass, labelClass } from "~/components/ui";
import { NAME_MAX, NOTES_MAX } from "~/utils/tournaments";

export type TournamentDefaults = { name?: string; startDate?: string; endDate?: string; location?: string | null; notes?: string | null };

const Optional = () => <span className="font-normal text-subtle">(optional)</span>;

export function TournamentFormFields({ defaults = {} }: { defaults?: TournamentDefaults }) {
  return (
    <>
      <div>
        <label htmlFor="name" className={labelClass}>Name</label>
        <input id="name" name="name" required maxLength={NAME_MAX} defaultValue={defaults.name ?? ""} placeholder="Turkey Cup" className={inputClass} />
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-4">
        <div>
          <label htmlFor="startDate" className={labelClass}>First day</label>
          <GameDatePicker id="startDate" name="startDate" required defaultValue={defaults.startDate ?? ""} />
        </div>
        <div>
          <label htmlFor="endDate" className={labelClass}>Last day <Optional /></label>
          <GameDatePicker id="endDate" name="endDate" defaultValue={defaults.endDate ?? ""} />
          <p className={hintClass}>Leave it empty for a one-day tournament.</p>
        </div>
      </div>
      <div>
        <label htmlFor="location" className={labelClass}>Where <Optional /></label>
        <input id="location" name="location" maxLength={200} defaultValue={defaults.location ?? ""} placeholder="Central Park fields" className={inputClass} />
      </div>
      <div>
        <label htmlFor="notes" className={labelClass}>Notes for families <Optional /></label>
        <textarea id="notes" name="notes" rows={3} maxLength={NOTES_MAX} defaultValue={defaults.notes ?? ""} placeholder="Check-in at the HQ tent 45 minutes before the first game." className={inputClass} />
      </div>
    </>
  );
}
