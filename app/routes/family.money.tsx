import type { Route } from "./+types/family.money";
import { data } from "react-router";
import { useState } from "react";
import { getCoachUserIds, requireParent, requireParentOnTeam } from "~/utils/family.server";
import { createClaim, getFamilyMoney, teamCodeFor, withdrawClaim, type FamilyTeamMoney } from "~/utils/ledger.server";
import { familyInvoices, type InvoiceView } from "~/utils/billing.server";
import { FormError, newFormKey, readCents, readClientKey, readId, readMethod, readText, runLedgerAction } from "~/utils/ledger-forms.server";
import { sendPush } from "~/utils/push.server";
import { METHOD_LABELS } from "~/utils/ledger";
import { formatCents, plainAmount } from "~/utils/money";
import { Amount, InvoiceCard, LedgerForm, MethodField, MoneyField, TextField, memberLineText } from "~/components/money";
import { Badge, Card, buttonClass, cx } from "~/components/ui";
import { CheckCircle, Copy, HourglassMedium } from "@phosphor-icons/react";
import { parseId } from "~/utils/ids";
import { teamPath } from "~/utils/team-path";

export function meta() {
  return [{ title: "Finances - BenchTalk" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user, kids } = await requireParent(request);
  const money = await getFamilyMoney(user.id, kids);
  const teams = await Promise.all(
    money.map(async (t) => ({ ...t, invoices: await familyInvoices(t.teamId, kids.filter((k) => k.teamId === t.teamId).map((k) => k.playerId)) }))
  );
  return data({ teams, formKey: newFormKey(), multipleTeams: teams.length > 1 });
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = formData.get("_action");

  if (intent === "claim") {
    const teamId = parseId(formData.get("teamId"));
    if (!teamId) throw new Response("Team not found", { status: 404 });
    const { user, kidsOnTeam } = await requireParentOnTeam(request, teamId);
    return runLedgerAction(async () => {
      const cents = readCents(formData, "cents", "how much you sent");
      // Who it's for: their kids on this team who owe something, or all of them
      const [money] = await getFamilyMoney(user.id, kidsOnTeam);
      const owing = money?.kids.filter((k) => k.statement.owed > 0).map((k) => k.playerId) ?? [];
      const playerIds = owing.length ? owing : kidsOnTeam.map((k) => k.playerId);
      const method = readMethod(formData);
      await createClaim({ teamId, userId: user.id, playerIds, cents, method, note: readText(formData, "note", 300), clientKey: readClientKey(formData) });
      const who = user.name || user.email.split("@")[0];
      await sendPush(await getCoachUserIds(teamId), "payments", {
        title: `${who} sent ${formatCents(cents)}`,
        body: `On ${METHOD_LABELS[method]}. Confirm it once it arrives.`,
        url: teamPath(await teamCodeFor(teamId), "finances"),
        tag: `ledger-claim-${teamId}`,
      });
    });
  }

  if (intent === "withdraw") {
    const { user } = await requireParent(request);
    return runLedgerAction(async () => {
      await withdrawClaim(user.id, readId(formData, "claimId"));
    });
  }

  return runLedgerAction(async () => {
    throw new FormError("Unknown action");
  });
}

export default function FamilyMoney({ loaderData }: Route.ComponentProps) {
  const { teams, formKey, multipleTeams } = loaderData;

  return (
    <div className="space-y-8 pt-6 pb-8 sm:pt-8">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Finances</h1>
        <p className="mt-1 text-muted">What you owe the team, what you've paid, and anything coming back to you.</p>
      </div>

      {teams.map((t) => (
        <TeamMoney key={t.teamId} money={t} formKey={formKey} showTeam={multipleTeams} />
      ))}
    </div>
  );
}

function venmoLink(handle: string, cents: number, note: string) {
  const params = new URLSearchParams({ txn: "pay", amount: plainAmount(cents), note, audience: "private" });
  return `https://venmo.com/${encodeURIComponent(handle)}?${params.toString()}`;
}

function TeamMoney({ money, formKey, showTeam }: { money: FamilyTeamMoney & { invoices: InvoiceView[] }; formKey: string; showTeam: boolean }) {
  const [telling, setTelling] = useState(false);
  const note = `${money.teamName} · ref ${money.refCode}`;
  const nothingYet = money.history.length === 0 && money.pending.length === 0 && money.invoices.length === 0;

  return (
    <section className="space-y-4">
      {showTeam && <h2 className="font-display text-xl font-bold">{money.teamName}</h2>}

      <Card className="p-5">
        {nothingYet ? (
          <p className="text-muted">Nothing to pay yet. When the coach sends an invoice, it shows up here.</p>
        ) : money.owed > 0 ? (
          <>
            <p className="text-sm text-muted">You owe</p>
            <p className="font-display text-4xl font-bold"><Amount cents={money.owed} /></p>
            {money.venmoHandle ? (
              <div className="mt-4 space-y-3">
                <a href={venmoLink(money.venmoHandle, money.owed, note)} className={buttonClass({ size: "lg", className: "w-full sm:w-auto" })}>
                  Pay {formatCents(money.owed)} on Venmo
                </a>
                <p className="text-sm text-muted">
                  Or send it yourself to <CopyText text={`@${money.venmoHandle}`} /> with the note <CopyText text={note} />, so the coach knows it's from you.
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted">Pay the coach the way they asked (cash, check or Venmo), then tell them below.</p>
            )}
          </>
        ) : money.dueBack > 0 ? (
          <>
            <p className="text-sm text-muted">The team owes you</p>
            <p className="font-display text-4xl font-bold text-success"><Amount cents={money.dueBack} /></p>
            <p className="mt-1 text-sm text-muted">The coach pays it back, or it counts toward your next invoice.</p>
          </>
        ) : (
          <p className="flex items-center gap-2 font-semibold text-success">
            <CheckCircle size={22} weight="fill" />
            You're all paid up.
          </p>
        )}

        {money.pending.map((p) => (
          <PendingClaim key={p.id} claim={p} />
        ))}

        {!nothingYet && (
          <div className="mt-4 border-t border-line pt-4">
            {telling ? (
              <LedgerForm intent="claim" formKey={formKey} submitLabel="Tell the coach" onDone={() => setTelling(false)}>
                <input type="hidden" name="teamId" value={money.teamId} />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <MoneyField name="cents" id={`claim-${money.teamId}`} label="How much you sent" defaultCents={money.owed || null} />
                  <MethodField />
                </div>
                <TextField name="note" label="Anything the coach should know" placeholder="Sent from my husband's account" />
              </LedgerForm>
            ) : (
              <button type="button" onClick={() => setTelling(true)} className={buttonClass({ variant: "secondary" })}>
                I sent a payment
              </button>
            )}
          </div>
        )}
      </Card>

      {money.invoices.length > 0 && (
        <section>
          <h3 className="mb-2 font-semibold">Invoices</h3>
          <ul className="space-y-3">
            {money.invoices.map((inv) => (
              <InvoiceCard key={inv.id} inv={inv} />
            ))}
          </ul>
        </section>
      )}

      {money.kids.some((k) => k.statement.items.length > 0) && (
        <Card>
          <h3 className="px-5 pt-4 font-semibold">Your shares</h3>
          <ul className="divide-y divide-line">
            {money.kids.flatMap((k) =>
              k.statement.items.map((s) => {
                const item = money.items.find((i) => i.id === s.itemId);
                return (
                  <li key={`${k.playerId}-${s.itemId}`} className="px-5 py-3.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="min-w-0 font-semibold">
                        <span className="font-normal text-muted">Your share of </span>
                        {item?.name}
                        {money.kids.length > 1 && <span className="ml-1.5 font-normal text-muted">{k.name.split(" ")[0]}</span>}
                      </p>
                      <Amount cents={s.charged} className="shrink-0 font-semibold" />
                    </div>
                    {item?.details && <p className="mt-0.5 text-sm text-muted">{item.details}</p>}
                    <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm">
                      {s.remaining === 0 ? (
                        <Badge tone="success">{s.covered >= s.charged ? "Covered by the team" : "Paid"}</Badge>
                      ) : (
                        <Badge tone="danger">{formatCents(s.remaining)} left</Badge>
                      )}
                      {s.covered > 0 && s.covered < s.charged && <Badge>{formatCents(s.covered)} covered by the team</Badge>}
                      {s.credited > 0 && <Badge tone="primary">{formatCents(s.credited)} refunded</Badge>}
                      {item?.dueDate && s.remaining > 0 && <span className="text-muted">Due {item.dueDate}</span>}
                    </p>
                  </li>
                );
              })
            )}
          </ul>
        </Card>
      )}

      {money.funds.length > 0 && money.funds.some((f) => f.balance !== 0) && (
        <div className="flex flex-wrap gap-2 text-sm">
          {money.funds.map((f) => (
            <span key={f.id} className="rounded-lg bg-surface px-3 py-1.5 ring-1 ring-line">
              {f.name}: <Amount cents={f.balance} className="font-semibold" />
            </span>
          ))}
        </div>
      )}

      {money.history.length > 0 && (
        <details className="group">
          <summary className="tap cursor-pointer list-none text-sm font-semibold text-primary [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Show history</span>
            <span className="hidden group-open:inline">Hide history</span>
          </summary>
          <Card className="mt-3">
            <ul className="divide-y divide-line">
              {money.history.filter((h) => !h.reversed && h.kind !== "reversal").map((h, i) => (
                <li key={`${h.txnId}-${h.playerId}-${i}`} className="flex items-baseline justify-between gap-3 px-5 py-3 text-sm">
                  <span className="min-w-0">
                    {h.kind === "payment" ? (h.paidByYou ? "You paid" : "Payment received") + (h.method ? ` · ${METHOD_LABELS[h.method]}` : "") : memberLineText(h)}
                    {money.kids.length > 1 && <span className="text-muted"> · {money.kids.find((k) => k.playerId === h.playerId)?.name.split(" ")[0]}</span>}
                    {h.memo && h.kind !== "payment" && <span className="block text-muted">{h.memo}</span>}
                    <span className="block text-xs text-muted">{h.occurredOn}</span>
                  </span>
                  <span className={cx("shrink-0 font-semibold tabular", h.cents < 0 && "text-success")}>
                    {h.cents < 0 ? "−" : ""}
                    {formatCents(Math.abs(h.cents))}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </details>
      )}
    </section>
  );
}

function PendingClaim({ claim }: { claim: { id: string; cents: number; method: "venmo" | "cash" | "check" | "other" } }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-warning-soft px-4 py-3 text-sm">
      <HourglassMedium size={18} className="shrink-0 text-warning" />
      <p className="min-w-0 flex-1">
        You sent <Amount cents={claim.cents} className="font-semibold" /> on {METHOD_LABELS[claim.method]}. Waiting for the coach to confirm it arrived.
      </p>
      <LedgerForm intent="withdraw" formKey={`withdraw-${claim.id}`} submitLabel="Cancel" variant="secondary" className="space-y-0">
        <input type="hidden" name="claimId" value={claim.id} />
      </LedgerForm>
    </div>
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
