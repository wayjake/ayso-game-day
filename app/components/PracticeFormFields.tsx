import { GameTimePicker } from "~/components/GameDateTimePickers";
import { inputClass, labelClass } from "~/components/ui";

// Time, place and notes shared by the new-practice and edit-practice forms.
// The date field differs (one date vs. a weekly range), so each form owns it.

export type PracticeDetails = {
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  notes: string | null;
};

export function readPracticeDetails(formData: FormData): { error: string } | { values: PracticeDetails } {
  const text = (key: string) => ((formData.get(key) as string | null) ?? "").trim();
  const startTime = text("startTime");
  const endTime = text("endTime");
  if (startTime && !/^\d{2}:\d{2}$/.test(startTime)) return { error: "Start time must look like 17:30" };
  if (endTime && !/^\d{2}:\d{2}$/.test(endTime)) return { error: "End time must look like 19:00" };
  if (endTime && !startTime) return { error: "Add a start time too" };
  if (startTime && endTime && endTime <= startTime) return { error: "End time must be after the start time" };
  return {
    values: {
      startTime: startTime || null,
      endTime: endTime || null,
      location: text("location").slice(0, 200) || null,
      notes: text("notes").slice(0, 1000) || null,
    },
  };
}

const Optional = () => <span className="font-normal text-subtle">(optional)</span>;

export function PracticeDetailFields({ defaults }: { defaults?: Partial<PracticeDetails> }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="startTime" className={labelClass}>Starts</label>
          <GameTimePicker id="startTime" name="startTime" defaultValue={defaults?.startTime ?? ""} />
        </div>
        <div>
          <label htmlFor="endTime" className={labelClass}>Ends <Optional /></label>
          <GameTimePicker id="endTime" name="endTime" defaultValue={defaults?.endTime ?? ""} />
        </div>
      </div>

      <div>
        <label htmlFor="location" className={labelClass}>Field or location</label>
        <input
          id="location"
          name="location"
          type="text"
          maxLength={200}
          defaultValue={defaults?.location ?? ""}
          className={inputClass}
          placeholder="e.g. Hart Park, Field 3"
        />
      </div>

      <div>
        <label htmlFor="notes" className={labelClass}>Notes for families <Optional /></label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          maxLength={1000}
          defaultValue={defaults?.notes ?? ""}
          className={inputClass}
          placeholder="Bring shin guards and a full water bottle"
        />
      </div>
    </>
  );
}
