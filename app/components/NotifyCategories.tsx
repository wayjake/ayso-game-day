import { Switch } from "~/components/NotificationsMenu";
import type { PushState } from "~/hooks/usePush";
import { NOTIFY_CATEGORIES } from "~/utils/notify";

// One switch per kind of notification. The choices follow the account to every
// device; the locked one shows as on so it's clear it can't be missed. Staff
// payment alerts can come by email too, so those rows get a second switch.
// `emailOnly`: only the email switches (this server can't send notifications).

export function NotifyCategories({ push, audience, emailOnly = false }: { push: PushState; audience: "family" | "coach"; emailOnly?: boolean }) {
  const categories = NOTIFY_CATEGORIES.filter((c) => (audience === "coach" || !c.coachOnly) && (!emailOnly || c.email));
  const withEmail = categories.some((c) => c.email);
  if (categories.length === 0) return null;

  return (
    <ul className="space-y-3" aria-label="Kinds of notifications">
      {withEmail && !emailOnly && (
        <li className="flex items-center gap-3 text-xs font-semibold text-muted" aria-hidden>
          <span className="flex-1" />
          <span className="w-12 text-center">Notify</span>
          <span className="w-12 text-center">Email</span>
        </li>
      )}
      {categories.map((c) => (
        <li key={c.kind} className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{c.label}</p>
            <p className="text-xs text-muted">{c.detail}</p>
          </div>
          {!emailOnly && (
            <Switch
              label={c.locked ? `${c.label} (always on)` : `${c.label}: notifications`}
              checked={c.locked ? true : push.wants(c.kind)}
              disabled={c.locked}
              onChange={(on) => void push.choose(c.kind, on)}
            />
          )}
          {withEmail &&
            (c.email ? (
              <Switch label={`${c.label}: email`} checked={push.wants(c.kind, "email")} onChange={(on) => void push.choose(c.kind, on, "email")} />
            ) : (
              <span className="w-12 shrink-0" aria-hidden />
            ))}
        </li>
      ))}
    </ul>
  );
}
