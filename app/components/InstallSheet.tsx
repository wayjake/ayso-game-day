import { useEffect, useState, type ReactNode } from "react";
import { Bell, CalendarCheck, ChatsCircle, CheckCircle, Lightning } from "@phosphor-icons/react";
import { Sheet, SheetTitle } from "~/components/Sheet";
import { cx } from "~/components/ui";
import {
  type BeforeInstallPromptEvent,
  type Platform,
  SHOULD_OFFER_INSTALL_JS,
  detectPlatform,
  isStandalone,
  isTouchDevice,
} from "~/utils/pwa";

// "Add to Home Screen", with steps for the phone and browser in hand. Opens by
// itself right after a family signs in with an emailed link (the session
// cookie is already set, so the installed app starts out signed in), and from
// the bell in the header after that.

const APP_NAME = "Game Day"; // What the Home Screen icon is called (manifest short_name)

type Env = { platform: Platform; standalone: boolean };

// After signing in, only phones that aren't already in the installed app get the sheet
const OFFER_INSTALL = {
  js: SHOULD_OFFER_INSTALL_JS,
  test: () => isTouchDevice() && !isStandalone(),
};

export function InstallSheet({
  platform,
  openOnLoad = false,
  onClose,
}: {
  /** From the user agent on the server, so the steps are there on the first render (no jump as they load) */
  platform: Platform;
  /** Rendered with the page after signing in: opens before hydration on phones not in the installed app */
  openOnLoad?: boolean;
  onClose: () => void;
}) {
  // The browser refines this after hydration (an iPad says it's a Mac; standalone is browser-only)
  const [env, setEnv] = useState<Env>({ platform, standalone: false });
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    setEnv({ platform: detectPlatform(), standalone: isStandalone() });
    setPrompt(window.__installPrompt ?? null);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      window.__installPrompt = e as BeforeInstallPromptEvent;
      setPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      window.__installPrompt = null;
      setPrompt(null);
      setInstalled(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = async () => {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    // A prompt event can only be used once
    window.__installPrompt = null;
    setPrompt(null);
    if (outcome === "accepted") setInstalled(true);
  };

  const done = env.standalone || installed;

  return (
    <Sheet labelledBy="install-title" onClose={onClose} openOnLoad={openOnLoad ? OFFER_INSTALL : undefined}>
      {(close) => (
        <>
          <SheetTitle
            id="install-title"
            icon={<img src="/icons/icon-192.png" alt="" className="size-16 shrink-0 rounded-2xl shadow-raised" />}
            title={done ? "You're all set" : "Add Game Day to your Home Screen"}
            subtitle={done ? undefined : "Free, no app store, takes 10 seconds"}
          />

          <Body env={env} prompt={prompt} installed={installed} onInstall={install} />

          <button
            type="button"
            onClick={close}
            className="mt-4 h-11 w-full rounded-lg text-sm font-semibold text-muted transition hover:bg-surface-2 hover:text-ink"
          >
            {done ? "Done" : "Not now"}
          </button>
        </>
      )}
    </Sheet>
  );
}

function Body({
  env,
  prompt,
  installed,
  onInstall,
}: {
  env: Env;
  prompt: BeforeInstallPromptEvent | null;
  installed: boolean;
  onInstall: () => void;
}) {
  const { platform } = env;

  if (env.standalone) {
    return <p className="mt-5 text-muted">You're already using the app. Nothing more to do.</p>;
  }
  if (installed) {
    return (
      <p className="mt-5 text-muted">
        Installed! Open <strong className="text-ink">{APP_NAME}</strong> from your home screen
        {platform.os === "android" ? " or app drawer" : ""}, then turn on notifications.
      </p>
    );
  }

  return (
    <>
      <ul className="mt-5 space-y-3 text-[15px]">
        <Benefit icon={<Bell size={20} weight="fill" />} tone="text-brand">
          <strong className="font-semibold">Notifications</strong> the moment a coach messages, or a game or practice
          changes or is cancelled
          {platform.os === "ios" && (
            <span className="text-muted">. iPhone only sends these to apps on the Home Screen.</span>
          )}
        </Benefit>
        <Benefit icon={<CalendarCheck size={20} weight="fill" />} tone="text-primary">
          RSVP for games and practices in one tap
        </Benefit>
        <Benefit icon={<ChatsCircle size={20} weight="fill" />} tone="text-pitch">
          Team chat and your private thread with the coaches
        </Benefit>
        <Benefit icon={<Lightning size={20} weight="fill" />} tone="text-warning">
          Opens full screen and stays signed in
        </Benefit>
      </ul>

      <div className="mt-5 rounded-2xl bg-surface-2 p-4">
        {prompt ? (
          <button
            type="button"
            onClick={onInstall}
            className="h-12 w-full rounded-lg bg-primary text-base font-semibold text-white shadow-card transition hover:bg-primary-hover active:translate-y-px"
          >
            Install app
          </button>
        ) : (
          <Steps platform={platform} />
        )}
      </div>
    </>
  );
}

function Steps({ platform }: { platform: Platform }) {
  if (platform.os === "desktop") {
    return (
      <>
        <p className="text-sm font-semibold">This works best on your phone.</p>
        <p className="mt-1 text-sm text-muted">
          Open this page on your phone, then add it to your home screen from there.
        </p>
        <CopyLink />
      </>
    );
  }

  if (platform.browser === "in-app") {
    const browser = platform.os === "ios" ? "Safari" : "Chrome";
    return (
      <>
        <p className="text-sm font-semibold">First, open this page in {browser}</p>
        <p className="mt-1 text-sm text-muted">
          Apps like Gmail and Facebook open links in their own browser, which can't add apps to your home screen. Use
          its menu to open in {browser}, or copy the link and paste it there.
        </p>
        <CopyLink />
      </>
    );
  }

  if (platform.os === "ios") {
    if (platform.browser === "other") {
      return (
        <ol className="space-y-3 text-[15px]">
          <Step n={1}>
            Tap the <strong>Share</strong> button <ShareIcon /> next to the address bar
          </Step>
          <Step n={2}>
            Tap <strong>Add to Home Screen</strong> <AddIcon />
          </Step>
          <Step n={3}>
            Not there? Open this page in <strong>Safari</strong> and do the same.
          </Step>
        </ol>
      );
    }
    return (
      <ol className="space-y-3 text-[15px]">
        <Step n={1}>
          Tap the <strong>Share</strong> button <ShareIcon /> at the bottom of Safari
          <span className="text-muted"> (don't see it? Tap ••• first)</span>
        </Step>
        <Step n={2}>
          Scroll down and tap <strong>Add to Home Screen</strong> <AddIcon />
        </Step>
        <Step n={3}>
          Tap <strong>Add</strong>, then open <strong>{APP_NAME}</strong> from your Home Screen
        </Step>
      </ol>
    );
  }

  if (platform.browser === "samsung") {
    return (
      <ol className="space-y-3 text-[15px]">
        <Step n={1}>
          Tap the <strong>menu</strong> <BarsIcon /> at the bottom of the browser
        </Step>
        <Step n={2}>
          Tap <strong>Add page to</strong>, then <strong>Home screen</strong>
        </Step>
        <Step n={3}>
          Open <strong>{APP_NAME}</strong> from your home screen
        </Step>
      </ol>
    );
  }

  return (
    <ol className="space-y-3 text-[15px]">
      <Step n={1}>
        Tap the <strong>menu</strong> <MenuIcon /> in the top corner of the browser
      </Step>
      <Step n={2}>
        Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>
      </Step>
      <Step n={3}>
        Confirm, then open <strong>{APP_NAME}</strong> from your home screen
      </Step>
    </ol>
  );
}

function CopyLink() {
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined" ? "" : `${window.location.origin}/family`;
  return (
    <button
      type="button"
      className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-surface text-sm font-semibold ring-1 ring-line-strong"
      onClick={() =>
        navigator.clipboard?.writeText(url).then(
          () => setCopied(true),
          () => {},
        )
      }
    >
      {copied ? (
        <>
          <CheckCircle size={18} weight="fill" className="text-success" /> Link copied
        </>
      ) : (
        "Copy link"
      )}
    </button>
  );
}

function Benefit({ icon, tone, children }: { icon: ReactNode; tone: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className={cx("mt-0.5 shrink-0", tone)} aria-hidden>
        {icon}
      </span>
      <span>{children}</span>
    </li>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ink text-xs font-bold text-white">
        {n}
      </span>
      <span className="leading-6">{children}</span>
    </li>
  );
}

// Drawn to look like the buttons they point at, rather than the app's own icon set
const glyph = "inline-block size-5 -translate-y-0.5 align-middle";

function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cx(glyph, "text-[#007AFF]")}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label="share icon"
    >
      <path d="M12 3v12M8 7l4-4 4 4" />
      <path d="M8 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2" />
    </svg>
  );
}

function AddIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cx(glyph, "text-[#007AFF]")}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-label="add icon"
    >
      <rect x="4" y="4" width="16" height="16" rx="3.5" />
      <path d="M12 8.5v7M8.5 12h7" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" className={glyph} fill="currentColor" aria-label="menu icon">
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="19" r="1.8" />
    </svg>
  );
}

function BarsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className={glyph}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-label="menu icon"
    >
      <path d="M5 7h14M5 12h14M5 17h14" />
    </svg>
  );
}
