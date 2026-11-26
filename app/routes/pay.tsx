import type { Route } from "./+types/pay";
import { useState } from "react";
import { Link, data } from "react-router";
import { findPayFamily, payView } from "~/utils/billing.server";
import { formatCents, plainAmount } from "~/utils/money";
import { AppMark } from "~/components/AppMark";
import { Amount, InvoiceCard } from "~/components/money";
import { Card, buttonClass } from "~/components/ui";
import { CheckCircle, Copy, LinkBreak } from "@phosphor-icons/react";

// A family's invoices without signing in, from the link in their invoice
// email (or one the coach texted). Read only: paying happens on Venmo, and
// the coach marks it paid once it arrives.

export function meta({}: Route.MetaArgs) {
  return [{ title: "Pay - BenchTalk" }, { name: "robots", content: "noindex" }];
}

export async function loader({ params }: Route.LoaderArgs) {
  const found = await findPayFamily(params.token);
  if (!found) return data({ found: false as const });
  const view = await payView(found.team.id, found.kids.map((k) => k.id));
  const open = view.invoices.filter((i) => i.remaining > 0).map((i) => i.number).sort((a, b) => a - b);
  return data({
    found: true as const,
    teamName: found.team.name,
    venmoHandle: found.team.venmoHandle,
    kids: found.kids.map((k) => k.name.split(" ")[0]),
    ...view,
    // The coach matches a payment by invoice number; no kids' names in a Venmo feed
    note: `${found.team.name} · ${open.length ? `invoice ${open.map((n) => `#${n}`).join(", ")}` : "payment"}`,
  });
}

function venmoLink(handle: string, cents: number, note: string) {
  const params = new URLSearchParams({ txn: "pay", amount: plainAmount(cents), note, audience: "private" });
  return `https://venmo.com/${encodeURIComponent(handle)}?${params.toString()}`;
}

export default function Pay({ loaderData }: Route.ComponentProps) {
  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <header className="border-b border-line bg-surface pt-[var(--safe-top)]">
        <div className="mx-auto flex h-14 max-w-xl items-center px-safe">
          <AppMark />
        </div>
      </header>
      <main className="mx-auto max-w-xl space-y-6 px-safe pt-6 pb-16">
        {!loaderData.found ? (
          <Card className="p-6 text-center">
            <LinkBreak size={28} className="mx-auto text-muted" />
            <p className="mt-3 font-semibold">This link doesn't work</p>
            <p className="mt-1 text-sm text-muted">Ask your coach for a new one.</p>
          </Card>
        ) : (
          <PayPage data={loaderData} />
        )}
      </main>
    </div>
  );
}

function PayPage({ data: d }: { data: Extract<Route.ComponentProps["loaderData"], { found: true }> }) {
  return (
    <>
      <div>
        <p className="text-sm font-semibold text-muted">{d.teamName}</p>
        <h1 className="font-display text-3xl font-bold tracking-tight">{d.kids.join(" & ")}</h1>
      </div>

      <Card className="p-5">
        {d.owed > 0 ? (
          <>
            <p className="text-sm text-muted">You owe</p>
            <p className="font-display text-4xl font-bold"><Amount cents={d.owed} /></p>
            {d.venmoHandle ? (
              <div className="mt-4 space-y-3">
                <a href={venmoLink(d.venmoHandle, d.owed, d.note)} className={buttonClass({ size: "lg", className: "w-full sm:w-auto" })}>
                  Pay {formatCents(d.owed)} on Venmo
                </a>
                <p className="text-sm text-muted">
                  Or send it yourself to <CopyText text={`@${d.venmoHandle}`} /> with the note <CopyText text={d.note} />, so the coach knows it's from you.
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted">Pay the coach the way they asked, and they'll mark it paid.</p>
            )}
            <p className="mt-3 text-sm text-muted">The coach marks it paid once it arrives, so it can take a day to show here.</p>
          </>
        ) : d.dueBack > 0 ? (
          <>
            <p className="text-sm text-muted">The team owes you</p>
            <p className="font-display text-4xl font-bold text-success"><Amount cents={d.dueBack} /></p>
            <p className="mt-1 text-sm text-muted">The coach pays it back, or it counts toward your next invoice.</p>
          </>
        ) : (
          <p className="flex items-center gap-2 font-semibold text-success">
            <CheckCircle size={22} weight="fill" />
            You're all paid up.
          </p>
        )}
      </Card>

      {d.invoices.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Invoices</h2>
          <ul className="space-y-3">
            {d.invoices.map((inv) => (
              <InvoiceCard key={inv.id} inv={inv} />
            ))}
          </ul>
        </section>
      )}

      <p className="text-center text-sm text-muted">
        On the BenchTalk app? <Link to="/family/finances" className="font-semibold text-primary hover:underline">See it there</Link>
      </p>
    </>
  );
}

function CopyText({ text }: { text: string }) {
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
      className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] font-semibold text-ink ring-1 ring-line hover:bg-primary-soft"
      title="Copy"
    >
      {text}
      {copied ? <CheckCircle size={14} weight="fill" className="text-success" /> : <Copy size={14} />}
    </button>
  );
}
