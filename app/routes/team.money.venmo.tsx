import type { Route } from "./+types/team.money.venmo";
import { useEffect, useState } from "react";
import { Link, data, useRevalidator } from "react-router";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db, inboundEmails } from "~/db";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess, teamIdFromCode } from "~/utils/team-access.server";
import { teamPath } from "~/utils/team-path";
import { formatCents } from "~/utils/money";
import { venmoSetupStatus } from "~/utils/venmo-payments.server";
import { VENMO_SENDER } from "~/utils/venmo-email";
import { Alert, Card, Page, PageHeader, buttonClass, cx } from "~/components/ui";
import { ArrowSquareOut, CheckCircle, Copy, EnvelopeSimple } from "@phosphor-icons/react";

export function meta() {
  return [{ title: "Match Venmo payments - BenchTalk" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const { team } = await requireTeamAccess(await teamIdFromCode(params.teamCode), user.id);
  const status = await venmoSetupStatus(team.id);

  // Any other email that reached the address lately (another provider's
  // confirmation, say), so the coach can read it here. Staff only.
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const [other] = await db
    .select({ fromEmail: inboundEmails.fromEmail, subject: inboundEmails.subject, text: inboundEmails.text, receivedAt: inboundEmails.receivedAt })
    .from(inboundEmails)
    .where(
      and(
        eq(inboundEmails.teamId, team.id),
        inArray(inboundEmails.matchedBy, ["venmo", "gmail-forwarding"]),
        ne(inboundEmails.fromEmail, VENMO_SENDER)
      )
    )
    .orderBy(desc(inboundEmails.id))
    .limit(1);

  return data({
    teamCode: team.code,
    venmoHandle: team.venmoHandle,
    ...status,
    otherEmail: other && other.receivedAt > weekAgo && !status.gmailCode ? { ...other, text: (other.text ?? "").slice(0, 600) } : null,
  });
}

const GMAIL_FORWARDING = "https://mail.google.com/mail/#settings/fwdandpop";
const GMAIL_FILTER = "https://mail.google.com/mail/#create-filter/from=venmo%40venmo.com&subject=%22paid%20you%22";

export default function VenmoSetup({ loaderData: d }: Route.ComponentProps) {
  const base = teamPath(d.teamCode, "finances");
  const working = Boolean(d.lastPayment || d.lastVenmoEmailAt);

  // Gmail's code and the first payment arrive by email: check every few
  // seconds while this page is open and waiting for one
  const revalidator = useRevalidator();
  const waiting = !working && Boolean(d.address);
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && revalidator.state === "idle") revalidator.revalidate();
    }, 5000);
    return () => clearInterval(timer);
  }, [waiting, revalidator]);

  return (
    <Page width="narrow">
      <PageHeader
        back={{ to: base, label: "Finances" }}
        title="Match Venmo payments"
        description="Venmo emails you every time someone pays you. Have your inbox forward those emails here, and each payment shows up in Finances matched to its family, ready to record with one tap."
      />

      {!d.venmoHandle ? (
        <Alert tone="warning">
          Add the team's Venmo account on <Link to={base} className="underline">Finances</Link> first, so families know where to pay.
        </Alert>
      ) : !d.address ? (
        <Alert tone="warning">Email isn't set up on this server, so there's no address to forward to.</Alert>
      ) : (
        <div className="space-y-6">
          {working ? (
            <Alert tone="success" className="flex items-start gap-2">
              <CheckCircle size={20} weight="fill" className="mt-px shrink-0" />
              <span>
                It's working.{" "}
                {d.lastPayment
                  ? `The last payment was ${formatCents(d.lastPayment.cents)} from ${d.lastPayment.payerName}, ${shortDate(d.lastPayment.createdAt)}.`
                  : `A Venmo email arrived ${shortDate(d.lastVenmoEmailAt!)}.`}{" "}
                New ones show up under Payments to confirm.
              </span>
            </Alert>
          ) : null}

          <Card className="p-5">
            <h2 className="font-semibold">The team's Venmo address</h2>
            <p className="mt-1 text-sm text-muted">
              Forward Venmo's payment emails here. Only emails from Venmo count: anything else sent to it is ignored.
            </p>
            <CopyField text={d.address} />
          </Card>

          <section>
            <h2 className="mb-3 font-semibold">Set it up in Gmail</h2>
            <p className="mb-4 text-sm text-muted">
              Do this in the Gmail account your Venmo emails go to (@{d.venmoHandle}'s). It takes about two minutes, on a computer.
            </p>
            <ol className="space-y-3">
              <Step n={1} title="Add the address as a forwarding address">
                <p>
                  Open Gmail's forwarding settings, click <b>Add a forwarding address</b>, paste the address above, then <b>Next</b>, <b>Proceed</b> and <b>OK</b>.
                </p>
                <ExternalLink href={GMAIL_FORWARDING}>Open forwarding settings</ExternalLink>
              </Step>

              <Step n={2} title="Enter Gmail's confirmation code">
                <p>Gmail emails a code to the address to check it's yours. It shows up right here:</p>
                {d.gmailCode ? (
                  <div className="mt-3 rounded-xl bg-primary-soft p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-primary-ink">Gmail's code</p>
                    <CopyField text={d.gmailCode.code} large />
                    {d.gmailCode.from && <p className="mt-1 text-xs text-muted">Asked for by {d.gmailCode.from}, {shortDate(d.gmailCode.receivedAt)}</p>}
                  </div>
                ) : (
                  <p className="mt-3 flex items-center gap-2 rounded-xl bg-surface-2 p-4 text-sm text-muted">
                    <EnvelopeSimple size={18} className="shrink-0" />
                    Waiting for Gmail's email. This page checks on its own.
                  </p>
                )}
                {d.otherEmail && (
                  <div className="mt-3 rounded-xl bg-surface-2 p-4 text-sm">
                    <p className="font-semibold">Latest email to this address</p>
                    <p className="text-muted">
                      From {d.otherEmail.fromEmail}, {shortDate(d.otherEmail.receivedAt)}: {d.otherEmail.subject}
                    </p>
                    <p className="mt-2 whitespace-pre-line break-words text-ink">{d.otherEmail.text}</p>
                  </div>
                )}
                <p className="mt-3">
                  Back in Gmail's forwarding settings, paste the code, click <b>Verify</b>, then leave <b>Disable forwarding</b> selected and <b>Save Changes</b>. The filter in the next step forwards only Venmo's payment emails, never the rest of your mail.
                </p>
              </Step>

              <Step n={3} title="Forward Venmo's payment emails">
                <p>
                  Open the filter below. Gmail fills in <b>From: venmo@venmo.com</b> and <b>Subject: "paid you"</b>, with the quotes, so only payments to you match, not the ones you send. Click <b>Create filter</b>, tick <b>Forward it to</b>, pick the address above, and click <b>Create filter</b> again.
                </p>
                <ExternalLink href={GMAIL_FILTER}>Open the filter</ExternalLink>
                <p className="mt-2 text-xs text-muted">
                  If it opens without the filter, click the sliders at the right of Gmail's search bar and fill in those two boxes yourself, quotes included.
                </p>
              </Step>

              <Step n={4} title="That's it">
                <p>
                  The next time someone pays @{d.venmoHandle}, it appears on Finances under Payments to confirm, matched by the invoice number or ref code in their Venmo note. Check it and tap <b>Record it</b>. Nothing is recorded until you do.
                </p>
                {!working && <p className="mt-2 text-muted">To try it now, have someone send you $1 on Venmo.</p>}
              </Step>
            </ol>
          </section>

          <Card className="space-y-3 p-5 text-sm">
            <h2 className="font-semibold">Good to know</h2>
            <p>
              <b>Work or school Gmail?</b> Your admin may block forwarding outside the organization. If Gmail won't add the address, or the code never shows up, put a personal email on your Venmo account instead.
            </p>
            <p>
              <b>Not Gmail?</b> Outlook, iCloud and Yahoo can do the same with a rule: emails from venmo@venmo.com whose subject contains "paid you", forwarded to the address above. If they send a confirmation, it shows up in step 2.
            </p>
            <p>
              <b>When the note doesn't say who it's from</b> (someone typed their own), the payment still shows up, and you pick the family. Next time that person pays, it remembers them.
            </p>
          </Card>
        </div>
      )}
    </Page>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li>
      <Card className="flex gap-4 p-5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-bold text-primary-ink">{n}</span>
        <div className="min-w-0 flex-1 text-sm">
          <h3 className="mb-1 font-semibold text-ink">{title}</h3>
          {children}
        </div>
      </Card>
    </li>
  );
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: "secondary", size: "sm", className: "mt-3" })}>
      {children}
      <ArrowSquareOut size={16} />
    </a>
  );
}

function CopyField({ text, large = false }: { text: string; large?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className={cx(
        "mt-3 flex w-full items-center justify-between gap-3 rounded-xl bg-surface px-4 py-3 text-left font-mono font-semibold text-ink ring-1 ring-field hover:ring-primary",
        large ? "text-2xl tracking-widest" : "text-sm break-all"
      )}
    >
      <span className="min-w-0">{text}</span>
      <span className="flex shrink-0 items-center gap-1 font-sans text-xs font-semibold text-primary">
        {copied ? <CheckCircle size={16} weight="fill" className="text-success" /> : <Copy size={16} />}
        {copied ? "Copied" : "Copy"}
      </span>
    </button>
  );
}

function shortDate(iso: string) {
  const date = new Date(iso.includes("T") || iso.includes(" ") ? iso.replace(" ", "T") + (iso.endsWith("Z") || iso.includes("+") ? "" : "Z") : `${iso}T12:00:00`);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
