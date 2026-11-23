import { useEffect, useState } from "react";
import { Bell, BellSlash, DeviceMobile, Export } from "@phosphor-icons/react";
import { Alert, Button } from "~/components/ui";

// Turns Web Push on or off for this browser. Needs the service worker from
// /sw.js (registered in root.tsx) and the VAPID public key from a loader.
// iPhones only allow push for sites added to the Home Screen, so there we
// show how to install first.

type State = "loading" | "unsupported" | "ios-install" | "denied" | "off" | "on";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

async function post(body: unknown) {
  const res = await fetch("/api/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Request failed");
  return res.json();
}

export function PushToggle({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!supported) {
        setState(isIOS() && !isStandalone() ? "ios-install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setState("denied");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      const on = Boolean(sub && Notification.permission === "granted");
      setState(on ? "on" : "off");
      // A browser belongs to whoever is signed in now: re-save so pushes follow them
      if (on && sub && vapidPublicKey) post({ action: "subscribe", subscription: sub.toJSON() }).catch(() => {});
    })().catch(() => setState("unsupported"));
  }, [vapidPublicKey]);

  if (!vapidPublicKey) {
    return <p className="text-sm text-muted">Notifications aren't set up on this server yet.</p>;
  }

  const turnOn = async () => {
    setBusy(true);
    setMessage(null);
    try {
      // Must run straight from the tap: iOS ignores permission prompts otherwise
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        }));
      await post({ action: "subscribe", subscription: sub.toJSON() });
      setState("on");
    } catch (error) {
      setMessage({ tone: "danger", text: `Couldn't turn on notifications: ${(error as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await post({ action: "unsubscribe", endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setState("off");
    } catch (error) {
      setMessage({ tone: "danger", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await post({ action: "test" });
      setMessage({ tone: "success", text: "Sent. It should arrive in a few seconds." });
    } catch (error) {
      setMessage({ tone: "danger", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {state === "loading" && <p className="text-sm text-muted">Checking this device…</p>}

      {state === "unsupported" && (
        <p className="text-sm text-muted">This browser doesn't support notifications. Try Chrome, Edge, Firefox or Safari.</p>
      )}

      {state === "ios-install" && (
        <div className="rounded-xl bg-surface-2 p-4 text-sm">
          <p className="flex items-center gap-2 font-semibold">
            <DeviceMobile size={18} /> Add the app to your Home Screen first
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
            <li>
              Tap <Export size={14} className="inline align-text-bottom" /> Share in Safari's toolbar
            </li>
            <li>Choose <strong className="text-ink">Add to Home Screen</strong></li>
            <li>Open AYSO Game Day from your Home Screen and turn notifications on here</li>
          </ol>
        </div>
      )}

      {state === "denied" && (
        <Alert tone="warning">
          Notifications are blocked for this site. Allow them in your browser or phone settings, then reload.
        </Alert>
      )}

      {state === "off" && (
        <Button onClick={turnOn} disabled={busy}>
          <Bell size={18} weight="fill" />
          {busy ? "Turning on…" : "Turn on notifications"}
        </Button>
      )}

      {state === "on" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-2 flex items-center gap-1.5 text-sm font-semibold text-success">
            <Bell size={18} weight="fill" /> On for this device
          </span>
          <Button variant="secondary" size="sm" onClick={sendTest} disabled={busy}>
            Send a test
          </Button>
          <Button variant="ghost" size="sm" onClick={turnOff} disabled={busy}>
            <BellSlash size={16} /> Turn off
          </Button>
        </div>
      )}

      {message && <Alert tone={message.tone}>{message.text}</Alert>}
    </div>
  );
}
