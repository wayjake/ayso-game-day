import { useState } from "react";
import { Bell, BellSlash, DeviceMobile } from "@phosphor-icons/react";
import { Alert, Button } from "~/components/ui";
import { NotificationsBlockedSheet } from "~/components/NotificationsBlockedSheet";
import { NotifyCategories } from "~/components/NotifyCategories";
import { usePush, type PushState, type PushTestOutcome } from "~/hooks/usePush";
import { PushTestResult } from "~/components/PushTestResult";
import type { NotifyPrefs } from "~/utils/notify";

// Turns Web Push on or off for this browser. PushToggle keeps its own state
// (coach pages); the family app passes its shared state to PushControls so the
// header bell and the Settings page agree. iPhones only allow push for sites
// added to the Home Screen, so there we point at installing first.

export function PushToggle({ vapidPublicKey, notifyPrefs }: { vapidPublicKey: string | null; notifyPrefs: NotifyPrefs }) {
  return <PushControls push={usePush(vapidPublicKey, notifyPrefs)} audience="coach" />;
}

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

      {push.status === "on" && (
        <div className="border-t border-line pt-4">
          <NotifyCategories push={push} audience={audience} />
        </div>
      )}

      {tested && push.status === "on" && <PushTestResult outcome={tested} />}
      {push.error && <Alert tone="danger">{push.error}</Alert>}
      {blockedHelp && <NotificationsBlockedSheet onClose={() => setBlockedHelp(false)} />}
    </div>
  );
}
