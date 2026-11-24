import { useCallback, useEffect, useState } from "react";
import { detectPlatform, isStandalone, vapidKeyBytes } from "~/utils/pwa";

// Web Push for this browser. Needs the service worker from /sw.js (registered
// in root.tsx) and the VAPID public key from a loader. The family layout owns
// one instance and shares it with its pages, so the header bell and the
// Settings page always agree.

export type PushStatus =
  | "loading"
  /** No Web Push here (old browser, in-app browser) */
  | "unsupported"
  /** Not set up on the server */
  | "unconfigured"
  /** iPhone/iPad in a browser tab: push only exists once it's on the Home Screen */
  | "needs-install"
  | "off"
  | "on"
  /** The user said no; only the phone or browser settings can undo that */
  | "blocked";

async function post(body: unknown) {
  const res = await fetch("/api/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Request failed");
}

export function usePush(vapidPublicKey: string | null) {
  const [status, setStatus] = useState<PushStatus>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!vapidPublicKey) return setStatus("unconfigured");
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (!supported) {
      setStatus(detectPlatform().os === "ios" && !isStandalone() ? "needs-install" : "unsupported");
      return;
    }
    let cancelled = false;
    const check = async () => {
      if (Notification.permission === "denied") return setStatus("blocked");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (cancelled) return;
      if (sub && Notification.permission === "granted") {
        setStatus("on");
        // A browser belongs to whoever is signed in now: re-save so pushes follow them
        post({ action: "subscribe", subscription: sub.toJSON() }).catch(() => {});
      } else {
        setStatus("off");
      }
    };
    const run = () => void check().catch(() => !cancelled && setStatus("unsupported"));
    run();
    // Back from the phone's Settings app (the only place a block can be lifted): re-check if it changed
    let seen = Notification.permission;
    const onVisible = () => {
      if (document.visibilityState !== "visible" || Notification.permission === seen) return;
      seen = Notification.permission;
      run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [vapidPublicKey]);

  /** Must run straight from a tap: iOS ignores permission requests that aren't. Resolves to whether this device is now on. */
  const enable = useCallback(async () => {
    if (!vapidPublicKey) return false;
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "blocked" : "off");
        return false;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes(vapidPublicKey) }));
      await post({ action: "subscribe", subscription: sub.toJSON() });
      setStatus("on");
      return true;
    } catch (e) {
      setError(`Couldn't turn on notifications: ${(e as Error).message}`);
      setStatus("off");
      return false;
    } finally {
      setBusy(false);
    }
  }, [vapidPublicKey]);

  const disable = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await post({ action: "unsubscribe", endpoint: sub.endpoint }).catch(() => {});
        await sub.unsubscribe();
      }
      setStatus("off");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  /** Resolves to whether the server accepted it. */
  const sendTest = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await post({ action: "test" });
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return { status, busy, error, enable, disable, sendTest };
}

export type PushState = ReturnType<typeof usePush>;
