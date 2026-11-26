import type { Route } from "./+types/team.money.items-new";
import { data, redirect, useFetcher } from "react-router";
import { and, eq } from "drizzle-orm";
import { db, ledgerItems, ledgerTxns } from "~/db";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import { getMembers, loadBook, memberKey, postTxn } from "~/utils/ledger.server";
import { FormError, newFormKey, readCents, readClientKey, readMembers, readText } from "~/utils/ledger-forms.server";
import { CATEGORY_LABELS, ITEM_CATEGORIES, LedgerError, chargeLines, type ItemCategory } from "~/utils/ledger";
import { allocate } from "~/utils/money";
import { Choice, MemberChecklist, MoneyField } from "~/components/money";
import { Alert, Button, Card, Page, PageHeader, cx, hintClass, inputClass, labelClass } from "~/components/ui";

export function meta() {
  return [{ title: "New charge - BenchTalk" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const { team } = await requireTeamAccess(Number(params.teamId), user.id);
  const book = await loadBook(team.id);
  const members = (await getMembers(team.id, book)).filter((m) => m.onTeam);
  return data({
    teamId: team.id,
    formKey: newFormKey(),
    members: members.map((m) => ({ key: memberKey(m.member), type: m.member.type, label: m.name, detail: m.detail ?? undefined })),
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await getUser(request);
  const { team } = await requireTeamAccess(Number(params.teamId), user.id);
  const formData = await request.formData();
  try {
    const name = readText(formData, "name", 120);
    if (!name) throw new FormError("Give it a name, like “Spring ref fees”");
    const categoryRaw = String(formData.get("category") ?? "other");
    const category: ItemCategory = (ITEM_CATEGORIES as readonly string[]).includes(categoryRaw) ? (categoryRaw as ItemCategory) : "other";
    const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(formData.get("dueDate"))) ? String(formData.get("dueDate")) : null;
    const members = readMembers(formData);
    if (members.length === 0) throw new FormError("Pick who pays it");
    const cents = readCents(formData, "cents");
    const split = formData.get("mode") === "split";
    const amounts = split ? allocate(cents, members.map(() => 1)) : members.map(() => cents);
    if (amounts.some((a) => a === 0)) throw new FormError("That total is too small to split between that many people");

    const [item] = await db
      .insert(ledgerItems)
      .values({
        teamId: team.id,
        name,
        category,
        details: readText(formData, "details", 1000),
        refundable: formData.get("refundable") === "1",
        dueDate,
        createdBy: user.id,
      })
      .returning({ id: ledgerItems.id });

    let posted: Awaited<ReturnType<typeof postTxn>>;
    try {
      posted = await postTxn({
        teamId: team.id,
        kind: "charge",
        itemId: item.id,
        lines: chargeLines(item.id, members.map((m, i) => ({ member: m, cents: amounts[i] }))),
        createdBy: user.id,
        clientKey: readClientKey(formData),
      });
    } catch (e) {
      // Nothing points at the new item yet, so take it back out
      await db.delete(ledgerItems).where(and(eq(ledgerItems.id, item.id), eq(ledgerItems.teamId, team.id)));
      throw e;
    }
    if (posted.duplicate) {
      // A double submit: the first one already made the item and its charges
      await db.delete(ledgerItems).where(and(eq(ledgerItems.id, item.id), eq(ledgerItems.teamId, team.id)));
      const [first] = await db.select({ itemId: ledgerTxns.itemId }).from(ledgerTxns).where(eq(ledgerTxns.id, posted.txnId)).limit(1);
      return redirect(`/dashboard/team/${team.id}/money${first?.itemId ? `/items/${first.itemId}` : ""}`);
    }
    return redirect(`/dashboard/team/${team.id}/money/items/${item.id}`);
  } catch (e) {
    if (e instanceof LedgerError || e instanceof FormError) return data({ error: e.message }, { status: 400 });
    throw e;
  }
}

export default function NewCharge({ loaderData }: Route.ComponentProps) {
  const { teamId, formKey, members } = loaderData;
  const fetcher = useFetcher<{ error?: string }>();
  const busy = fetcher.state !== "idle";

  return (
    <Page width="narrow">
      <PageHeader back={{ to: `/dashboard/team/${teamId}/money`, label: "Money" }} title="New charge" description="What it's for, who pays it and how much." />

      <fetcher.Form method="post" className="space-y-6">
        <input type="hidden" name="clientKey" value={`${formKey}:charge`} />
        {fetcher.data?.error && <Alert>{fetcher.data.error}</Alert>}

        <Card className="space-y-4 p-5">
          <div>
            <label htmlFor="name" className={labelClass}>What it's for</label>
            <input id="name" name="name" required maxLength={120} className={inputClass} placeholder="Surf Cup hotel" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="category" className={labelClass}>Kind</label>
              <select id="category" name="category" defaultValue="tournament" className={inputClass}>
                {ITEM_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="dueDate" className={labelClass}>
                Due <span className="font-normal text-muted">(optional)</span>
              </label>
              <input id="dueDate" name="dueDate" type="date" className={inputClass} />
            </div>
          </div>
          <div>
            <label htmlFor="details" className={labelClass}>
              Details for families <span className="font-normal text-muted">(optional)</span>
            </label>
            <textarea id="details" name="details" rows={2} maxLength={1000} className={cx(inputClass, "h-auto min-h-16 py-2.5")} placeholder="Two nights at the Hilton, split by player" />
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 ring-line transition hover:bg-surface-2 has-[:checked]:bg-primary-soft has-[:checked]:ring-primary">
            <input type="checkbox" name="refundable" value="1" className="mt-0.5" />
            <span>
              <span className="block text-sm font-semibold">Refundable</span>
              <span className="block text-sm text-muted">Money can come back to families from it, like a hotel deposit or a cancelled tournament.</span>
            </span>
          </label>
        </Card>

        <Card className="space-y-4 p-5">
          <p className="font-semibold">Who pays</p>
          <MemberChecklist options={members} defaultChecked={(o) => o.key.startsWith("player:")} />
          <p className={hintClass}>Players stand for their families. Tick staff to charge them their own share.</p>
        </Card>

        <Card className="space-y-4 p-5">
          <Choice
            name="mode"
            defaultValue="each"
            options={[
              { value: "each", label: "Each person pays this amount" },
              { value: "split", label: "Split this total evenly", hint: "Shares always add up to the total: any odd cents go to the first few people." },
            ]}
          />
          <MoneyField name="cents" label="Amount" />
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Charge it"}</Button>
        </div>
      </fetcher.Form>
    </Page>
  );
}
