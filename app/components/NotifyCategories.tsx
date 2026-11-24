import { Switch } from "~/components/NotificationsMenu";
import type { PushState } from "~/hooks/usePush";
import { NOTIFY_CATEGORIES } from "~/utils/notify";

// One switch per kind of notification. The choices follow the account to every
// device; the locked one shows as on so it's clear it can't be missed.

export function NotifyCategories({ push, audience }: { push: PushState; audience: "family" | "coach" }) {
  const categories = NOTIFY_CATEGORIES.filter((c) => audience === "coach" || !c.coachOnly);

  return (
    <ul className="space-y-3" aria-label="Kinds of notifications">
      {categories.map((c) => (
        <li key={c.kind} className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{c.label}</p>
            <p className="text-xs text-muted">{c.detail}</p>
          </div>
          <Switch
            label={c.locked ? `${c.label} (always on)` : c.label}
            checked={c.locked ? true : push.wants(c.kind)}
            disabled={c.locked}
            onChange={(on) => void push.choose(c.kind, on)}
          />
        </li>
      ))}
    </ul>
  );
}
