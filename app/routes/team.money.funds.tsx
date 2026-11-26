import type { Route } from "./+types/team.money.funds";
import { data } from "react-router";
import { and, eq } from "drizzle-orm";
import { db, ledgerFunds } from "~/db";
import { getUser } from "~/utils/auth.server";
import { getTeamStaff, requireTeamAccess } from "~/utils/team-access.server";
import { activityNames, describeBook, ensureDefaultFund, fundBalances, getItems, getMembers, loadBook, postTxn, reverseTxn } from "~/utils/ledger.server";
import { FormError, newFormKey, parseMember, readCents, readClientKey, readDate, readId, readMethod, readText, runLedgerAction } from "~/utils/ledger-forms.server";
import { donationLines, expenseLines, transferLines } from "~/utils/ledger";
import { formatCents } from "~/utils/money";
import { todayISO } from "~/utils/dates";
import { ActionPanel, Amount, DateField, LedgerForm, MethodField, MoneyField, TextField, UndoButton } from "~/components/money";
import { Card, Page, PageHeader, cx, hintClass, inputClass, labelClass } from "~/components/ui";
import { ArrowsLeftRight, Eye, EyeSlash, HandHeart, Plus, ShoppingCart } from "@phosphor-icons/react";

export function meta() {
  return [{ title: "Funds - Finances - BenchTalk" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const { team } = await requireTeamAccess(Number(params.teamId), user.id);
  const funds = await ensureDefaultFund(team.id);
  const [book, items] = await Promise.all([loadBook(team.id), getItems(team.id)]);
  const members = await getMembers(team.id, book);
  const held = fundBalances(book);
  const names = await activityNames(team.id, book, members, items);
  const staff = await getTeamStaff(team.id);
  const touchesFund = (t: (typeof book)[number]) => t.lines.some((l) => l.account.type === "fund");
  return data({
    teamId: team.id,
    formKey: newFormKey(),
    today: todayISO(),
    cash: held.cash,
    funds: funds.map((f) => ({ id: f.id, name: f.name, visible: f.visibleToFamilies, balance: held.fund(f.id) })),
    staff: staff.map((s) => ({ userId: s.userId, name: s.name || s.email.split("@")[0] })),
    activity: describeBook(book.filter(touchesFund), names).reverse(),
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await getUser(request);
  const { team } = await requireTeamAccess(Number(params.teamId), user.id);
  const formData = await request.formData();
  const intent = formData.get("_action");
  const clientKey = readClientKey(formData);

  return runLedgerAction(async () => {
    switch (intent) {
      case "newFund": {
        const name = readText(formData, "name", 60);
        if (!name) throw new FormError("Give the fund a name");
        await db.insert(ledgerFunds).values({ teamId: team.id, name, visibleToFamilies: formData.get("visible") === "1" });
        return;
      }
      case "editFund": {
        const fundId = readId(formData, "fundId");
        const name = readText(formData, "name", 60);
        if (!name) throw new FormError("Give the fund a name");
        await db
          .update(ledgerFunds)
          .set({ name, visibleToFamilies: formData.get("visible") === "1" })
          .where(and(eq(ledgerFunds.id, fundId), eq(ledgerFunds.teamId, team.id)));
        return;
      }
      case "donation": {
        const fundId = readId(formData, "fundId");
        await postTxn({
          teamId: team.id,
          kind: "donation",
          fundId,
          lines: donationLines(fundId, readCents(formData, "cents"), { type: "cash" }),
          payerName: readText(formData, "payerName", 100),
          method: readMethod(formData),
          occurredOn: readDate(formData),
          memo: readText(formData, "memo"),
          createdBy: user.id,
          clientKey,
        });
        return;
      }
      case "transfer": {
        const from = readId(formData, "fromFundId");
        const to = readId(formData, "toFundId");
        await postTxn({ teamId: team.id, kind: "transfer", fundId: to, lines: transferLines(from, to, readCents(formData, "cents")), memo: readText(formData, "memo"), createdBy: user.id, clientKey });
        return;
      }
      case "spend": {
        const fundId = readId(formData, "fundId");
        const staffMember = parseMember(String(formData.get("paidBy") ?? "cash"));
        const paidBy = staffMember?.type === "staff" ? ({ type: "staff", userId: staffMember.id } as const) : ({ type: "cash" } as const);
        await postTxn({
          teamId: team.id,
          kind: "expense",
          fundId,
          lines: expenseLines({ type: "fund", fundId }, readCents(formData, "cents"), paidBy),
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

export default function Funds({ loaderData }: Route.ComponentProps) {
  const { teamId, formKey, today, cash, funds, staff, activity } = loaderData;
  const fundOptions = funds.map((f) => (
    <option key={f.id} value={f.id}>
      {f.name} ({formatCents(f.balance)})
    </option>
  ));

  return (
    <Page>
      <PageHeader
        back={{ to: `/dashboard/team/${teamId}/finances`, label: "Finances" }}
        title="Funds"
        description="Money the team keeps for anyone: sponsor gifts, donations, savings. Use it to cover people's shares or pay for things."
      />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-8">
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {funds.map((f) => (
              <li key={f.id}>
                <FundCard fund={f} formKey={formKey} />
              </li>
            ))}
          </ul>

          <section>
            <h2 className="mb-3 font-semibold">History</h2>
            {activity.length === 0 ? (
              <p className="text-sm text-muted">Nothing yet.</p>
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
                      {!a.reversed && a.kind !== "reversal" && <UndoButton txnId={a.id} formKey={formKey} />}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </section>
        </div>

        <aside className="space-y-3">
          <ActionPanel title="Money in" hint="A sponsor, a coach or a family giving to the team." icon={<HandHeart size={18} />} defaultOpen>
            <LedgerForm intent="donation" formKey={formKey} submitLabel="Add it">
              <div>
                <label htmlFor="donation-fund" className={labelClass}>To</label>
                <select id="donation-fund" name="fundId" className={inputClass}>{fundOptions}</select>
              </div>
              <MoneyField name="cents" label="Amount" />
              <TextField name="payerName" label="From" placeholder="Acme Plumbing" />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <MethodField />
                <DateField today={today} />
              </div>
              <TextField name="memo" label="Note for staff" />
            </LedgerForm>
          </ActionPanel>

          <ActionPanel title="Spend from a fund" hint={`Pizza, a ball bag, anything not charged to families. The team holds ${formatCents(cash)}.`} icon={<ShoppingCart size={18} />}>
            <LedgerForm intent="spend" formKey={formKey} submitLabel="Record it">
              <div>
                <label htmlFor="spend-fund" className={labelClass}>From</label>
                <select id="spend-fund" name="fundId" className={inputClass}>{fundOptions}</select>
              </div>
              <MoneyField name="cents" label="Amount" />
              <div>
                <label htmlFor="paidBy" className={labelClass}>Paid with</label>
                <select id="paidBy" name="paidBy" defaultValue="cash" className={inputClass}>
                  <option value="cash">Team money</option>
                  {staff.map((s) => (
                    <option key={s.userId} value={`staff:${s.userId}`}>{s.name}'s own money (the team owes them)</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <MethodField />
                <DateField today={today} />
              </div>
              <TextField name="memo" label="What for" optional={false} placeholder="End of season party" />
            </LedgerForm>
          </ActionPanel>

          {funds.length > 1 && (
            <ActionPanel title="Move between funds" icon={<ArrowsLeftRight size={18} />}>
              <LedgerForm intent="transfer" formKey={formKey} submitLabel="Move it">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="fromFundId" className={labelClass}>From</label>
                    <select id="fromFundId" name="fromFundId" className={inputClass}>{fundOptions}</select>
                  </div>
                  <div>
                    <label htmlFor="toFundId" className={labelClass}>To</label>
                    <select id="toFundId" name="toFundId" defaultValue={funds[1]?.id} className={inputClass}>{fundOptions}</select>
                  </div>
                </div>
                <MoneyField name="cents" label="Amount" />
                <TextField name="memo" label="Note for staff" />
              </LedgerForm>
            </ActionPanel>
          )}

          <ActionPanel title="New fund" hint="Savings, a trip, a party." icon={<Plus size={18} />}>
            <LedgerForm intent="newFund" formKey={formKey} submitLabel="Add fund">
              <TextField name="name" label="Name" optional={false} placeholder="Savings" />
              <label className="flex cursor-pointer items-center gap-3">
                <input type="checkbox" name="visible" value="1" defaultChecked />
                <span className="text-sm font-medium">Families can see its balance</span>
              </label>
            </LedgerForm>
          </ActionPanel>
        </aside>
      </div>
    </Page>
  );
}

function FundCard({ fund, formKey }: { fund: { id: number; name: string; visible: boolean; balance: number }; formKey: string }) {
  return (
    <Card className="p-4">
      <p className="flex items-center justify-between gap-2">
        <span className="font-semibold">{fund.name}</span>
        <span className="flex items-center gap-1 text-xs text-muted">
          {fund.visible ? <Eye size={14} /> : <EyeSlash size={14} />}
          {fund.visible ? "Families see it" : "Hidden from families"}
        </span>
      </p>
      <p className="mt-1 font-display text-2xl font-bold"><Amount cents={fund.balance} /></p>
      <details className="mt-2">
        <summary className="tap cursor-pointer text-sm font-semibold text-primary">Edit</summary>
        <LedgerForm intent="editFund" formKey={formKey} submitLabel="Save" className="mt-3">
          <input type="hidden" name="fundId" value={fund.id} />
          <TextField name="name" label="Name" optional={false} defaultValue={fund.name} />
          <label className="flex cursor-pointer items-center gap-3">
            <input type="checkbox" name="visible" value="1" defaultChecked={fund.visible} />
            <span className="text-sm font-medium">Families can see its balance</span>
          </label>
          <p className={hintClass}>When a hidden fund covers someone's share, their family sees it as covered by the team.</p>
        </LedgerForm>
      </details>
    </Card>
  );
}
