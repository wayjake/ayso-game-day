import { forwardRef, useMemo, useState } from "react";
import { Form, useNavigation } from "react-router";
import { Check, ChatCircleText, MagnifyingGlass, UsersThree, X } from "@phosphor-icons/react";
import { StaffBadge } from "~/components/StaffBadge";
import { Button, cx, inputClass } from "~/components/ui";
import { MAX_GROUP_NAME, opensPrivateThread, type PickerOption } from "~/utils/groups";

// A searchable checklist of the team's staff and families. Pick one person for
// a private thread, or several for a group chat.

type ListProps = {
  options: PickerOption[];
  selected: string[];
  onToggle: (key: string) => void;
  /** Height cap for the scrolling list */
  maxHeightClass?: string;
};

export const PeopleChecklist = forwardRef<HTMLInputElement, ListProps>(function PeopleChecklist(
  { options, selected, onToggle, maxHeightClass = "max-h-72" },
  searchRef
) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => `${o.name} ${o.detail}`.toLowerCase().includes(q)) : options;
  const staff = shown.filter((o) => o.kind === "staff");
  const families = shown.filter((o) => o.kind === "family");
  const byKey = useMemo(() => new Map(options.map((o) => [o.key, o])), [options]);

  const row = (o: PickerOption) => {
    const on = selected.includes(o.key);
    return (
      <li key={o.key}>
        <label className={cx("flex cursor-pointer items-center gap-3 px-3 py-2.5 transition", on ? "bg-primary-soft" : "hover:bg-surface-2")}>
          <input type="checkbox" className="sr-only" checked={on} onChange={() => onToggle(o.key)} />
          <span
            aria-hidden
            className={cx(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded-md ring-1 transition",
              on ? "bg-primary text-white ring-primary" : "bg-surface ring-line-strong"
            )}
          >
            {on && <Check size={13} weight="bold" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-semibold">{o.name}</span>
              {o.role && <StaffBadge role={o.role} short />}
            </span>
            {(o.detail || (o.kind === "family" && !o.onApp)) && (
              <span className="block truncate text-xs text-muted">
                {o.detail}
                {o.kind === "family" && !o.onApp ? `${o.detail ? " · " : ""}not on the app yet` : ""}
              </span>
            )}
          </span>
        </label>
      </li>
    );
  };

  return (
    <div>
      {selected.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Picked">
          {selected.map((key) => {
            const o = byKey.get(key);
            if (!o) return null;
            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => onToggle(key)}
                  className="inline-flex h-7 items-center gap-1 rounded-full bg-primary-soft pr-2 pl-3 text-xs font-semibold text-primary hover:brightness-95"
                  aria-label={`Remove ${o.name}`}
                >
                  {o.name.split(" ")[0]}
                  <X size={12} weight="bold" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="relative">
        <MagnifyingGlass size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-subtle" />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search families, kids or staff"
          aria-label="Search people"
          className={cx(inputClass, "pl-9")}
        />
      </div>
      <div className={cx("mt-2 overflow-y-auto rounded-xl ring-1 ring-line", maxHeightClass)}>
        {shown.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted">{q ? "Nobody by that name" : "Nobody to add"}</p>
        ) : (
          <>
            {staff.length > 0 && (
              <>
                <p className="sticky top-0 z-10 bg-surface-2 px-3 py-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">Staff</p>
                <ul className="divide-y divide-line">{staff.map(row)}</ul>
              </>
            )}
            {families.length > 0 && (
              <>
                <p className="sticky top-0 z-10 bg-surface-2 px-3 py-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">Families</p>
                <ul className="divide-y divide-line">{families.map(row)}</ul>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
});

/**
 * The New message form: pick people, optionally name it, open. Posts
 * `_action=start` with each picked `key` and `name`.
 */
type FormProps = {
  options: PickerOption[];
  side: "coach" | "parent";
  error?: string | null;
  /** Extra fields to post, such as the team */
  hidden?: Record<string, string | number>;
};

export const NewMessageForm = forwardRef<HTMLInputElement, FormProps>(
  function NewMessageForm({ options, side, error, hidden }, searchRef) {
    const [selected, setSelected] = useState<string[]>([]);
    const [name, setName] = useState("");
    const navigation = useNavigation();
    const busy = navigation.state !== "idle" && navigation.formData?.get("_action") === "start";
    const picked = selected.flatMap((k) => options.filter((o) => o.key === k));
    const direct = opensPrivateThread(side, picked, name);
    const group = picked.length > 1 || (picked.length === 1 && !direct);
    const pendingPicked = picked.some((o) => o.kind === "family" && !o.onApp);
    const toggle = (key: string) => setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));

    return (
      <Form method="post">
        <input type="hidden" name="_action" value="start" />
        {Object.entries(hidden ?? {}).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        {selected.map((k) => (
          <input key={k} type="hidden" name="key" value={k} />
        ))}
        <PeopleChecklist ref={searchRef} options={options} selected={selected} onToggle={toggle} />

        {group && (
          <div className="mt-3">
            <label htmlFor="group-name" className="mb-1.5 block text-sm font-medium text-ink">
              Group name <span className="font-normal text-muted">(optional)</span>
            </label>
            <input
              id="group-name"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={MAX_GROUP_NAME}
              placeholder="Carpool, Snack schedule, …"
              className={inputClass}
            />
          </div>
        )}

        {group && (
          <p className="mt-2 text-xs text-muted">
            Only the people in a group can see it.
            {pendingPicked ? " Families not on the app yet see it once they join." : ""}
          </p>
        )}
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}

        <Button type="submit" className="mt-3 w-full sm:w-auto" disabled={picked.length === 0 || busy}>
          {direct ? <ChatCircleText size={18} /> : <UsersThree size={18} />}
          {picked.length === 0 ? "Pick who to message" : direct ? `Message ${picked[0].name.split(" ")[0]}` : "Start group chat"}
        </Button>
        {side === "coach" && direct && picked[0] && !picked[0].onApp && (
          <p className="mt-2 text-xs text-muted">They're not on the app yet: they get your messages by email and can reply by email.</p>
        )}
      </Form>
    );
  }
);
