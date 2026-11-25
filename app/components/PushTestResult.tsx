import { CheckCircle, Warning } from "@phosphor-icons/react";
import type { PushTestOutcome } from "~/hooks/usePush";
import { detectPlatform } from "~/utils/pwa";

// What "Send a test" found out. Delivered means the push service took it for
// this device; if nothing then shows up, the computer or phone is hiding it,
// so say where to look.

export function PushTestResult({ outcome }: { outcome: PushTestOutcome }) {
  if (!outcome.delivered) {
    return (
      <p className="flex items-start gap-1.5 text-sm text-danger" role="status">
        <Warning size={16} weight="bold" className="mt-0.5 shrink-0" />
        <span>Not sent. {outcome.message}</span>
      </p>
    );
  }
  return (
    <div className="text-sm" role="status">
      <p className="flex items-center gap-1.5 font-medium text-success">
        <CheckCircle size={16} weight="fill" className="shrink-0" />
        Sent to this device. It should pop up in a few seconds.
      </p>
      <p className="mt-1.5 text-muted">If it doesn't, something on this device is hiding it:</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
        {hints().map((h) => (
          <li key={h}>{h}</li>
        ))}
      </ul>
    </div>
  );
}

function hints() {
  const { os } = detectPlatform();
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Microsoft Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Google Chrome" : "your browser";
  if (os === "ios") return ["Settings > Notifications > BenchTalk: Allow Notifications on", "Focus (the moon) off, or BenchTalk allowed in it"];
  if (os === "android") return ["Settings > Apps > BenchTalk (or your browser) > Notifications: on", "Do Not Disturb off"];
  if (/Macintosh/.test(ua)) {
    return [
      `System Settings > Notifications > ${browser}: Allow notifications on, style Banners or Alerts`,
      "Focus or Do Not Disturb off (Control Center, top right)",
      `${browser} has to be running; it can't show notifications while it's quit`,
    ];
  }
  if (/Windows/.test(ua)) {
    return [
      `Settings > System > Notifications: on, and ${browser} on in the list`,
      "Do not disturb / Focus off",
    ];
  }
  return [`Your system's notification settings: ${browser} allowed`, "Do Not Disturb off"];
}
