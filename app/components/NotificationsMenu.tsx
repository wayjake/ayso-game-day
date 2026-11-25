import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router";
import { Bell, BellSlash, DeviceMobile } from "@phosphor-icons/react";
import { NotificationsBlockedSheet } from "~/components/NotificationsBlockedSheet";
import { cx } from "~/components/ui";
import { NotifyCategories } from "~/components/NotifyCategories";
import type { PushState, PushTestOutcome } from "~/hooks/usePush";
import { PushTestResult } from "~/components/PushTestResult";
import { isStandalone, isTouchDevice } from "~/utils/pwa";

// The bell in the header (family app and coach dashboard): one tap shows whether this device gets
// notifications, with the switch right there, then which kinds you get, plus
// "Add to Home Screen" on phones that haven't installed the app yet.

export function NotificationsMenu({
  push,
  onInstall,
  audience = "family",
}: {
  push: PushState;
  onInstall: () => void;
  audience?: "family" | "coach";
}) {
  const [open, setOpen] = useState(false);
  const [blockedHelp, setBlockedHelp] = useState(false);
  const [canInstall, setCanInstall] = useState(false);
  const [tested, setTested] = useState<PushTestOutcome | null>(null);
  const [position, setPosition] = useState({ top: 0, right: 12 });
  const trigger = useRef<HTMLButtonElement>(null);
  const { pathname } = useLocation();

  useEffect(() => setCanInstall(isTouchDevice() && !isStandalone()), []);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return setTested(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const on = push.status === "on";
  // Something they could fix from here: worth a dot on the bell
  const needsAction = push.status === "off" || push.status === "needs-install" || push.status === "blocked";
  const label = on ? "Notifications on" : "Notifications off";

  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => {
          if (!open && trigger.current) {
            // Hang the panel just under the header, lined up with the bell
            const rect = trigger.current.getBoundingClientRect();
            const bottom = trigger.current.closest("header")?.getBoundingClientRect().bottom ?? rect.bottom;
            setPosition({ top: bottom + 8, right: Math.max(12, window.innerWidth - rect.right) });
          }
          setOpen(!open);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${label}. Notification settings`}
        className={cx(
          "relative flex h-11 w-11 items-center justify-center rounded-lg transition hover:bg-surface-2",
          on ? "text-primary" : "text-muted hover:text-ink",
          open && "bg-surface-2"
        )}
      >
        {push.status === "blocked" ? <BellSlash size={22} /> : <Bell size={22} weight={on ? "fill" : "regular"} />}
        {needsAction && <span className="absolute top-2 right-2 size-2.5 rounded-full bg-brand ring-2 ring-surface" aria-hidden />}
      </button>

      {open &&
        // Portalled: the header's backdrop blur would otherwise trap these fixed layers inside it
        createPortal(
          // Tap anywhere else to close
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-label="Notification settings"
            className="fixed left-3 z-50 max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-2xl bg-surface p-4 shadow-overlay ring-1 ring-line sm:left-auto sm:w-80"
            style={position}
            onClick={(e) => e.stopPropagation()}
          >
            <PushRow
              push={push}
              tested={tested}
              onTest={async () => setTested(await push.sendTest())}
              onBlockedHelp={() => setBlockedHelp(true)}
              onInstall={() => {
                setOpen(false);
                onInstall();
              }}
            />

            {push.status === "on" && (
              <>
                <div className="my-4 border-t border-line" />
                <NotifyCategories push={push} audience={audience} />
              </>
            )}

            {canInstall && push.status !== "needs-install" && (
              <>
                <div className="my-4 border-t border-line" />
                <Row
                  icon={<DeviceMobile size={20} />}
                  title="Add to Home Screen"
                  detail="Opens like an app, full screen and signed in."
                >
                  <SmallButton
                    onClick={() => {
                      setOpen(false);
                      onInstall();
                    }}
                  >
                    How
                  </SmallButton>
                </Row>
              </>
            )}

            {push.error && <p className="mt-3 text-sm text-danger">{push.error}</p>}
          </div>
          </div>,
          document.body
        )}

      {blockedHelp && <NotificationsBlockedSheet onClose={() => setBlockedHelp(false)} />}
    </div>
  );
}

function PushRow({
  push,
  tested,
  onTest,
  onBlockedHelp,
  onInstall,
}: {
  push: PushState;
  tested: PushTestOutcome | null;
  onTest: () => void;
  onBlockedHelp: () => void;
  onInstall: () => void;
}) {
  const icon = <Bell size={20} weight={push.status === "on" ? "fill" : "regular"} />;
  const title = "Notifications";

  switch (push.status) {
    case "loading":
      return (
        <Row icon={icon} title={title} detail="Checking this device…">
          <Switch label={title} checked={false} disabled onChange={() => {}} />
        </Row>
      );
    case "unconfigured":
      return <Row icon={icon} title={title} detail="Not set up yet. Check back soon." />;
    case "unsupported":
      return <Row icon={icon} title={title} detail="This browser can't get notifications. Try Safari or Chrome." />;
    case "needs-install":
      return (
        <Row icon={icon} title={title} detail="iPhone only sends notifications to apps on your Home Screen.">
          <SmallButton primary onClick={onInstall}>
            Add app
          </SmallButton>
        </Row>
      );
    case "blocked":
      return (
        <Row
          icon={<BellSlash size={20} />}
          title={title}
          detail={
            <button type="button" onClick={onBlockedHelp} className="text-left underline decoration-line-strong underline-offset-2">
              Blocked on this device. How to fix
            </button>
          }
        >
          <Switch label={`${title} (blocked)`} checked={false} muted onChange={onBlockedHelp} />
        </Row>
      );
    case "off":
    case "on":
      return (
        <>
          <Row
            icon={icon}
            title={title}
            detail={
              push.status === "on"
                ? "On for this device. Choose what you get below."
                : "Get messages and schedule changes on this device."
            }
          >
            <Switch
              label={title}
              checked={push.status === "on"}
              disabled={push.busy}
              onChange={(next) => void (next ? push.enable() : push.disable())}
            />
          </Row>
          {push.status === "on" && (
            <div className="mt-2 pl-8">
              {tested ? (
                <PushTestResult outcome={tested} />
              ) : (
                <button type="button" onClick={onTest} disabled={push.busy} className="text-sm font-semibold text-primary disabled:opacity-50">
                  Send a test
                </button>
              )}
            </div>
          )}
        </>
      );
  }
}

function Row({ icon, title, detail, children }: { icon: ReactNode; title: ReactNode; detail: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="shrink-0 self-start pt-0.5 text-muted" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted">{detail}</p>
      </div>
      {children}
    </div>
  );
}

function SmallButton({ primary, onClick, children }: { primary?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "h-9 shrink-0 rounded-lg px-3 text-sm font-semibold",
        primary ? "bg-primary text-white hover:bg-primary-hover" : "bg-surface ring-1 ring-line-strong hover:bg-surface-2"
      )}
    >
      {children}
    </button>
  );
}

export function Switch({
  label,
  checked,
  disabled = false,
  muted = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  /** Looks disabled but still takes taps (to explain why it's unavailable) */
  muted?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      aria-disabled={muted || undefined}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50",
        muted && "opacity-50",
        checked ? "bg-primary" : "bg-line-strong"
      )}
    >
      <span className={cx("absolute top-0.5 size-6 rounded-full bg-white shadow transition-all", checked ? "left-[1.375rem]" : "left-0.5")} />
    </button>
  );
}
