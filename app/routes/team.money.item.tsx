import type { Route } from "./+types/team.money.item";
import { Link, data } from "react-router";
import { and, eq } from "drizzle-orm";
import { db, ledgerItems } from "~/db";
import { getUser } from "~/utils/auth.server";
import { getTeamStaff, requireTeamAccess } from "~/utils/team-access.server";
import {
  activityNames,
  describeBook,
  ensureDefaultFund,
  fundBalances,
  getItem,
  getItems,
  getMembers,
  loadBook,
  memberKey,
  postTxn,
  reverseTxn,
  summarizeItems,
} from "~/utils/ledger.server";
import {
  FormError,
  newFormKey,
  parseMember,
  readCents,
  readClientKey,
  readDate,
  readId,
  readMembers,
  readMethod,
  readText,
  runLedgerAction,
} from "~/utils/ledger-forms.server";
import {
  CATEGORY_LABELS,
  ITEM_CATEGORIES,
  LedgerError,
  chargeLines,
  coverLines,
  creditLines,
  expenseLines,
  maxReducible,
  vendorRefundLines,
  type ItemCategory,
  type Member,
  type Share,
} from "~/utils/ledger";
import { allocate, formatCents, type Cents } from "~/utils/money";
import { todayISO } from "~/utils/dates";
import { ActionPanel, Amount, Choice, DateField, LedgerForm, MemberChecklist, MethodField, MoneyField, TextField, UndoButton } from "~/components/money";
import { Badge, Card, Page, PageHeader, cx, hintClass, inputClass, labelClass } from "~/components/ui";
import { ArrowBendUpLeft, ArrowRight, HandCoins, PencilSimple, PiggyBank, Plus } from "@phosphor-icons/react";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.item.name ?? "Charge"} - Finances - BenchTalk` }];
}

async function load(teamId: number, itemId: number) {
  const item = await getItem(teamId, itemId);
  if (!item) throw new Response("Not found", { status: 404 });
  const [book, items] = await Promise.all([loadBook(teamId), getItems(teamId)]);
  const members = await getMembers(teamId, book);
  return { item, book, items, members };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const { team } = await requireTeamAccess(Number(params.teamId), user.id);
  const { item, book, items, members } = await load(team.id, Number(params.itemId));
  const funds = await ensureDefaultFund(team.id);
  const held = fundBalances(book);
  const staff = await getTeamStaff(team.id);
  const names = await activityNames(team.id, book, members, items);
  const [summary] = summarizeItems(book, [item], members);

  const rows = members
    .map((m) => ({ m, s: m.statement.items.find((i) => i.itemId === item.id) }))
    .filter((r) => r.s && (r.s.charged || r.s.covered || r.s.credited))
    .map(({ m, s }) => ({
      key: memberKey(m.member),
      type: m.member.type,
      id: m.member.id,
      name: m.name,
      detail: m.detail,
      ...s!,
      reducible: maxReducible(s),
    }));

  return data({
    teamId: team.id,
    item,
    summary,
    formKey: newFormKey(),
    today: todayISO(),
    cash: held.cash,
    rows,
    funds: funds.map((f) => ({ id: f.id, name: f.name, balance: held.fund(f.id) })),
    staff: staff.map((s) => ({ userId: s.userId, name: s.name || s.email.split("@")[0] })),
    everyone: members.filter((m) => m.onTeam).map((m) => ({ key: memberKey(m.member), label: m.name, detail: m.detail ?? undefined })),
    activity: describeBook(book.filter((t) => t.itemId === item.id), names).reverse(),
  });
}

// Amounts per member from a form: "rest" (what's left on the item), "each" (one
// amount each) or "split" (a total split by what each was charged)
function sharesFromForm(formData: FormData, members: Member[], perMember: Map<string, { remaining: Cents; charged: Cents; reducible: Cents }>): Share[] {
  const mode = String(formData.get("mode") ?? "each");
  if (members.length === 0) throw new FormError("Pick at least one person");
  const info = (m: Member) => perMember.get(memberKey(m)) ?? { remaining: 0, charged: 0, reducible: 0 };
  let shares: Share[];
  if (mode === "rest") {
    shares = members.map((m) => ({ member: m, cents: info(m).remaining }));
  } else if (mode === "split") {
    const total = readCents(formData, "cents");
    const weights = members.map((m) => info(m).charged);
    if (weights.every((w) => w === 0)) throw new FormError("None of them were charged for this");
    const split = allocate(total, weights);
    shares = members.map((m, i) => ({ member: m, cents: split[i] }));
  } else {
    const cents = readCents(formData, "cents");
    shares = members.map((m) => ({ member: m, cents }));
  }
  shares = shares.filter((s) => s.cents > 0);
  if (shares.length === 0) throw new FormError("There's nothing left to cover for them");
  return shares;
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await getUser(request);
  const { team } = await requireTeamAccess(Number(params.teamId), user.id);
  const itemId = Number(params.itemId);
  const formData = await request.formData();
  const intent = formData.get("_action");
  const clientKey = readClientKey(formData);

  return runLedgerAction(async () => {
    const { item, members } = await load(team.id, itemId);
    const perMember = new Map(
      members.map((m) => {
        const s = m.statement.items.find((i) => i.itemId === item.id);
        return [memberKey(m.member), { remaining: s?.remaining ?? 0, charged: s?.charged ?? 0, reducible: maxReducible(s) }];
      })
    );
    const capCheck = (shares: Share[], verb: string) => {
      for (const s of shares) {
        const cap = perMember.get(memberKey(s.member))?.reducible ?? 0;
        if (s.cents > cap) {
          const name = members.find((m) => memberKey(m.member) === memberKey(s.member))?.name ?? "Someone";
          throw new FormError(`${name} can only have ${formatCents(cap)} more ${verb}: that's what's left of their charge.`);
        }
      }
    };

    switch (intent) {
      case "edit": {
        const name = readText(formData, "name", 120);
        if (!name) throw new FormError("Give it a name");
        const categoryRaw = String(formData.get("category") ?? item.category);
        const category: ItemCategory = (ITEM_CATEGORIES as readonly string[]).includes(categoryRaw) ? (categoryRaw as ItemCategory) : item.category;
        const due = String(formData.get("dueDate") ?? "");
        await db
          .update(ledgerItems)
          .set({
            name,
            category,
            details: readText(formData, "details", 1000),
            dueDate: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
            refundable: formData.get("refundable") === "1",
            updatedAt: new Date().toISOString(),
          })
          .where(and(eq(ledgerItems.id, item.id), eq(ledgerItems.teamId, team.id)));
        return;
      }
      case "charge": {
        const picked = readMembers(formData);
        if (picked.length === 0) throw new FormError("Pick who pays it");
        const cents = readCents(formData, "cents");
        const amounts = formData.get("mode") === "split" ? allocate(cents, picked.map(() => 1)) : picked.map(() => cents);
        if (amounts.some((a) => a === 0)) throw new FormError("That total is too small to split between that many people");
        await postTxn({ teamId: team.id, kind: "charge", itemId: item.id, lines: chargeLines(item.id, picked.map((m, i) => ({ member: m, cents: amounts[i] }))), createdBy: user.id, clientKey, memo: readText(formData, "memo") });
        return;
      }
      case "cover": {
        const fundId = readId(formData, "fundId");
        const shares = sharesFromForm(formData, readMembers(formData), perMember);
        capCheck(shares, "covered");
        await postTxn({ teamId: team.id, kind: "cover", itemId: item.id, fundId, lines: coverLines(fundId, shares), createdBy: user.id, clientKey, memo: readText(formData, "memo") });
        return;
      }
      case "credit": {
        if (!item.refundable) throw new LedgerError("This charge isn't refundable. To pay for someone, cover it from a fund instead.");
        const shares = sharesFromForm(formData, readMembers(formData), perMember);
        capCheck(shares, "back");
        await postTxn({ teamId: team.id, kind: "credit", itemId: item.id, lines: creditLines(item.id, shares), createdBy: user.id, clientKey, memo: readText(formData, "memo") });
        return;
      }
      case "expense": {
        const paidByRaw = String(formData.get("paidBy") ?? "cash");
        const staffMember = parseMember(paidByRaw);
        const paidBy = staffMember?.type === "staff" ? ({ type: "staff", userId: staffMember.id } as const) : ({ type: "cash" } as const);
        await postTxn({
          teamId: team.id,
          kind: "expense",
          itemId: item.id,
          lines: expenseLines({ type: "item", itemId: item.id }, readCents(formData, "cents"), paidBy),
          method: readMethod(formData),
          occurredOn: readDate(formData),
          memo: readText(formData, "memo"),
          createdBy: user.id,
          clientKey,
        });
        return;
      }
      case "vendorRefund": {
        await postTxn({
          teamId: team.id,
          kind: "vendor_refund",
          itemId: item.id,
          lines: vendorRefundLines(item.id, readCents(formData, "cents")),
          method: readMethod(formData),
          occurredOn: readDate(formData),
          memo: readText(formData, "memo"),
          createdBy: user.id,
          clientKey,
        });
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

export default function ItemPage({ loaderData }: Route.ComponentProps) {
  const { teamId, item, summary, formKey, today, cash, rows, funds, staff, everyone, activity } = loaderData;
  const base = `/dashboard/team/${teamId}/finances`;
  const reducible = rows.filter((r) => r.reducible > 0);

  return (
    <Page>
      <PageHeader
        back={{ to: base, label: "Finances" }}
        title={item.name}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge>{CATEGORY_LABELS[item.category]}</Badge>
            {item.refundable && <Badge tone="primary">Refundable</Badge>}
            {item.dueDate && <span className="text-sm">Due {item.dueDate}</span>}
          </span>
        }
      />
      {item.details && <p className="-mt-3 mb-6 max-w-prose text-muted">{item.details}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Fig label="Charged" cents={summary.charged} sub={`${summary.people} ${summary.people === 1 ? "person" : "people"}`} />
        <Fig label="Collected" cents={summary.collected} sub="Paid or covered" />
        <Fig label="Still owed" cents={summary.stillOwed} />
        <Fig
          label="Not yet passed on"
          cents={summary.notPassedOn}
          sub={`${formatCents(summary.passedOn)} passed on${summary.returned ? `, ${formatCents(summary.returned)} came back` : ""}`}
        />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-8">
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th scope="col" className="px-4 py-3 font-semibold">Who</th>
                    <th scope="col" className="px-3 py-3 text-right font-semibold">Charged</th>
                    <th scope="col" className="px-3 py-3 text-right font-semibold">Covered</th>
                    {item.refundable && <th scope="col" className="px-3 py-3 text-right font-semibold">Back</th>}
                    <th scope="col" className="px-3 py-3 text-right font-semibold">Paid</th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">Left</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <td className="px-4 py-2.5">
                        <Link to={`${base}/${r.type}/${r.id}`} className="font-medium hover:text-primary">
                          {r.name}
                        </Link>
                        {r.detail && <span className="ml-1.5 text-muted">{r.detail}</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right"><Amount cents={r.charged} /></td>
                      <td className="px-3 py-2.5 text-right text-muted">{r.covered ? <Amount cents={r.covered} /> : "–"}</td>
                      {item.refundable && <td className="px-3 py-2.5 text-right text-muted">{r.credited ? <Amount cents={r.credited} /> : "–"}</td>}
                      <td className="px-3 py-2.5 text-right">{r.paid ? <Amount cents={r.paid} /> : "–"}</td>
                      <td className={cx("px-4 py-2.5 text-right font-semibold", r.remaining ? "text-danger" : "text-success")}>
                        {r.remaining ? <Amount cents={r.remaining} /> : "Done"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <section>
            <h2 className="mb-3 font-semibold">History</h2>
            <Card>
              <ul className="divide-y divide-line">
                {activity.map((a) => (
                  <li key={a.id} className={cx("flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 text-sm", a.reversed && "text-muted line-through decoration-1")}>
                    <span className="min-w-0 flex-1">
                      {a.text}
                      {a.memo && <span className="block text-muted">{a.memo}</span>}
                      <span className="block text-xs text-muted">#{a.id} · {a.occurredOn}{a.by && ` · ${a.by}`}</span>
                    </span>
                    <Amount cents={a.cents} className="font-semibold" />
                    {!a.reversed && a.kind !== "reversal" && <UndoButton txnId={a.id} formKey={formKey} />}
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        </div>

        <aside className="space-y-3">
          <ActionPanel title="Pass money on" hint={`Paid to whoever it's for. The team holds ${formatCents(cash)}.`} icon={<ArrowRight size={18} />}>
            <LedgerForm intent="expense" formKey={formKey} submitLabel="Record it">
              <MoneyField name="cents" label="Amount" defaultCents={summary.notPassedOn > 0 ? Math.min(summary.notPassedOn, Math.max(cash, 0)) || null : null} />
              <div>
                <label htmlFor="paidBy" className={labelClass}>Paid from</label>
                <select id="paidBy" name="paidBy" defaultValue="cash" className={inputClass}>
                  <option value="cash">Team money</option>
                  {staff.map((s) => (
                    <option key={s.userId} value={`staff:${s.userId}`}>{s.name}'s own money (the team owes them)</option>
                  ))}
                </select>
                <p className={hintClass}>If someone paid it themselves, the team owes them until you pay them back.</p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <MethodField />
                <DateField today={today} />
              </div>
              <TextField name="memo" label="Note for staff" placeholder="Deposit to the Hilton" />
            </LedgerForm>
          </ActionPanel>

          <ActionPanel title="Cover from a fund" hint="The team fund or a sponsor pays some people's share." icon={<PiggyBank size={18} />}>
            <LedgerForm intent="cover" formKey={formKey} submitLabel="Cover it">
              <div>
                <label htmlFor="fundId" className={labelClass}>From</label>
                <select id="fundId" name="fundId" className={inputClass}>
                  {funds.map((f) => (
                    <option key={f.id} value={f.id}>{f.name} ({formatCents(f.balance)})</option>
                  ))}
                </select>
              </div>
              <MemberChecklist options={reducible.map((r) => ({ key: r.key, label: r.name, detail: <Amount cents={r.remaining} /> }))} />
              <Choice
                name="mode"
                defaultValue="rest"
                options={[
                  { value: "rest", label: "Whatever each still owes on it" },
                  { value: "each", label: "This amount each" },
                  { value: "split", label: "Split this total", hint: "In proportion to what each was charged." },
                ]}
              />
              <MoneyField name="cents" label="Amount" required={false} hint="Not needed for “whatever each still owes”." />
              <TextField name="memo" label="Note the family sees" placeholder="Thanks to Acme Plumbing" />
              <p className={hintClass}>Covering someone who already paid gives them that much credit.</p>
            </LedgerForm>
          </ActionPanel>

          {item.refundable && (
            <>
              <ActionPanel title="Money came back" hint="The hotel or tournament refunded the team." icon={<ArrowBendUpLeft size={18} />}>
                <LedgerForm intent="vendorRefund" formKey={formKey} submitLabel="Record it">
                  <MoneyField name="cents" label="Amount" />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <MethodField />
                    <DateField today={today} />
                  </div>
                  <TextField name="memo" label="Note for staff" />
                  <p className={hintClass}>Then give it back to families below.</p>
                </LedgerForm>
              </ActionPanel>
              <ActionPanel title="Give money back" hint="Families are owed it until you pay them." icon={<HandCoins size={18} />}>
                <LedgerForm intent="credit" formKey={formKey} submitLabel="Give it back">
                  <MemberChecklist options={reducible.map((r) => ({ key: r.key, label: r.name, detail: <Amount cents={r.charged} /> }))} defaultChecked={() => true} />
                  <Choice
                    name="mode"
                    defaultValue="split"
                    options={[
                      { value: "split", label: "Split this total", hint: "In proportion to what each was charged." },
                      { value: "each", label: "This amount each" },
                    ]}
                  />
                  <MoneyField name="cents" label="Amount" />
                  <TextField name="memo" label="Note the family sees" placeholder="Hotel refunded one night" />
                </LedgerForm>
              </ActionPanel>
            </>
          )}

          <ActionPanel title="Charge more people" icon={<Plus size={18} />}>
            <LedgerForm intent="charge" formKey={formKey} submitLabel="Charge them">
              <MemberChecklist options={everyone.filter((o) => !rows.some((r) => r.key === o.key))} />
              <Choice
                name="mode"
                defaultValue="each"
                options={[
                  { value: "each", label: "Each person pays this amount" },
                  { value: "split", label: "Split this total evenly" },
                ]}
              />
              <MoneyField name="cents" label="Amount" />
            </LedgerForm>
          </ActionPanel>

          <ActionPanel title="Edit details" icon={<PencilSimple size={18} />}>
            <LedgerForm intent="edit" formKey={formKey} submitLabel="Save">
              <div>
                <label htmlFor="name" className={labelClass}>What it's for</label>
                <input id="name" name="name" required maxLength={120} defaultValue={item.name} className={inputClass} />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="category" className={labelClass}>Kind</label>
                  <select id="category" name="category" defaultValue={item.category} className={inputClass}>
                    {ITEM_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="dueDate" className={labelClass}>Due</label>
                  <input id="dueDate" name="dueDate" type="date" defaultValue={item.dueDate ?? ""} className={inputClass} />
                </div>
              </div>
              <div>
                <label htmlFor="details" className={labelClass}>Details for families</label>
                <textarea id="details" name="details" rows={2} maxLength={1000} defaultValue={item.details ?? ""} className={cx(inputClass, "h-auto min-h-16 py-2.5")} />
              </div>
              <label className="flex cursor-pointer items-center gap-3">
                <input type="checkbox" name="refundable" value="1" defaultChecked={item.refundable} />
                <span className="text-sm font-medium">Refundable</span>
              </label>
              <p className={hintClass}>To change an amount, undo the charge in History and charge it again.</p>
            </LedgerForm>
          </ActionPanel>
        </aside>
      </div>
    </Page>
  );
}

function Fig({ label, cents, sub }: { label: string; cents: number; sub?: string }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold"><Amount cents={cents} /></p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </Card>
  );
}
