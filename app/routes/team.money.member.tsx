import type { Route } from "./+types/team.money.member";
import { Link, data } from "react-router";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import {
  ensureDefaultFund,
  fundBalances,
  getItems,
  getMembers,
  guardianCodes,
  loadBook,
  memberKey,
  postTxn,
  recordPayment,
  reverseTxn,
} from "~/utils/ledger.server";
import { siblingIds } from "~/utils/tasks.core";
import { db } from "~/db";
import {
  FormError,
  newFormKey,
  readCents,
  readClientKey,
  readDate,
  readId,
  readMembers,
  readMethod,
  readText,
  runLedgerAction,
} from "~/utils/ledger-forms.server";
import { LedgerError, chargeLines, donationLines, refundLines, reimburseLines, type Member } from "~/utils/ledger";
import { formatCents } from "~/utils/money";
import { todayISO } from "~/utils/dates";
import { ActionPanel, Amount, Balance, Choice, DateField, LedgerForm, MemberChecklist, MethodField, MoneyField, TextField, UndoButton, memberLineText } from "~/components/money";
import { Badge, Card, Page, PageHeader, cx, hintClass, inputClass, labelClass } from "~/components/ui";
import { ArrowBendUpLeft, HandCoins, PiggyBank, Plus } from "@phosphor-icons/react";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.name ?? "Money"} - Money - BenchTalk` }];
}

function readMember(params: { memberType?: string; memberId?: string }): Member {
  const id = Number(params.memberId);
  if ((params.memberType !== "player" && params.memberType !== "staff") || !Number.isSafeInteger(id)) {
    throw new Response("Not found", { status: 404 });
  }
  return { type: params.memberType, id };
}

async function load(teamId: number, member: Member) {
  const [book, items] = await Promise.all([loadBook(teamId), getItems(teamId)]);
  const members = await getMembers(teamId, book);
  const me = members.find((m) => memberKey(m.member) === memberKey(member));
  if (!me) throw new Response("Not found", { status: 404 });
  return { book, items, members, me };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const { team } = await requireTeamAccess(Number(params.teamId), user.id);
  const member = readMember(params);
  const { book, items, members, me } = await load(team.id, member);
  const funds = await ensureDefaultFund(team.id);
  const held = fundBalances(book);

  const siblings =
    member.type === "player"
      ? [...(await siblingIds(db, team.id, [member.id]))]
          .filter((id) => id !== member.id)
          .map((id) => members.find((m) => m.member.type === "player" && m.member.id === id))
          .filter((m): m is NonNullable<typeof m> => Boolean(m))
          .map((m) => ({ key: memberKey(m.member), label: m.name, owed: m.statement.balance }))
      : [];

  const itemName = new Map(items.map((i) => [i.id, i.name]));
  const fundName = new Map(funds.map((f) => [f.id, f.name]));
  const history = book
    .flatMap((t) =>
      t.lines
        .filter((l) => l.account.type === member.type && l.account.id === member.id)
        .map((l) => ({
          txnId: t.id,
          kind: t.kind,
          cents: l.cents,
          itemName: t.itemId ? itemName.get(t.itemId) ?? null : null,
          fundName: t.fundId ? fundName.get(t.fundId) ?? null : null,
          method: t.method,
          payerName: t.payerName,
          memo: t.memo,
          occurredOn: t.occurredOn,
          reversed: t.reversed,
        }))
    )
    .reverse();

  return data({
    teamId: team.id,
    member,
    name: me.name,
    detail: me.detail,
    onTeam: me.onTeam,
    statement: me.statement,
    items: items.map((i) => ({ id: i.id, name: i.name, dueDate: i.dueDate })),
    history,
    siblings,
    codes: member.type === "player" ? await guardianCodes(team.id, member.id) : [],
    funds: funds.map((f) => ({ id: f.id, name: f.name, balance: held.fund(f.id) })),
    cash: held.cash,
    formKey: newFormKey(),
    today: todayISO(),
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await getUser(request);
  const { team } = await requireTeamAccess(Number(params.teamId), user.id);
  const member = readMember(params);
  const formData = await request.formData();
  const intent = formData.get("_action");
  const clientKey = readClientKey(formData);

  return runLedgerAction(async () => {
    const { me } = await load(team.id, member);
    switch (intent) {
      case "payment": {
        // This member, plus any siblings ticked on the form
        const others = member.type === "player" ? readMembers(formData, "sibling").filter((m) => m.type === "player" && m.id !== member.id) : [];
        const extra = String(formData.get("extra") ?? "credit");
        const donateExtraTo = extra.startsWith("fund:") ? Number(extra.slice(5)) || null : null;
        await recordPayment({
          teamId: team.id,
          members: [member, ...others],
          cents: readCents(formData, "cents"),
          donateExtraTo,
          method: readMethod(formData),
          occurredOn: readDate(formData),
          payerName: readText(formData, "payerName", 100),
          memo: readText(formData, "memo"),
          createdBy: user.id,
          clientKey,
        });
        return;
      }
      case "payBack": {
        const cents = readCents(formData, "cents");
        if (cents > me.statement.dueBack) throw new FormError(`They're only owed ${formatCents(me.statement.dueBack)}.`);
        await postTxn({
          teamId: team.id,
          kind: member.type === "staff" ? "reimburse" : "refund",
          lines: member.type === "staff" ? reimburseLines(member.id, cents) : refundLines(member, cents),
          method: readMethod(formData),
          occurredOn: readDate(formData),
          memo: readText(formData, "memo"),
          createdBy: user.id,
          clientKey,
        });
        return;
      }
      case "donateCredit": {
        const cents = readCents(formData, "cents");
        if (cents > me.statement.dueBack) throw new FormError(`They're only owed ${formatCents(me.statement.dueBack)}.`);
        const fundId = readId(formData, "fundId");
        await postTxn({ teamId: team.id, kind: "donation", fundId, lines: donationLines(fundId, cents, { type: "member", member }), createdBy: user.id, clientKey, memo: readText(formData, "memo") });
        return;
      }
      case "charge": {
        if (!me.onTeam) throw new LedgerError("They're not on the team any more");
        const itemId = readId(formData, "itemId");
        await postTxn({ teamId: team.id, kind: "charge", itemId, lines: chargeLines(itemId, [{ member, cents: readCents(formData, "cents") }]), createdBy: user.id, clientKey, memo: readText(formData, "memo") });
        return;
      }
      case "reverse":
        await reverseTxn(team.id, readId(formData, "txnId"), user.id, clientKey);
        return;
      default:
        throw new FormError("Unknown action");
    }
  });
}

