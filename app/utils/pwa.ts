// PWA helpers: install state and platform sniffing for install instructions.
// Everything but detectPlatform (which takes the user agent, so the server can
// call it too) is browser-only: call from effects or event handlers.

/** Chromium's install event (not in lib.dom yet). */
export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

declare global {
  interface Window {
    /** Set by the inline script in root.tsx, since the event can fire before hydration */
    __installPrompt?: BeforeInstallPromptEvent | null;
  }
  interface Navigator {
    /** iOS Safari: true when launched from the Home Screen */
    standalone?: boolean;
  }
}

export function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

export type Platform =
  | { os: "ios"; browser: "safari" | "other" | "in-app" }
  | { os: "android"; browser: "chrome" | "samsung" | "other" | "in-app" }
  | { os: "desktop" };

/** Pass the request's user agent on the server; in the browser the defaults read navigator. */
export function detectPlatform(
  ua: string = navigator.userAgent,
  touchPoints: number = typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints,
): Platform {
  // iPadOS reports as a Mac; touch points give it away (the server can't tell)
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
  // Browsers inside other apps (Gmail, Facebook, Instagram, …) can't install web apps
  const inApp = /FBAN|FBAV|Instagram|LinkedInApp|Line\/|Snapchat|GSA\/|Twitter|Slack|; wv\)/.test(ua);
  if (ios) {
    if (inApp) return { os: "ios", browser: "in-app" };
    return {
      os: "ios",
      browser: /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/.test(ua) ? "other" : "safari",
    };
  }
  if (/Android/.test(ua)) {
    if (inApp) return { os: "android", browser: "in-app" };
    if (/SamsungBrowser/.test(ua)) return { os: "android", browser: "samsung" };
    return {
      os: "android",
      browser: /Chrome\//.test(ua) && !/Firefox|EdgA|OPR/.test(ua) ? "chrome" : "other",
    };
  }
  return { os: "desktop" };
}

/** Phones and tablets: where installing is worth bringing up unprompted. */
export function isTouchDevice() {
  return window.matchMedia("(pointer: coarse)").matches;
}

/** isTouchDevice() && !isStandalone() as a script expression, for opening the install sheet before hydration */
export const SHOULD_OFFER_INSTALL_JS =
  "matchMedia('(pointer: coarse)').matches && !(matchMedia('(display-mode: standalone)').matches || navigator.standalone === true)";

/** Web Push needs a base64url VAPID key as bytes (Safari rejects the string form). */
export function vapidKeyBytes(key: string) {
  const b64 = (key + "=".repeat((4 - (key.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
