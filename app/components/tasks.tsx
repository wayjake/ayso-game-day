import { useState } from "react";
import { Form } from "react-router";
import { Check, CheckCircle, Circle, Clock } from "@phosphor-icons/react";
import { Badge, Button, Card, cx, hintClass, inputClass, labelClass } from "~/components/ui";
import { MAX_TASK_DETAILS, MAX_TASK_TITLE, dueLabel, type TaskState } from "~/utils/tasks";

// Shared pieces of the Tasks pages: the create/edit form and the status marks.

export type TaskFormValues = {
  title: string;
  details: string | null;
  link: string | null;
  dueDate: string | null;
  perFamily: boolean;
  coachConfirms: boolean;
};

export function TaskForm({
  values,
  players,
  submitLabel,
  busy,
  error,
}: {
  values?: TaskFormValues;
  /** Who it goes to; only when creating */
  players?: { id: number; name: string }[];
  submitLabel: string;
  busy: boolean;
  error?: string;
}) {
  const [everyone, setEveryone] = useState(true);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  return (
    <Form method="post" className="space-y-6">
      {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      <Card className="space-y-4 p-5">
        <div>
          <label htmlFor="title" className={labelClass}>What families need to do</label>
          <input
            id="title"
            name="title"
            required
            maxLength={MAX_TASK_TITLE}
            defaultValue={values?.title}
            className={inputClass}
            placeholder="Pay the $85 uniform fee"
          />
        </div>
        <div>
          <label htmlFor="details" className={labelClass}>
            Details <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id="details"
            name="details"
            rows={3}
            maxLength={MAX_TASK_DETAILS}
            defaultValue={values?.details ?? ""}
            className={cx(inputClass, "h-auto min-h-20 py-2.5 leading-relaxed")}
            placeholder="Venmo @thunder-u10 or cash at practice"
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="link" className={labelClass}>
              Link <span className="font-normal text-muted">(optional)</span>
            </label>
            <input
              id="link"
              name="link"
              type="text"
              inputMode="url"
              autoCapitalize="off"
              spellCheck={false}
              defaultValue={values?.link ?? ""}
              className={inputClass}
              placeholder="https://"
            />
            <p className={hintClass}>A payment page or the form to sign.</p>
          </div>
          <div>
            <label htmlFor="dueDate" className={labelClass}>
              Due <span className="font-normal text-muted">(optional)</span>
            </label>
            <input id="dueDate" name="dueDate" type="date" defaultValue={values?.dueDate ?? ""} className={inputClass} />
          </div>
        </div>
      </Card>

      <Card className="space-y-3 p-5">
        <OptionToggle
          name="perFamily"
          defaultChecked={values?.perFamily ?? false}
          title="Once per family"
          hint="Siblings share it: checking it for one kid checks it for all of them. Leave off for things each player needs, like a fee per player."
        />
        <OptionToggle
          name="coachConfirms"
          defaultChecked={values?.coachConfirms ?? false}
          title="A coach confirms it"
          hint="It only counts as done once a coach checks it, e.g. after the payment arrives. Coaches can confirm any task either way."
        />
      </Card>

      {players && (
        <Card className="p-5">
          <p className={labelClass}>Who it's for</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Who it's for">
            {[
              { value: true, label: "Everyone", count: players.length },
              { value: false, label: "Pick players", count: picked.size },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                role="radio"
                aria-checked={everyone === o.value}
                onClick={() => setEveryone(o.value)}
                className={cx(
                  "inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold ring-1 transition",
                  everyone === o.value ? "bg-primary text-white ring-primary" : "bg-surface text-ink ring-line-strong hover:bg-surface-2"
                )}
              >
                {o.label}
                <span className={cx("tabular", everyone === o.value ? "text-white/80" : "text-muted")}>{o.count}</span>
              </button>
            ))}
          </div>
          <input type="hidden" name="everyone" value={everyone ? "1" : "0"} />
          {everyone ? (
            <p className={hintClass}>Players you add to the roster later get it too.</p>
          ) : (
            <PlayerPicker players={players} picked={picked} onChange={setPicked} />
          )}
        </Card>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={busy || (players && !everyone && picked.size === 0)}>
          <Check size={18} weight="bold" />
          {busy ? "Saving…" : submitLabel}
        </Button>
      </div>
    </Form>
  );
}

export function PlayerPicker({
  players,
  picked,
  onChange,
}: {
  players: { id: number; name: string }[];
  picked: Set<number>;
  onChange: (next: Set<number>) => void;
}) {
  return (
    <ul className="mt-4 max-h-72 divide-y divide-line overflow-y-auto rounded-xl ring-1 ring-line">
      {players.map((p) => (
        <li key={p.id}>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-surface-2">
            <input
              type="checkbox"
              name="playerId"
              value={p.id}
              className="h-4 w-4 accent-[var(--color-primary)]"
              checked={picked.has(p.id)}
              onChange={(e) => {
                const next = new Set(picked);
                if (e.target.checked) next.add(p.id);
                else next.delete(p.id);
                onChange(next);
              }}
            />
            <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

function OptionToggle({ name, defaultChecked, title, hint }: { name: string; defaultChecked: boolean; title: string; hint: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 ring-line transition hover:bg-surface-2 has-[:checked]:bg-primary-soft has-[:checked]:ring-primary">
      <input type="checkbox" name={name} value="1" defaultChecked={defaultChecked} className="mt-1 h-4 w-4 accent-[var(--color-primary)]" />
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-sm text-muted">{hint}</span>
      </span>
    </label>
  );
}

// One player's status on one task, as an icon
export function StatusMark({ state, confirmed, size = 20 }: { state: TaskState | null; confirmed?: boolean; size?: number }) {
  if (state === null) return <span className="text-subtle" aria-hidden>–</span>;
  // Filled when a coach confirmed it, outlined when only the family checked it
  if (state === "done" && confirmed) return <CheckCircle size={size} weight="fill" className="text-success" />;
  if (state === "done") return <CheckCircle size={size} weight="bold" className="text-success" />;
  if (state === "waiting") return <Clock size={size} weight="fill" className="text-warning" />;
  return <Circle size={size} className="text-line-strong" />;
}

export function statusText(state: TaskState, confirmed: boolean, via?: string | null) {
  if (state === "done" && confirmed) return via === "coach" ? "Done (checked by a coach)" : "Done and confirmed";
  if (state === "done") return "Done by the family";
  if (state === "waiting") return "Family says done, needs a coach to confirm";
  return "Not done";
}

export function TaskMeta({
  dueDate,
  today,
  perFamily,
  coachConfirms,
}: {
  dueDate: string | null;
  today: string;
  perFamily: boolean;
  coachConfirms: boolean;
}) {
  const due = dueLabel(dueDate, today);
  if (!due && !perFamily && !coachConfirms) return null;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {due && <Badge tone={due.overdue ? "danger" : "neutral"}>{due.text}</Badge>}
      {perFamily && <Badge>Per family</Badge>}
      {coachConfirms && <Badge tone="primary">Coach confirms</Badge>}
    </span>
  );
}

export function readTaskForm(formData: FormData) {
  return {
    title: String(formData.get("title") ?? ""),
    details: String(formData.get("details") ?? ""),
    link: String(formData.get("link") ?? ""),
    dueDate: String(formData.get("dueDate") ?? ""),
    perFamily: formData.get("perFamily") === "1",
    coachConfirms: formData.get("coachConfirms") === "1",
  };
}