export default function MemberMoney({ loaderData }: Route.ComponentProps) {
  const { teamId, member, name, detail, onTeam, statement, items, history, siblings, codes, funds, cash, formKey, today } = loaderData;
  const base = `/dashboard/team/${teamId}/money`;
  const itemName = new Map(items.map((i) => [i.id, i.name]));
  const isStaff = member.type === "staff";

  return (
    <Page>
      <PageHeader
        back={{ to: base, label: "Money" }}
        title={name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {detail && <Badge>{detail}</Badge>}
            {!isStaff && "Everything here is this player's family's."}
            {isStaff && "Their own share, and money they fronted for the team."}
          </span>
        }
        actions={<span className="text-lg"><Balance cents={statement.balance} /></span>}
      />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-8">
          {statement.items.length > 0 && (
            <Card className="overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th scope="col" className="px-4 py-3 font-semibold">For</th>
                    <th scope="col" className="px-3 py-3 text-right font-semibold">Charged</th>
                    <th scope="col" className="hidden px-3 py-3 text-right font-semibold sm:table-cell">Covered or back</th>
                    <th scope="col" className="px-3 py-3 text-right font-semibold">Paid</th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">Left</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {statement.items.map((s) => (
                    <tr key={s.itemId}>
                      <td className="px-4 py-2.5">
                        <Link to={`${base}/items/${s.itemId}`} className="font-medium hover:text-primary">{itemName.get(s.itemId)}</Link>
                      </td>
                      <td className="px-3 py-2.5 text-right"><Amount cents={s.charged} /></td>
                      <td className="hidden px-3 py-2.5 text-right text-muted sm:table-cell">{s.covered + s.credited ? <Amount cents={s.covered + s.credited} /> : "–"}</td>
                      <td className="px-3 py-2.5 text-right">{s.paid ? <Amount cents={s.paid} /> : "–"}</td>
                      <td className={cx("px-4 py-2.5 text-right font-semibold", s.remaining ? "text-danger" : "text-success")}>{s.remaining ? <Amount cents={s.remaining} /> : "Done"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {statement.unapplied > 0 && (
                <p className="border-t border-line px-4 py-3 text-sm text-muted">
                  <Amount cents={statement.unapplied} className="font-semibold text-success" /> {isStaff ? "the team owes them." : "in credit: it pays toward their next charge, or you can pay it back."}
                </p>
              )}
            </Card>
          )}

          <section>
            <h2 className="mb-3 font-semibold">History</h2>
            {history.length === 0 ? (
              <p className="text-sm text-muted">Nothing yet.</p>
            ) : (
              <Card>
                <ul className="divide-y divide-line">
                  {history.map((h, i) => (
                    <li key={`${h.txnId}-${i}`} className={cx("flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 text-sm", h.reversed && "text-muted line-through decoration-1")}>
                      <span className="min-w-0 flex-1">
                        {memberLineText(h)}
                        {h.payerName && <span className="text-muted"> · from {h.payerName}</span>}
                        {h.memo && <span className="block text-muted">{h.memo}</span>}
                        <span className="block text-xs text-muted">#{h.txnId} · {h.occurredOn}</span>
                      </span>
                      <span className={cx("font-semibold tabular", h.cents > 0 ? "" : "text-success")}>
                        {h.cents > 0 ? "" : "−"}{formatCents(Math.abs(h.cents))}
                      </span>
                      {!h.reversed && h.kind !== "reversal" && <UndoButton txnId={h.txnId} formKey={formKey} />}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </section>

          {codes.length > 0 && (
            <section>
              <h2 className="mb-1 font-semibold">Venmo note codes</h2>
              <p className="mb-3 text-sm text-muted">When this family pays from the app, their Venmo note carries their code, so you can tell whose payment it is.</p>
              <ul className="flex flex-wrap gap-2">
                {codes.map((c) => (
                  <li key={c.userId} className="rounded-lg bg-surface-2 px-3 py-1.5 text-sm">
                    {c.name}: <span className="font-mono font-semibold">{c.code}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="space-y-3">
          <ActionPanel title={isStaff ? "Record money they paid in" : "Record a payment"} hint="Venmo, cash or a check that reached the team." icon={<HandCoins size={18} />} defaultOpen={statement.owed > 0}>
            <LedgerForm intent="payment" formKey={formKey} submitLabel="Record payment">
              <MoneyField name="cents" label="Amount" defaultCents={statement.owed || null} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <MethodField />
                <DateField today={today} />
              </div>
              {siblings.length > 0 && (
                <div>
                  <p className={labelClass}>Also for</p>
                  <MemberChecklist name="sibling" options={siblings.map((s) => ({ key: s.key, label: s.label, detail: s.owed > 0 ? <Amount cents={s.owed} /> : "Settled" }))} defaultChecked={(o) => (siblings.find((s) => s.key === o.key)?.owed ?? 0) > 0} />
                  <p className={hintClass}>Brothers and sisters listed under the same email. It pays each one's balance in turn.</p>
                </div>
              )}
              <TextField name="payerName" label="Paid by someone else" placeholder="Grandma, a sponsor…" />
              <div>
                <p className={labelClass}>If it's more than they owe</p>
                <Choice
                  name="extra"
                  defaultValue="credit"
                  options={[
                    { value: "credit", label: "Keep it as credit", hint: "Pays toward the next charge, or you pay it back." },
                    ...funds.map((f) => ({ value: `fund:${f.id}`, label: `They're donating it to ${f.name}` })),
                  ]}
                />
              </div>
              <TextField name="memo" label="Note" />
            </LedgerForm>
          </ActionPanel>

          {statement.dueBack > 0 && (
            <>
              <ActionPanel title={isStaff ? "Pay them back" : "Pay back their credit"} hint={`${formatCents(statement.dueBack)} owed to them. The team holds ${formatCents(cash)}.`} icon={<ArrowBendUpLeft size={18} />} defaultOpen>
                <LedgerForm intent="payBack" formKey={formKey} submitLabel="Record it">
                  <MoneyField name="cents" label="Amount" defaultCents={Math.min(statement.dueBack, Math.max(cash, 0)) || statement.dueBack} />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <MethodField />
                    <DateField today={today} />
                  </div>
                  <TextField name="memo" label="Note" />
                </LedgerForm>
              </ActionPanel>
              <ActionPanel title="They're donating it" hint="Their credit goes into a fund instead." icon={<PiggyBank size={18} />}>
                <LedgerForm intent="donateCredit" formKey={formKey} submitLabel="Move it to the fund">
                  <div>
                    <label htmlFor="fundId" className={labelClass}>To</label>
                    <select id="fundId" name="fundId" className={inputClass}>
                      {funds.map((f) => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                  </div>
                  <MoneyField name="cents" label="Amount" defaultCents={statement.dueBack} />
                  <TextField name="memo" label="Note" />
                </LedgerForm>
              </ActionPanel>
            </>
          )}

          {onTeam && items.length > 0 && (
            <ActionPanel title="Add a charge" hint="Charge just them for something." icon={<Plus size={18} />}>
              <LedgerForm intent="charge" formKey={formKey} submitLabel="Charge them">
                <div>
                  <label htmlFor="itemId" className={labelClass}>For</label>
                  <select id="itemId" name="itemId" className={inputClass}>
                    {items.map((i) => (
                      <option key={i.id} value={i.id}>{i.name}</option>
                    ))}
                  </select>
                </div>
                <MoneyField name="cents" label="Amount" />
                <TextField name="memo" label="Note" />
              </LedgerForm>
            </ActionPanel>
          )}
        </aside>
      </div>
    </Page>
  );
}
