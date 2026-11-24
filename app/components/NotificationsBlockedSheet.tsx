import { useState, type ReactNode } from "react";
import { BellSlash } from "@phosphor-icons/react";
import { Sheet, SheetTitle } from "~/components/Sheet";
import { type Platform, detectPlatform, isStandalone } from "~/utils/pwa";

// Once someone taps "Don't Allow", the page can never ask again. Only the
// phone or browser settings can undo it, so this walks them through where
// that lives.

type Env = { platform: Platform; standalone: boolean };

export function NotificationsBlockedSheet({ onClose }: { onClose: () => void }) {
  // Only ever opened by a tap, never server-rendered, so the browser is there on the first render
  const [env] = useState<Env>(() => ({
    platform: detectPlatform(),
    standalone: isStandalone(),
  }));

  return (
    <Sheet labelledBy="notifications-blocked-title" onClose={onClose}>
      {(close) => (
        <>
          <SheetTitle
            id="notifications-blocked-title"
            icon={
              <span
                className="grid size-14 shrink-0 place-items-center rounded-2xl bg-warning-soft text-warning"
                aria-hidden
              >
                <BellSlash size={28} weight="fill" />
              </span>
            }
            title="Notifications are blocked"
            subtitle="This device said no, so we can't ask again"
          />
          <Steps env={env} />
          <button
            type="button"
            onClick={close}
            className="mt-6 h-12 w-full rounded-lg bg-primary text-base font-semibold text-white shadow-card hover:bg-primary-hover"
          >
            Got it
          </button>
        </>
      )}
    </Sheet>
  );
}

function Steps({ env: { platform, standalone } }: { env: Env }) {
  if (platform.os === "ios") {
    return (
      <>
        <List>
          <li>
            Open your iPhone's <strong>Settings</strong> app
          </li>
          <li>
            Tap <strong>Notifications</strong>, then <strong>BenchTalk</strong>
          </li>
          <li>
            Turn on <strong>Allow Notifications</strong>
          </li>
          <li>Come back here. The switch will be ready to turn on.</li>
        </List>
        <Note>
          Not in the list? Remove BenchTalk from your Home Screen and add it again. That resets its permissions, and
          you'll be asked again.
        </Note>
      </>
    );
  }

  if (platform.os === "android") {
    return standalone ? (
      <>
        <List>
          <li>
            Long-press the <strong>BenchTalk</strong> icon on your home screen
          </li>
          <li>
            Tap <strong>App info</strong>, then <strong>Notifications</strong>
          </li>
          <li>Turn notifications on</li>
          <li>Come back here. The switch will be ready to turn on.</li>
        </List>
        <Note>
          Still off? In Chrome, go to <strong>⋮ → Settings → Site settings → Notifications</strong> and move this site
          out of <strong>Blocked</strong>.
        </Note>
      </>
    ) : (
      <List>
        <li>
          Tap the <strong>settings icon</strong> left of the address bar
        </li>
        <li>
          Tap <strong>Permissions</strong>, then set <strong>Notifications</strong> to Allow
        </li>
        <li>Reload the page</li>
      </List>
    );
  }

  return (
    <List>
      <li>
        Click the <strong>site settings icon</strong> left of the address bar
      </li>
      <li>
        Set <strong>Notifications</strong> to <strong>Allow</strong>
      </li>
      <li>Reload the page</li>
    </List>
  );
}

function List({ children }: { children: ReactNode }) {
  return (
    <ol className="mt-5 list-decimal space-y-2 pl-5 text-ink marker:font-semibold marker:text-primary">{children}</ol>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="mt-4 rounded-xl bg-surface-2 p-3 text-sm text-muted">{children}</p>;
}
