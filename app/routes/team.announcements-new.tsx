import type { Route } from "./+types/team.announcements-new";
import { useMemo, useState } from "react";
import { Form, Link, data, redirect, useNavigation } from "react-router";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import { listFamilies } from "~/utils/parent-invites.server";
import { familyLabel, sendAnnouncement, sendTestAnnouncement } from "~/utils/announcements.server";
import { ASKS, MAX_BODY, MAX_SUBJECT, type Ask } from "~/utils/announcements";
import { coachFromAddress, isEmailConfigured, isFamilyDeliveryRedirected } from "~/utils/email.server";
import { Alert, Badge, Button, Card, Page, PageHeader, cx, hintClass, inputClass, labelClass } from "~/components/ui";
import { CheckCircle, EnvelopeSimple, PaperPlaneTilt, Warning } from "@phosphor-icons/react";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  const { team } = await requireTeamAccess(teamId, user.id);
  const families = (await listFamilies(request, teamId)).map((f) => ({
    email: f.email,
    label: familyLabel(f),
    onApp: f.status === "joined",
  }));

  return data({
    team,
    families,
    from: coachFromAddress(user, team).header,
    hasOwnAddress: Boolean(user.sendingEmail),
    emailConfigured: isEmailConfigured(),
    redirectedTo: isFamilyDeliveryRedirected() ? user.email : null,
  });
}

function readForm(formData: FormData) {
  const subject = String(formData.get("subject") ?? "").trim().slice(0, MAX_SUBJECT);
  const body = String(formData.get("body") ?? "").trim().slice(0, MAX_BODY);
  const askRaw = String(formData.get("ask") ?? "none");
  const ask: Ask = (ASKS as string[]).includes(askRaw) ? (askRaw as Ask) : "none";
  const familyEmails = formData.getAll("family").map(String);
  return { subject, body, ask, familyEmails };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  await requireTeamAccess(teamId, user.id);
  const formData = await request.formData();
  const intent = formData.get("_action");
  const { subject, body, ask, familyEmails } = readForm(formData);

  if (!subject || !body) return data({ error: "Add a subject and a message.", tested: false }, { status: 400 });
  if (!isEmailConfigured()) return data({ error: "Email isn't set up on this server.", tested: false }, { status: 503 });

  if (intent === "test") {
    const result = await sendTestAnnouncement({ request, teamId, coach: user, subject, body, ask });
    return data(result.sent ? { error: null, tested: true } : { error: result.error ?? "The test didn't send.", tested: false });
  }

  if (intent === "send") {
    if (familyEmails.length === 0) return data({ error: "Pick at least one family.", tested: false }, { status: 400 });
    const announcement = await sendAnnouncement({ request, teamId, coach: user, subject, body, ask, familyEmails });
    if (!announcement) return data({ error: "None of those families are on this team.", tested: false }, { status: 400 });
    return redirect(`/dashboard/team/${teamId}/announcements/${announcement.id}`);
  }

  return data({ error: "Unknown action", tested: false }, { status: 400 });
}

export function meta({}: Route.MetaArgs) {
  return [{ title: "New announcement - AYSO Game Day" }];
}

type Audience = "all" | "app" | "email" | "pick";

const askOptions: { value: Ask; title: string; hint: string }[] = [
  { value: "none", title: "Nothing", hint: "Just sharing information" },
  { value: "ack", title: "A “Got it” tap", hint: "One button in the email. The surest way to know they read it" },
  { value: "reply", title: "A reply", hint: "Their answer lands in your inbox here, one thread per family" },
];

