import type { Route } from "./+types/team.money";
import { Link, data, useFetcher } from "react-router";
import { and, eq } from "drizzle-orm";
import { db, ledgerClaims, teams } from "~/db";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import {
  LedgerError,
  activityNames,
  cleanVenmoHandle,
  describeBook,
  ensureDefaultFund,
  fundBalances,
  getItems,
  getMembers,
  loadBook,
  memberKey,
  pendingClaims,
  recordPayment,
  reverseTxn,
  summarizeItems,
} from "~/utils/ledger.server";
import { newFormKey, readCents, readClientKey, readDate, readId, readMethod, runLedgerAction } from "~/utils/ledger-forms.server";
import { CATEGORY_LABELS, METHOD_LABELS } from "~/utils/ledger";
import { sumCents } from "~/utils/money";
import { todayISO } from "~/utils/dates";
import { Amount, Balance, DateField, LedgerForm, MethodField, MoneyField, UndoButton } from "~/components/money";
import { Badge, Card, CardHeader, EmptyState, Page, PageHeader, buttonClass, cx, inputClass, labelClass, hintClass } from "~/components/ui";
import { Bank, CurrencyDollar, HandCoins, PiggyBank, Plus, Receipt } from "@phosphor-icons/react";
import { useState } from "react";

export function meta() {
  return [{ title: "Finances - BenchTalk" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const { team } = await requireTeamAccess(Number(params.teamId), user.id);
  const funds = await ensureDefaultFund(team.id);
  const [book, items, claims] = await Promise.all([loadBook(team.id), getItems(team.id), pendingClaims(team.id)]);
  const members = await getMembers(team.id, book);
  const held = fundBalances(book);
  const names = await activityNames(team.id, book, members, items);
  const activity = describeBook(book, names).reverse().slice(0, 30);
  const playerName = new Map(members.filter((m) => m.member.type === "player").map((m) => [m.member.id, m.name]));

  const players = members.filter((m) => m.member.type === "player");
  const staff = members.filter((m) => m.member.type === "staff");
  return data({
    teamId: team.id,
    venmoHandle: team.venmoHandle,
    formKey: newFormKey(),
    today: todayISO(),
    cash: held.cash,
    funds: funds.map((f) => ({ id: f.id, name: f.name, visible: f.visibleToFamilies, balance: held.fund(f.id) })),
    totals: {
      owedToTeam: sumCents(members.map((m) => m.statement.owed)),
      dueBackToFamilies: sumCents(players.map((m) => m.statement.dueBack)),
      owedToStaff: sumCents(staff.map((m) => m.statement.dueBack)),
    },
    items: summarizeItems(book, items, members),
    people: members
      .filter((m) => m.onTeam || m.statement.balance !== 0)
      .map((m) => ({ key: memberKey(m.member), type: m.member.type, id: m.member.id, name: m.name, detail: m.detail, balance: m.statement.balance })),
    claims: claims.map((c) => ({ ...c, forNames: c.playerIds.map((id) => playerName.get(id) ?? "a player") })),
    activity,
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await getUser(request);
  const { team } = await requireTeamAccess(Number(params.teamId), user.id);
  const formData = await request.formData();
  const intent = formData.get("_action");

  if (intent === "venmo") {
    return runLedgerAction(async () => {
      const handle = cleanVenmoHandle(String(formData.get("venmoHandle") ?? ""));
      await db.update(teams).set({ venmoHandle: handle, updatedAt: new Date().toISOString() }).where(eq(teams.id, team.id));
    });
  }

  if (intent === "confirmClaim") {
    return runLedgerAction(async () => {
      const claimId = readId(formData, "claimId");
      const [claim] = await db.select().from(ledgerClaims).where(and(eq(ledgerClaims.id, claimId), eq(ledgerClaims.teamId, team.id))).limit(1);
      if (!claim || claim.status !== "pending") throw new LedgerError("Someone already handled that payment");
      const playerIds: number[] = JSON.parse(claim.playerIds);
      await recordPayment({
        teamId: team.id,
        members: playerIds.map((id) => ({ type: "player" as const, id })),
        cents: readCents(formData, "cents", "what arrived"),
        method: readMethod(formData),
        occurredOn: readDate(formData),
        payerUserId: claim.userId,
        createdBy: user.id,
        clientKey: readClientKey(formData),
        claimId: claim.id,
        memo: claim.note,
      });
    });
  }

  if (intent === "dismissClaim") {
    return runLedgerAction(async () => {
      const claimId = readId(formData, "claimId");
      await db
        .update(ledgerClaims)
        .set({ status: "dismissed", resolvedBy: user.id, resolvedAt: new Date().toISOString() })
        .where(and(eq(ledgerClaims.id, claimId), eq(ledgerClaims.teamId, team.id), eq(ledgerClaims.status, "pending")));
    });
  }

  if (intent === "reverse") {
    return runLedgerAction(() => reverseTxn(team.id, readId(formData, "txnId"), user.id, readClientKey(formData)));
  }

  return data({ ok: false as const, error: "Unknown action" }, { status: 400 });
}

export default function Money({ loaderData }: Route.ComponentProps) {
  const { teamId, venmoHandle, formKey, today, cash, funds, totals, items, people, claims, activity } = loaderData;
  const base = `/dashboard/team/${teamId}/finances`;
  const newItem = (
    <Link to={`${base}/items/new`} className={buttonClass()}>
      <Plus size={18} weight="bold" />
      New charge
    </Link>
  );

  return (
    <Page>
      <PageHeader
        title="Finances"
        description="What families and staff owe, what's been paid, and what's been passed on."
        actions={
          <>
            <Link to={`${base}/funds`} className={buttonClass({ variant: "secondary" })}>
              <PiggyBank size={18} />
              Funds
            </Link>
            {newItem}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Team holds" cents={cash} hint="Venmo, cash and checks received, less what's been passed on" icon={<Bank size={18} />} />
        <Stat label="Owed to the team" cents={totals.owedToTeam} icon={<HandCoins size={18} />} />
        <Stat label="Due back to families" cents={totals.dueBackToFamilies} icon={<Receipt size={18} />} />
        <Stat label="Owed to staff" cents={totals.owedToStaff} hint="Money staff fronted" icon={<CurrencyDollar size={18} />} />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-8">
          {claims.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 font-semibold">
                Payments to confirm <Badge tone="warning">{claims.length}</Badge>
              </h2>
              <ul className="space-y-3">
                {claims.map((c) => (
                  <ClaimCard key={c.id} claim={c} formKey={formKey} today={today} />
                ))}
              </ul>
            </section>
          )}

          <section>
            <CardHeader title="Charges" count={items.length} className="mb-3" />
            {items.length === 0 ? (
              <Card>
                <EmptyState icon={<Receipt size={24} />} title="Nothing charged yet" action={newItem}>
                  Make a charge for ref fees, a tournament or the hotel, and pick who pays it. Families see what they owe and pay you on Venmo.
                </EmptyState>
              </Card>
            ) : (
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {items.map((s) => {
                  const pct = s.charged ? Math.round((s.collected / s.charged) * 100) : 0;
                  return (
                    <li key={s.item.id}>
                      <Link to={`${base}/items/${s.item.id}`} className="block h-full rounded-2xl bg-surface p-4 shadow-card ring-1 ring-line transition hover:ring-line-strong">
                        <div className="flex items-start justify-between gap-3">
                          <p className="min-w-0 font-semibold">{s.item.name}</p>
                          <Amount cents={s.charged} className="font-semibold" />
                        </div>
                        <p className="mt-1 flex flex-wrap gap-1.5 text-sm text-muted">
                          <Badge>{CATEGORY_LABELS[s.item.category]}</Badge>
                          {s.item.refundable && <Badge tone="primary">Refundable</Badge>}
                          {s.item.dueDate && <span>Due {s.item.dueDate}</span>}
                        </p>
                        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                          <div className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
                        </div>
                        <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
                          <Figure label="Collected" cents={s.collected} />
                          <Figure label="Still owed" cents={s.stillOwed} />
                          <Figure label="Passed on" cents={s.passedOn} />
                        </dl>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
            <h2 className="mb-3 font-semibold">Recent activity</h2>
            {activity.length === 0 ? (
              <p className="text-sm text-muted">Nothing yet.</p>
            ) : (
              <Card>
                <ul className="divide-y divide-line">
                  {activity.map((a) => (
                    <li key={a.id} className={cx("flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 text-sm", a.reversed && "text-muted line-through decoration-1")}>
                      <span className="min-w-0 flex-1">
                        {a.text}
                        {a.memo && <span className="block text-muted no-underline">{a.memo}</span>}
                        <span className="block text-xs text-muted">
                          #{a.id} · {a.occurredOn}
                          {a.by && ` · ${a.by}`}
                        </span>
                      </span>
                      <Amount cents={a.cents} className="font-semibold" />
                      {!a.reversed && a.kind !== "reversal" && <UndoButton txnId={a.id} formKey={formKey} />}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </section>
        </div>

        <aside className="space-y-8">
          <VenmoCard handle={venmoHandle} formKey={formKey} />

          <section>
            <h2 className="mb-3 font-semibold">Funds</h2>
            <Card>
              <ul className="divide-y divide-line">
                {funds.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <span className="min-w-0">
                      <span className="font-medium">{f.name}</span>
                      {!f.visible && <span className="ml-2 text-xs text-muted">Hidden from families</span>}
                    </span>
                    <Amount cents={f.balance} className="font-semibold" />
                  </li>
                ))}
              </ul>
              <div className="border-t border-line px-4 py-3">
                <Link to={`${base}/funds`} className="text-sm font-semibold text-primary hover:underline">
                  Add money, move it or spend it
                </Link>
              </div>
            </Card>
          </section>

          <section>
            <h2 className="mb-3 font-semibold">People</h2>
            <Card>
              <ul className="divide-y divide-line">
                {people.map((p) => (
                  <li key={p.key}>
                    <Link to={`${base}/${p.type}/${p.id}`} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-surface-2">
                      <span className="min-w-0 truncate">
                        {p.name}
                        {p.detail && <span className="ml-1.5 text-muted">{p.detail}</span>}
                      </span>
                      <Balance cents={p.balance} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        </aside>
      </div>
    </Page>
  );
}

function Stat({ label, cents, hint, icon }: { label: string; cents: number; hint?: string; icon: React.ReactNode }) {
  return (
    <Card className="p-4">
      <p className="flex items-center gap-1.5 text-sm text-muted">
        {icon}
        {label}
      </p>
      <p className="mt-1 font-display text-2xl font-bold">
        <Amount cents={cents} />
      </p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </Card>
  );
}

function Figure({ label, cents }: { label: string; cents: number }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-semibold">
        <Amount cents={cents} />
      </dd>
    </div>
  );
}

function ClaimCard({
  claim,
  formKey,
  today,
}: {
  claim: { id: number; cents: number; method: "venmo" | "cash" | "check" | "other"; from: string; forNames: string[]; note: string | null; createdAt: string };
  formKey: string;
  today: string;
}) {
  const dismiss = useFetcher();
  return (
    <li>
      <Card className="p-4">
        <p className="text-sm">
          <span className="font-semibold">{claim.from}</span> says they sent <Amount cents={claim.cents} className="font-semibold" /> on {METHOD_LABELS[claim.method]} for {claim.forNames.join(" and ")}.
        </p>
        {claim.note && <p className="mt-1 text-sm text-muted">“{claim.note}”</p>}
        <LedgerForm intent="confirmClaim" formKey={`${formKey}-${claim.id}`} submitLabel="Confirm it arrived" className="mt-3">
          <input type="hidden" name="claimId" value={claim.id} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <MoneyField name="cents" id={`claim-${claim.id}-cents`} label="What arrived" defaultCents={claim.cents} />
            <MethodField defaultValue={claim.method} />
            <DateField today={today} label="Arrived" />
          </div>
        </LedgerForm>
        <dismiss.Form method="post" className="mt-2 border-t border-line pt-2">
          <input type="hidden" name="_action" value="dismissClaim" />
          <input type="hidden" name="claimId" value={claim.id} />
          <button type="submit" className="tap text-sm font-semibold text-muted hover:text-danger" disabled={dismiss.state !== "idle"}>
            It never arrived: dismiss
          </button>
        </dismiss.Form>
      </Card>
    </li>
  );
}

function VenmoCard({ handle, formKey }: { handle: string | null; formKey: string }) {
  const [editing, setEditing] = useState(!handle);
  return (
    <section>
      <h2 className="mb-3 font-semibold">Venmo</h2>
      <Card className="p-4">
        {editing ? (
          <LedgerForm intent="venmo" formKey={formKey} submitLabel="Save" onDone={() => setEditing(false)}>
            <div>
              <label htmlFor="venmoHandle" className={labelClass}>Families pay this Venmo account</label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted" aria-hidden>@</span>
                <input
                  id="venmoHandle"
                  name="venmoHandle"
                  defaultValue={handle ?? ""}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="your-venmo"
                  className={cx(inputClass, "pl-7")}
                />
              </div>
              <p className={hintClass}>Their Pay button opens Venmo with the amount filled in. Leave empty to hide it.</p>
            </div>
          </LedgerForm>
        ) : (
          <div className="flex items-center justify-between gap-3 text-sm">
            <span>
              Families pay <span className="font-semibold">@{handle}</span>
            </span>
            <button type="button" onClick={() => setEditing(true)} className="tap font-semibold text-primary hover:underline">
              Change
            </button>
          </div>
        )}
      </Card>
    </section>
  );
}
