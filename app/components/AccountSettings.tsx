import { Form, useNavigation } from "react-router";
import { SignOut } from "@phosphor-icons/react";
import { PersonAvatar } from "~/components/PersonAvatar";
import { PushControls } from "~/components/PushToggle";
import { Alert, Button, Card, CardHeader, inputClass, labelClass } from "~/components/ui";
import { usePushContext } from "~/hooks/usePushContext";
import type { AccountResult } from "~/utils/account.server";

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
  me: { id: number; name: string | null; email: string };
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
