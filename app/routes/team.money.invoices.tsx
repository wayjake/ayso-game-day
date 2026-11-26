import type { Route } from "./+types/team.money.invoices";
import { useEffect, useState } from "react";
import { data, useFetcher } from "react-router";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import { invoicePreview, sendInvoices, teamInvoices } from "~/utils/billing.server";
import { FormError, newFormKey, runLedgerAction } from "~/utils/ledger-forms.server";
import { formatCents } from "~/utils/money";
import { Amount } from "~/components/money";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Page, PageHeader, cx } from "~/components/ui";
import { CaretDown, CheckCircle, Invoice, LinkSimple, PaperPlaneTilt } from "@phosphor-icons/react";
import { teamIdFromCode } from "~/utils/team-access.server";
import { teamPath } from "~/utils/team-path";

export function meta() {
  return [{ title: "Invoices - Finances - BenchTalk" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const { team } = await requireTeamAccess((await teamIdFromCode(params.teamCode)), user.id);
  const [preview, sent] = await Promise.all([invoicePreview(team.id), teamInvoices(team.id)]);
  return data({ teamId: team.id, teamCode: team.code, formKey: newFormKey(), preview, sent });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await getUser(request);
  const { team } = await requireTeamAccess((await teamIdFromCode(params.teamCode)), user.id);
  const formData = await request.formData();
  if (formData.get("_action") !== "send") return data({ ok: false as const, error: "Unknown action" }, { status: 400 });
  return runLedgerAction(async () => {
    const key = String(formData.get("sendKey") ?? "");
    if (!key) throw new FormError("Reload the page and try again");
    const origin = process.env.APP_URL?.replace(/\/$/, "") || new URL(request.url).origin;
    await sendInvoices(team.id, user.id, key, origin);
  });
}

export default function Invoices({ loaderData }: Route.ComponentProps) {
  const { teamCode, formKey, preview, sent } = loaderData;
  const base = teamPath(teamCode, "finances");

  return (
    <Page>
      <PageHeader
        back={{ to: base, label: "Finances" }}
        title="Invoices"
        description="One bill per family, with every share not yet invoiced, for all their kids. Each family gets it by email with a link to pay on Venmo, no sign-in needed. Once sent, an invoice never changes: anything later goes on the next one."
      />

      <section>
        <CardHeader title="Ready to send" count={preview.drafts.length} className="mb-3" />
        {preview.drafts.length === 0 ? (
          <Card>
            <EmptyState icon={<Invoice size={24} />} title="Nothing to invoice">
              When you add an expense or change who shares one, it shows up here until you send it.
            </EmptyState>
          </Card>
        ) : (
          <>
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {preview.drafts.map((d) => (
                <li key={d.familyKey}>
                  <Card className="h-full p-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="min-w-0 font-semibold">{d.familyName}</p>
                      <Amount cents={d.totalCents} className="font-semibold" />
                    </div>
                    <ul className="mt-2 space-y-1 text-sm">
                      {d.lines.map((l, i) => (
                        <li key={i} className="flex justify-between gap-3 text-muted">
                          <span className="min-w-0">
                            {l.label}
                            {d.lines.some((o) => o.who !== l.who) && <span className="text-subtle"> · {l.who.split(" ")[0]}</span>}
                          </span>
                          <Amount cents={l.cents} />
                        </li>
                      ))}
                    </ul>
                  </Card>
                </li>
              ))}
            </ul>
            <SendBar formKey={formKey} families={preview.drafts.length} totalCents={preview.totalCents} />
          </>
        )}
      </section>

      <section className="mt-10">
        <CardHeader title="Sent" count={sent.length} className="mb-3" />
        {sent.length === 0 ? (
          <p className="text-sm text-muted">No invoices sent yet.</p>
        ) : (
          <Card>
            <ul className="divide-y divide-line">
              {sent.map((inv) => (
                <SentRow key={inv.id} inv={inv} />
              ))}
            </ul>
          </Card>
        )}
      </section>
    </Page>
  );
}

function SendBar({ formKey, families, totalCents }: { formKey: string; families: number; totalCents: number }) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  // A second tap confirms, since sending notifies every family on it
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);
  const busy = fetcher.state !== "idle";
  return (
    <fetcher.Form method="post" className="sticky bottom-4 z-10 mt-4">
      <input type="hidden" name="_action" value="send" />
      <input type="hidden" name="sendKey" value={formKey} />
      {fetcher.data?.error && <Alert className="mb-3">{fetcher.data.error}</Alert>}
      <Card className="flex flex-wrap items-center gap-3 p-4 shadow-lg">
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-semibold">
            {families} {families === 1 ? "invoice" : "invoices"} · {formatCents(totalCents)}
          </span>
          <span className="block text-muted">Each family gets an email with a link to pay, no sign-in needed. Parents on the app get a notification too.</span>
        </p>
        <Button
          type="submit"
          variant={armed ? "danger" : "primary"}
          disabled={busy}
          onClick={(e) => {
            if (!armed) {
              e.preventDefault();
              setArmed(true);
            }
          }}
        >
          <PaperPlaneTilt size={18} />
          {busy ? "Sending…" : armed ? "Tap again to send" : `Send ${families === 1 ? "it" : `all ${families}`}`}
        </Button>
      </Card>
    </fetcher.Form>
  );
}

type Sent = Route.ComponentProps["loaderData"]["sent"][number];

// The family's no-sign-in page, to text them; it's also in their invoice email
function CopyPayLink({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(`${window.location.origin}${path}`).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="tap mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
    >
      {copied ? <CheckCircle size={16} weight="fill" /> : <LinkSimple size={16} />}
      {copied ? "Copied" : "Copy pay link"}
    </button>
  );
}

function SentRow({ inv }: { inv: Sent }) {
  const status =
    inv.totalCents <= 0 ? <Badge tone="success">Money back</Badge>
    : inv.remaining === 0 ? <Badge tone="success">Paid</Badge>
    : inv.paid > 0 ? <Badge tone="warning">{formatCents(inv.remaining)} left</Badge>
    : <Badge tone="danger">Due</Badge>;
  return (
    <li>
      <details className="group">
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
          <span className="w-10 shrink-0 text-muted tabular">#{inv.number}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{inv.familyName}</span>
            <span className="block text-xs text-muted">{inv.issuedAt.slice(0, 10)}</span>
          </span>
          {status}
          <Amount cents={inv.totalCents} className="w-20 text-right font-semibold" />
          <CaretDown size={16} className="shrink-0 text-muted transition group-open:rotate-180" aria-hidden />
        </summary>
        <div className="border-t border-line bg-surface-2 px-4 py-3 text-sm">
          <ul className="space-y-1">
            {inv.lines.map((l, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span className="min-w-0 text-muted">{l.label}</span>
                <Amount cents={l.cents} />
              </li>
            ))}
          </ul>
          {inv.payPath && <CopyPayLink path={inv.payPath} />}
        </div>
      </details>
    </li>
  );
}
