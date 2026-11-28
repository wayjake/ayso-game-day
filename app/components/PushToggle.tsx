import { useState } from "react";
import { Bell, BellSlash, DeviceMobile } from "@phosphor-icons/react";
import { Alert, Button } from "~/components/ui";
import { NotificationsBlockedSheet } from "~/components/NotificationsBlockedSheet";
import { NotifyCategories } from "~/components/NotifyCategories";
import type { PushState, PushTestOutcome } from "~/hooks/usePush";
import { PushTestResult } from "~/components/PushTestResult";

// Turns Web Push on or off for this browser, on the settings pages. Each
// layout's one push state (usePushContext) comes in, so the header bell and
// the settings page agree. iPhones only allow push for sites
// added to the Home Screen, so there we point at installing first.

export function PushControls({
  push,
  onInstall,
  audience = "family",
}: {
  push: PushState;
  onInstall?: () => void;
  audience?: "family" | "coach";
}) {
  const [tested, setTested] = useState<PushTestOutcome | null>(null);
  const [blockedHelp, setBlockedHelp] = useState(false);

  return (
    <div className="space-y-3">
      {push.status === "loading" && <p className="text-sm text-muted">Checking this device…</p>}

      {push.status === "unconfigured" && <p className="text-sm text-muted">Notifications aren't set up on this server yet.</p>}

      {push.status === "unsupported" && (
        <p className="text-sm text-muted">This browser doesn't support notifications. Try Chrome, Edge, Firefox or Safari.</p>
      )}

      {push.status === "needs-install" && (
        <div className="rounded-xl bg-surface-2 p-4 text-sm">
          <p className="flex items-center gap-2 font-semibold">
            <DeviceMobile size={18} /> Add the app to your Home Screen first
          </p>
          <p className="mt-1 text-muted">iPhone only sends notifications to apps on the Home Screen.</p>
          {onInstall ? (
            <Button size="sm" className="mt-3" onClick={onInstall}>
              Show me how
            </Button>
          ) : (
            <p className="mt-1 text-muted">
              In Safari, tap Share, then <strong className="text-ink">Add to Home Screen</strong>. Open it from there and turn
              notifications on.
            </p>
          )}
        </div>
      )}

      {push.status === "blocked" && (
        <Alert tone="warning">
          Notifications are blocked for this site.{" "}
          <button type="button" className="font-semibold underline underline-offset-2" onClick={() => setBlockedHelp(true)}>
            How to turn them back on
          </button>
        </Alert>
      )}

      {push.status === "off" && (
        <Button onClick={() => void push.enable()} disabled={push.busy}>
          <Bell size={18} weight="fill" />
          {push.busy ? "Turning on…" : "Turn on notifications"}
        </Button>
      )}

      {push.status === "on" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-2 flex items-center gap-1.5 text-sm font-semibold text-success">
            <Bell size={18} weight="fill" /> On for this device
          </span>
          <Button variant="secondary" size="sm" onClick={async () => setTested(await push.sendTest())} disabled={push.busy}>
            Send a test
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void push.disable()} disabled={push.busy}>
            <BellSlash size={16} /> Turn off
          </Button>
        </div>
      )}

      {/* Account-wide, so they can be chosen before this device is on (or from a computer for a phone) */}
      {push.status !== "loading" && push.status !== "unconfigured" && (
        <div className="border-t border-line pt-4">
          {push.status !== "on" && (
            <p className="mb-3 text-xs text-muted">What you get on every device where notifications are on:</p>
          )}
          <NotifyCategories push={push} audience={audience} />
        </div>
      )}
      {/* No push on this server: the payment emails can still be chosen */}
      {push.status === "unconfigured" && audience === "coach" && (
        <div className="border-t border-line pt-4">
          <p className="mb-3 text-xs text-muted">Emails to you:</p>
          <NotifyCategories push={push} audience={audience} emailOnly />
        </div>
      )}

      {tested && push.status === "on" && <PushTestResult outcome={tested} />}
      {push.error && <Alert tone="danger">{push.error}</Alert>}
      {blockedHelp && <NotificationsBlockedSheet onClose={() => setBlockedHelp(false)} />}
    </div>
  );
}
