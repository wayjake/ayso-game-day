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
  readShares,
  readText,
  runLedgerAction,
} from "~/utils/ledger-forms.server";
import {
  CATEGORY_LABELS,
  FULL_SHARE,
  ITEM_CATEGORIES,
  LedgerError,
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
import { ActionPanel, Amount, Choice, DateField, LedgerForm, MemberChecklist, MethodField, MoneyField, ShareEditor, TextField, UndoButton } from "~/components/money";
import { expenseTargets, saveShares } from "~/utils/billing.server";
import { Badge, Card, Page, PageHeader, cx, hintClass, inputClass, labelClass } from "~/components/ui";
import { ArrowBendUpLeft, ArrowRight, HandCoins, PencilSimple, PiggyBank, UsersThree } from "@phosphor-icons/react";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.item.name ?? "Expense"} - Finances - BenchTalk` }];
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

  const { shares, targets } = await expenseTargets(team.id, item);
  const shareOf = new Map(shares.map((s) => [memberKey(s.member), s]));
  const targetOf = new Map(targets.map((t) => [memberKey(t.member), t.cents]));

  // Everyone who shares it, plus anyone with money on it from before
  const rows = members
    .map((m) => ({ m, s: m.statement.items.find((i) => i.itemId === item.id), key: memberKey(m.member) }))
    .filter((r) => shareOf.has(r.key) || (r.s && (r.s.charged || r.s.covered || r.s.credited)))
    .map(({ m, s, key }) => ({
      key,
      type: m.member.type,
      id: m.member.id,
      name: m.name,
      detail: m.detail,
      charged: s?.charged ?? 0,
      covered: s?.covered ?? 0,
      credited: s?.credited ?? 0,
      paid: s?.paid ?? 0,
      remaining: s?.remaining ?? 0,
      reducible: maxReducible(s),
      half: shareOf.get(key)?.weight === 1,
      target: targetOf.get(key) ?? 0,
      // Their share less what's been invoiced: goes on the next invoice
      notInvoiced: (targetOf.get(key) ?? 0) - (s?.charged ?? 0),
    }));
  const onTeam = members.filter((m) => m.onTeam);

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
    shareOptions: onTeam.map((m) => {
      const key = memberKey(m.member);
      const share = shareOf.get(key);
      return { key, label: m.name, detail: m.detail ?? undefined, checked: Boolean(share), weight: share?.weight ?? FULL_SHARE, fixedCents: share?.fixedCents ?? null };
    }),
    shareTotal: targets.reduce((a, t) => a + t.cents, 0),
    notInvoiced: rows.reduce((a, r) => a + r.notInvoiced, 0),
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
          throw new FormError(`${name} can only have ${formatCents(cap)} more ${verb}: that's what's left of their invoiced share.`);
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
        // The total and rounding set the share price, which is fixed once it's been invoiced
        const pricing =
          item.shareMode === "split" && item.unitCents === null
            ? { totalCents: readCents(formData, "total", "the total"), rounding: formData.get("rounding") === "dollar" ? ("dollar" as const) : ("cent" as const) }
            : {};
        await db
          .update(ledgerItems)
          .set({
            name,
            category,
            details: readText(formData, "details", 1000),
            dueDate: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
            refundable: formData.get("refundable") === "1",
            ...pricing,
            updatedAt: new Date().toISOString(),
          })
          .where(and(eq(ledgerItems.id, item.id), eq(ledgerItems.teamId, team.id)));
        return;
      }
      case "shares": {
        if (!item.shareMode) throw new LedgerError("This expense was made before shares, so it can't be edited this way");
        await saveShares(team.id, item.id, readShares(formData, item.shareMode));
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
        if (!item.refundable) throw new LedgerError("This expense isn't refundable. To pay for someone, cover it from a fund instead.");
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
  const { teamId, item, summary, formKey, today, cash, rows, funds, staff, shareOptions, shareTotal, notInvoiced, activity } = loaderData;
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
            {item.shareMode === "split" && item.totalCents !== null && <Badge>{formatCents(item.totalCents)} split{item.rounding === "dollar" ? ", rounded up" : ""}</Badge>}
            {item.shareMode === "fixed" && <Badge>Each person's own amount</Badge>}
            {item.dueDate && <span className="text-sm">Due {item.dueDate}</span>}
          </span>
        }
      />
      {item.details && <p className="-mt-3 mb-6 max-w-prose text-muted">{item.details}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Fig
          label="Shares"
          cents={item.shareMode ? shareTotal : summary.charged}
          sub={`${rows.filter((r) => r.target || r.charged).length} ${rows.length === 1 ? "person" : "people"}${notInvoiced ? ` · ${formatCents(notInvoiced)} not invoiced yet` : ""}`}
        />
        <Fig label="Collected" cents={summary.collected} sub="Paid, or covered by a fund" />
        <Fig label="Still owed" cents={summary.stillOwed} sub="On invoices, not paid yet" />
        <Fig
          label="Paid out"
          cents={summary.passedOn}
          sub={`To the hotel, league or tournament${summary.returned ? ` · ${formatCents(summary.returned)} refunded` : ""}`}
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
                    <th scope="col" className="px-3 py-3 text-right font-semibold">Share</th>
                    <th scope="col" className="px-3 py-3 text-right font-semibold">Invoiced</th>
                    <th scope="col" className="px-3 py-3 text-right font-semibold">Covered</th>
                    {item.refundable && <th scope="col" className="px-3 py-3 text-right font-semibold">Refunded</th>}
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
                        {r.half && <Badge className="ml-1.5">Half</Badge>}
                      </td>
                      <td className="px-3 py-2.5 text-right">{item.shareMode ? <Amount cents={r.target} /> : "–"}</td>
                      <td className="px-3 py-2.5 text-right">
                        <Amount cents={r.charged} />
                        {r.notInvoiced !== 0 && <span className="block text-xs text-warning">{r.notInvoiced > 0 ? "+" : "−"}{formatCents(Math.abs(r.notInvoiced))} next</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right text-muted">{r.covered ? <Amount cents={r.covered} /> : "–"}</td>
                      {item.refundable && <td className="px-3 py-2.5 text-right text-muted">{r.credited ? <Amount cents={r.credited} /> : "–"}</td>}
                      <td className="px-3 py-2.5 text-right">{r.paid ? <Amount cents={r.paid} /> : "–"}</td>
                      <td className={cx("px-4 py-2.5 text-right font-semibold", r.remaining ? "text-danger" : r.charged ? "text-success" : "text-muted")}>
                        {r.remaining ? <Amount cents={r.remaining} /> : r.charged ? "Paid" : "–"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <section>
            <h2 className="mb-3 font-semibold">History</h2>
            {activity.length === 0 ? (
              <p className="text-sm text-muted">Nothing yet. Shares are billed when you send invoices.</p>
            ) : (
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
                    {!a.reversed && !["reversal", "charge", "adjust", "settle"].includes(a.kind) && <UndoButton txnId={a.id} formKey={formKey} />}
                  </li>
                ))}
              </ul>
            </Card>
            )}
          </section>
        </div>

        <aside className="space-y-3">
          {item.shareMode && (
            <ActionPanel title="Who shares it" hint="Changes go on each family's next invoice." icon={<UsersThree size={18} />}>
              <LedgerForm intent="shares" formKey={formKey} submitLabel="Save">
                <ShareEditor
                  mode={item.shareMode}
                  options={shareOptions}
                  totalCents={item.totalCents}
                  rounding={item.rounding}
                  unitCents={item.unitCents}
                />
                {item.unitCents !== null && (
                  <p className={hintClass}>
                    A full share is fixed at {formatCents(item.unitCents)} since the first invoice, so anyone added pays the same. Settle up at the end to even it out.
                  </p>
                )}
              </LedgerForm>
            </ActionPanel>
          )}

          <ActionPanel title="Pay out" hint={`To the hotel, league or tournament. The team holds ${formatCents(cash)}.`} icon={<ArrowRight size={18} />}>
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
              <TextField name="memo" label="Note for staff" placeholder="Check to Quartz Hill AYSO" />
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
                  { value: "split", label: "Split this total", hint: "In proportion to each share." },
                ]}
              />
              <MoneyField name="cents" label="Amount" required={false} hint="Not needed for “whatever each still owes”." />
              <TextField name="memo" label="Note the family sees" placeholder="Thanks to Acme Plumbing" />
              <p className={hintClass}>Only invoiced shares can be covered. It shows on the family's next invoice; covering someone who already paid gives them that much credit.</p>
            </LedgerForm>
          </ActionPanel>

          {item.refundable && (
            <>
              <ActionPanel title="Refund received" hint="The hotel or tournament sent money back to the team." icon={<ArrowBendUpLeft size={18} />}>
                <LedgerForm intent="vendorRefund" formKey={formKey} submitLabel="Record it">
                  <MoneyField name="cents" label="Amount" />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <MethodField />
                    <DateField today={today} />
                  </div>
                  <TextField name="memo" label="Note for staff" />
                  <p className={hintClass}>Then refund families below.</p>
                </LedgerForm>
              </ActionPanel>
              <ActionPanel title="Refund families" hint="Goes on their next invoice as money back." icon={<HandCoins size={18} />}>
                <LedgerForm intent="credit" formKey={formKey} submitLabel="Refund them">
                  <MemberChecklist options={reducible.map((r) => ({ key: r.key, label: r.name, detail: <Amount cents={r.charged} /> }))} defaultChecked={() => true} />
                  <Choice
                    name="mode"
                    defaultValue="split"
                    options={[
                      { value: "split", label: "Split this total", hint: "In proportion to each share." },
                      { value: "each", label: "This amount each" },
                    ]}
                  />
                  <MoneyField name="cents" label="Amount" />
                  <TextField name="memo" label="Note the family sees" placeholder="Referee deposit returned" />
                </LedgerForm>
              </ActionPanel>
            </>
          )}

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
              {item.shareMode === "split" && item.unitCents === null && (
                <>
                  <MoneyField name="total" label="Total" defaultCents={item.totalCents} />
                  <label className="flex cursor-pointer items-center gap-3">
                    <input type="checkbox" name="rounding" value="dollar" defaultChecked={item.rounding === "dollar"} />
                    <span className="text-sm font-medium">Round shares up to the dollar</span>
                  </label>
                </>
              )}
              {item.shareMode === "split" && item.unitCents !== null && (
                <p className={hintClass}>The total can't change once it's been invoiced. If the real cost turns out different, settling up at the end evens it out.</p>
              )}
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