export default function NewAnnouncement({ loaderData, actionData }: Route.ComponentProps) {
  const { team, families, from, hasOwnAddress, emailConfigured, redirectedTo } = loaderData;
  const base = `/dashboard/team/${team.id}`;
  const navigation = useNavigation();
  const busy = navigation.state === "submitting" ? String(navigation.formData?.get("_action")) : null;

  const [audience, setAudience] = useState<Audience>("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [ask, setAsk] = useState<Ask>("none");
  const [confirming, setConfirming] = useState(false);

  const onApp = families.filter((f) => f.onApp).length;
  const selected = useMemo(() => {
    if (audience === "all") return families;
    if (audience === "app") return families.filter((f) => f.onApp);
    if (audience === "email") return families.filter((f) => !f.onApp);
    return families.filter((f) => picked.has(f.email));
  }, [audience, families, picked]);
  const selectedOnApp = selected.filter((f) => f.onApp).length;

  const audiences: { value: Audience; label: string; count: number }[] = [
    { value: "all", label: "Everyone", count: families.length },
    { value: "app", label: "On the app", count: onApp },
    { value: "email", label: "Not on the app", count: families.length - onApp },
    { value: "pick", label: "Pick families", count: picked.size },
  ];

  return (
    <Page width="narrow">
      <PageHeader back={{ to: `${base}/announcements`, label: "Announcements" }} title="New announcement" />

      {!emailConfigured && <Alert className="mb-4">Email isn't set up on this server, so announcements can't be sent.</Alert>}
      {redirectedTo && (
        <Alert tone="warning" className="mb-4">
          Test mode (not production): every family's copy goes to <strong>{redirectedTo}</strong> instead of the family. Set
          EMAIL_DELIVER_TO_FAMILIES=true to send for real outside production.
        </Alert>
      )}
      {actionData?.error && <Alert className="mb-4">{actionData.error}</Alert>}
      {actionData?.tested && (
        <Alert tone="success" className="mb-4">
          Test sent to your inbox. It's how families will see it.
        </Alert>
      )}

      <Form method="post" className="space-y-6" onSubmit={() => setConfirming(false)}>
        {selected.map((f) => (
          <input key={f.email} type="hidden" name="family" value={f.email} />
        ))}

        <Card className="p-5" data-tour="announcement-audience">
          <p className={labelClass}>To</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Who gets it">
            {audiences.map((a) => (
              <button
                key={a.value}
                type="button"
                role="radio"
                aria-checked={audience === a.value}
                onClick={() => setAudience(a.value)}
                className={cx(
                  "inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold ring-1 transition",
                  audience === a.value ? "bg-primary text-white ring-primary" : "bg-surface text-ink ring-line-strong hover:bg-surface-2"
                )}
              >
                {a.label}
                <span className={cx("tabular", audience === a.value ? "text-white/80" : "text-muted")}>{a.count}</span>
              </button>
            ))}
          </div>

          {audience === "pick" && (
            <ul className="mt-4 max-h-72 divide-y divide-line overflow-y-auto rounded-xl ring-1 ring-line">
              {families.map((f) => (
                <li key={f.email}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-surface-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--color-primary)]"
                      checked={picked.has(f.email)}
                      onChange={(e) => {
                        const next = new Set(picked);
                        if (e.target.checked) next.add(f.email);
                        else next.delete(f.email);
                        setPicked(next);
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">{f.label}</span>
                    {f.onApp && <Badge tone="success">App</Badge>}
                  </label>
                </li>
              ))}
            </ul>
          )}

          <p className={hintClass}>
            {selected.length === 0
              ? "No families selected."
              : `${selected.length} ${selected.length === 1 ? "family" : "families"} by email${selectedOnApp ? `, and ${selectedOnApp} also in the app with a notification` : ""}.`}{" "}
            Families with no email on file aren't listed.{" "}
            <Link to={`${base}/contacts`} className="font-medium text-primary hover:underline">Contacts</Link>
          </p>
        </Card>

        <Card className="space-y-4 p-5">
          <div>
            <p className="mb-1 text-xs text-muted">
              From <span className="font-medium text-ink">{from}</span>
              {!hasOwnAddress && (
                <>
                  {" · "}
                  <Link to={`${base}/settings#your-email`} className="font-medium text-primary hover:underline">Use your own address</Link>
                </>
              )}
            </p>
          </div>
          <div>
            <label htmlFor="subject" className={labelClass}>Subject</label>
            <input id="subject" name="subject" required maxLength={MAX_SUBJECT} className={inputClass} placeholder="Picture day is Saturday" />
          </div>
          <div>
            <label htmlFor="body" className={labelClass}>Message</label>
            <textarea
              id="body"
              name="body"
              required
              rows={8}
              maxLength={MAX_BODY}
              className={cx(inputClass, "h-auto min-h-40 py-2.5 leading-relaxed")}
              placeholder={"Hi families,\n\nPictures are Saturday at 8:00 before the game. Wear the full uniform..."}
            />
            <p className={hintClass}>Each family gets their own email. Replies come back to you here, never to the other families.</p>
          </div>
        </Card>

        <Card className="p-5" data-tour="announcement-ask">
          <p className={labelClass}>Ask families for</p>
          <div className="space-y-2" role="radiogroup">
            {askOptions.map((o) => (
              <label
                key={o.value}
                className={cx(
                  "flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 transition",
                  ask === o.value ? "bg-primary-soft ring-primary" : "ring-line hover:bg-surface-2"
                )}
              >
                <input type="radio" name="ask" value={o.value} checked={ask === o.value} onChange={() => setAsk(o.value)} className="mt-1 accent-[var(--color-primary)]" />
                <span>
                  <span className="block text-sm font-semibold">{o.title}</span>
                  <span className="block text-sm text-muted">{o.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </Card>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button type="submit" name="_action" value="test" variant="secondary" disabled={busy !== null || !emailConfigured} formNoValidate={false}>
            <EnvelopeSimple size={18} />
            {busy === "test" ? "Sending test…" : "Send a test to me"}
          </Button>

          {confirming ? (
            <div className="flex items-center gap-2 rounded-xl bg-warning-soft p-2 pl-3">
              <Warning size={18} className="shrink-0 text-warning" />
              <span className="text-sm font-medium">
                Email {selected.length} {selected.length === 1 ? "family" : "families"}?
              </span>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>Cancel</Button>
              <Button type="submit" name="_action" value="send" size="sm" disabled={busy !== null}>
                {busy === "send" ? "Sending…" : "Send"}
              </Button>
            </div>
          ) : (
            <Button
              disabled={selected.length === 0 || busy !== null || !emailConfigured}
              onClick={(e) => {
                const form = e.currentTarget.form;
                if (form && !form.reportValidity()) return;
                setConfirming(true);
              }}
            >
              <PaperPlaneTilt size={18} />
              Send to {selected.length} {selected.length === 1 ? "family" : "families"}
            </Button>
          )}
        </div>
        {busy === "send" && (
          <p className="flex items-center justify-end gap-1.5 text-sm text-muted">
            <CheckCircle size={16} /> Sending one email per family. This takes a few seconds.
          </p>
        )}
      </Form>
    </Page>
  );
}
