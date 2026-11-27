import { useCallback, useEffect, useState } from "react";
import { detectPlatform, isStandalone, vapidKeyBytes } from "~/utils/pwa";
import { prefKey, wantsNotification, type NotifyChannel, type NotifyKind, type NotifyPrefs } from "~/utils/notify";

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
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? "Request failed");
  return json;
}

/** What "Send a test" found out: delivered to the push service, or refused and why */
export type PushTestOutcome =
  | { delivered: true }
  | { delivered: false; message: string };

// A subscription is tied to the VAPID public key it was made with. If the
// server's key has changed since, every push to it is refused (403), so it
// has to be made again.
function sameKey(sub: PushSubscription, vapidPublicKey: string) {
  const current = sub.options.applicationServerKey;
  if (!current) return true; // Browser doesn't say; assume it's fine
  const a = new Uint8Array(current);
  const b = vapidKeyBytes(vapidPublicKey);
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

async function currentSubscription(vapidPublicKey: string) {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub || sameKey(sub, vapidPublicKey)) return sub;
  await sub.unsubscribe();
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes(vapidPublicKey) });
}

export function usePush(vapidPublicKey: string | null, initialPrefs: NotifyPrefs = {}) {
  const [status, setStatus] = useState<PushStatus>("loading");
  const [prefs, setPrefs] = useState<NotifyPrefs>(initialPrefs);
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
      // Permission is already granted here, so a stale subscription can be remade without a tap
      const sub = Notification.permission === "granted"
        ? await currentSubscription(vapidPublicKey)
        : await (await navigator.serviceWorker.ready).pushManager.getSubscription();
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
        (await currentSubscription(vapidPublicKey)) ??
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

  /** Sends a test to this device only and says what the push service answered. */
  const sendTest = useCallback(async (): Promise<PushTestOutcome> => {
    setBusy(true);
    setError(null);
    try {
      const sub = vapidPublicKey ? await currentSubscription(vapidPublicKey) : null;
      if (!sub) return { delivered: false, message: "This device isn't subscribed. Turn notifications off and on again." };
      // Make sure the server has this device on this account before testing it
      await post({ action: "subscribe", subscription: sub.toJSON() });
      const { result } = await post({ action: "test", endpoint: sub.endpoint });
      if (result?.sent > 0) return { delivered: true };
      const failure = result?.failed?.[0];
      return {
        delivered: false,
        message: failure
          ? `${failure.service} refused it${failure.status ? ` (${failure.status})` : ""}: ${failure.reason}${failure.status === 403 ? ". Turn notifications off and on again." : ""}`
          : "Nothing was sent.",
      };
    } catch (e) {
      return { delivered: false, message: (e as Error).message };
    } finally {
      setBusy(false);
    }
  }, [vapidPublicKey]);

  /** Which kinds this account gets, on every device. Saved right away, undone if the save fails. */
  const choose = useCallback(async (kind: NotifyKind, on: boolean, channel: NotifyChannel = "push") => {
    setError(null);
    let before: NotifyPrefs = {};
    setPrefs((current) => {
      before = current;
      return { ...current, [prefKey(kind, channel)]: on };
    });
    try {
      await post({ action: "prefs", kind, on, channel });
    } catch (e) {
      setPrefs(before);
      setError(`Couldn't save that: ${(e as Error).message}`);
    }
  }, []);

  const wants = useCallback((kind: NotifyKind, channel: NotifyChannel = "push") => wantsNotification(prefs, kind, channel), [prefs]);

  return { status, busy, error, enable, disable, sendTest, wants, choose };
}

export type PushState = ReturnType<typeof usePush>;
