import { useState } from "react";
import { Form, useNavigation } from "react-router";
import { AppleLogo, Check, Copy, GoogleLogo, SignOut } from "@phosphor-icons/react";
import { PersonAvatar } from "~/components/PersonAvatar";
import { PushControls } from "~/components/PushToggle";
import { Alert, Button, Card, CardHeader, buttonClass, inputClass, labelClass } from "~/components/ui";
import { usePushContext } from "~/hooks/usePushContext";
import type { AccountResult } from "~/utils/account.server";
import type { CalendarLinks } from "~/utils/calendar-feed.server";

// Cards for the settings that belong to the person rather than a team. The
// coach Account page and the family Settings page both use them; the forms
// post to their own page, whose action hands them to accountAction().

function useBusy(intent: string) {
  const navigation = useNavigation();
  return navigation.state === "submitting" && navigation.formData?.get("_action") === intent;
}

function Result({ result, intent }: { result: AccountResult | null | undefined; intent: string }) {
  if (!result || result.intent !== intent) return null;
  if ("error" in result) return <Alert>{result.error}</Alert>;
  return <Alert tone="success">{result.success}</Alert>;
}

export function ProfileCard({
  me,
  nameHint,
  result,
}: {
  me: { id: string; name: string | null; email: string };
  nameHint: string;
  result?: AccountResult | null;
}) {
  const saving = useBusy("updateName");
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center gap-4">
        <PersonAvatar person={{ id: me.id, name: me.name?.trim() || me.email }} size="xl" />
        <div className="min-w-0">
          <p className="truncate font-display text-xl font-bold">{me.name?.trim() || "Add your name"}</p>
          <p className="truncate text-sm text-muted">Signed in as {me.email}</p>
        </div>
      </div>
      <Form method="post" className="mt-5 space-y-3">
        <input type="hidden" name="_action" value="updateName" />
        <div>
          <label htmlFor="account-name" className={labelClass}>Your name</label>
          <input
            id="account-name"
            name="name"
            defaultValue={me.name ?? ""}
            required
            autoComplete="name"
            placeholder="Your full name"
            className={inputClass}
          />
          <p className="mt-1.5 text-xs text-muted">{nameHint}</p>
        </div>
        <Result result={result} intent="updateName" />
        <Button type="submit" variant="secondary" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </Form>
    </Card>
  );
}

export function NotificationsCard() {
  const { push, openInstall, audience } = usePushContext();
  return (
    <Card className="p-5 sm:p-6">
      <CardHeader title="Notifications" className="mb-1" />
      <p className="mb-4 text-sm text-muted">
        Turn them on separately on each phone or computer you use. What you choose to get applies to all of them.
      </p>
      <PushControls push={push} onInstall={openInstall} audience={audience} />
    </Card>
  );
}

export function CalendarCard({
  links,
  covers,
  result,
}: {
  links: CalendarLinks;
  /** What the feed holds, e.g. "your players' games and practices" */
  covers: string;
  result?: AccountResult | null;
}) {
  const resetting = useBusy("resetCalendar");
  const [confirmReset, setConfirmReset] = useState(false);
  const [copied, setCopied] = useState(false);

  return (
    <Card className="scroll-mt-24 p-5 sm:p-6" id="calendar">
      <CardHeader title="Add to your calendar" />
      <p className="mt-0.5 text-sm text-muted">
        See {covers} in your phone's calendar. New games, time changes and cancellations show up there on their own.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <a href={links.apple} className={buttonClass({ variant: "secondary" })}>
          <AppleLogo size={18} weight="fill" /> iPhone or Mac
        </a>
        <a href={links.google} target="_blank" rel="noreferrer" className={buttonClass({ variant: "secondary" })}>
          <GoogleLogo size={18} weight="bold" /> Google Calendar
        </a>
      </div>
      <p className="mt-3 text-xs text-muted">
        Google can take up to a day to pick up a change, so the app still sends you a notification when something moves.
        Using Outlook or something else? Copy the link and add it as a calendar from the web.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(links.https);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              window.prompt("Copy this link", links.https);
            }
          }}
        >
          {copied ? <Check size={16} weight="bold" className="text-success" /> : <Copy size={16} />}
          {copied ? "Copied" : "Copy link"}
        </Button>
        {confirmReset ? (
          <Form method="post" className="flex flex-wrap items-center gap-2" onSubmit={() => setConfirmReset(false)}>
            <input type="hidden" name="_action" value="resetCalendar" />
            <Button type="submit" variant="danger-soft" size="sm" disabled={resetting}>
              {resetting ? "Resetting…" : "Reset link"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmReset(false)}>
              Keep it
            </Button>
          </Form>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setConfirmReset(true)}>
            Reset link
          </Button>
        )}
      </div>
      {confirmReset && (
        <p className="mt-2 text-xs text-muted">
          Anyone with this link can see the schedule. Resetting stops it working everywhere it's been added, so you'll need
          to add the new one again.
        </p>
      )}
      <div className="mt-4 empty:hidden">
        <Result result={result} intent="resetCalendar" />
      </div>
    </Card>
  );
}

export function SendingEmailCard({
  me,
  fromHeader,
  teamName,
  sendingDomain,
  result,
}: {
  me: { sendingEmail: string | null; isAdmin: boolean };
  fromHeader: string;
  /** The team fromHeader was worked out for, when it's that team's own reply address rather than yours */
  teamName: string | null;
  sendingDomain: string | null;
  result?: AccountResult | null;
}) {
  const saving = useBusy("updateSendingEmail");
  return (
    <Card className="scroll-mt-6 p-5 sm:p-6" id="your-email">
      <CardHeader title="Your email address" />
      <p className="mt-0.5 text-sm text-muted">
        Announcements and replies to families go out as <span className="font-medium text-ink">{fromHeader}</span>
        {teamName ? <> for {teamName}; each team gets its own reply address</> : null}. Replies come back to the app either
        way.
      </p>
      {me.isAdmin && sendingDomain ? (
        <Form method="post" className="mt-5 flex flex-col gap-3 sm:flex-row">
          <input type="hidden" name="_action" value="updateSendingEmail" />
          <input
            name="sendingEmail"
            type="email"
            defaultValue={me.sendingEmail ?? ""}
            placeholder={`you@${sendingDomain}`}
            className={inputClass}
            aria-label="Your sending address"
          />
          <Button type="submit" className="sm:h-auto" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </Form>
      ) : (
        !me.sendingEmail && (
          <p className="mt-3 text-sm text-muted">Want your own @{sendingDomain ?? "team"} address? Ask the site owner to set one up.</p>
        )
      )}
      <div className="mt-4 empty:hidden">
        <Result result={result} intent="updateSendingEmail" />
      </div>
    </Card>
  );
}

export function LogOutButton() {
  return (
    <Form action="/user/logout" method="post">
      <Button type="submit" variant="ghost" className="w-full sm:w-auto">
        <SignOut size={18} /> Log out
      </Button>
    </Form>
  );
}
