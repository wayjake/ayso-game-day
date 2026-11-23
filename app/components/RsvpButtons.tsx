import { useFetcher } from "react-router";
import { Check, Question, X } from "@phosphor-icons/react";
import { cx } from "~/components/ui";
import { RSVP_LABELS, type RsvpStatus } from "~/utils/schedule";

// Going / Maybe / Can't go for one player and one event. Posts `_action=rsvp`
// to the current route and shows the new answer right away.

const options: { status: RsvpStatus; icon: typeof Check; active: string }[] = [
  { status: "yes", icon: Check, active: "bg-success text-white ring-success" },
  { status: "maybe", icon: Question, active: "bg-warning text-white ring-warning" },
  { status: "no", icon: X, active: "bg-danger text-white ring-danger" },
];

export function RsvpButtons({
  playerId,
  eventType,
  eventId,
  status,
  label,
  disabled,
  size = "md",
}: {
  playerId: number;
  eventType: "game" | "practice";
  eventId: number;
  status: RsvpStatus | null;
  label: string; // For screen readers: "Ricardo"
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  const fetcher = useFetcher();
  const optimistic = fetcher.formData ? (fetcher.formData.get("status") as RsvpStatus) : status;

  return (
    <fetcher.Form method="post" className="contents">
      <input type="hidden" name="_action" value="rsvp" />
      <input type="hidden" name="playerId" value={playerId} />
      <input type="hidden" name="eventType" value={eventType} />
      <input type="hidden" name="eventId" value={eventId} />
      <div role="group" aria-label={`RSVP for ${label}`} className="grid grid-cols-3 gap-1.5">
        {options.map(({ status: value, icon: Icon, active }) => {
          const selected = optimistic === value;
          return (
            <button
              key={value}
              type="submit"
              name="status"
              value={value}
              disabled={disabled}
              aria-pressed={selected}
              className={cx(
                "flex items-center justify-center gap-1.5 rounded-lg font-semibold ring-1 transition active:translate-y-px disabled:opacity-50",
                size === "sm" ? "h-9 px-2 text-xs" : "h-11 px-2 text-sm",
                selected ? active : "bg-surface text-muted ring-line-strong hover:bg-surface-2 hover:text-ink"
              )}
            >
              <Icon size={size === "sm" ? 14 : 16} weight="bold" />
              {RSVP_LABELS[value]}
            </button>
          );
        })}
      </div>
    </fetcher.Form>
  );
}
