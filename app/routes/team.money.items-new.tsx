import type { Route } from "./+types/team.money.items-new";
import { useState } from "react";
import { data, redirect, useFetcher } from "react-router";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { db, ledgerItems } from "~/db";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import { getMembers, loadBook, memberKey } from "~/utils/ledger.server";
import { saveExpenseGames, saveShares } from "~/utils/billing.server";
import { games } from "~/db";
import { formatGameDate, todayISO } from "~/utils/dates";
import { FormError, newFormKey, readCents, readShares, readText } from "~/utils/ledger-forms.server";
import { CATEGORY_LABELS, FULL_SHARE, ITEM_CATEGORIES, LedgerError, type ItemCategory } from "~/utils/ledger";
import { parseCents } from "~/utils/money";
import { ShareEditor } from "~/components/money";
import { Alert, Button, Card, Page, PageHeader, cx, inputClass, labelClass } from "~/components/ui";
import { teamIdFromCode } from "~/utils/team-access.server";
import { teamPath } from "~/utils/team-path";
import { parseIds } from "~/utils/ids";

export function meta() {
  return [{ title: "New expense - BenchTalk" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const { team } = await requireTeamAccess((await teamIdFromCode(params.teamCode)), user.id);
  const book = await loadBook(team.id);
  const members = (await getMembers(team.id, book)).filter((m) => m.onTeam);
  return data({
    teamId: team.id,
    teamCode: team.code,
    formKey: newFormKey(),
    members: members.map((m) => ({ key: memberKey(m.member), label: m.name, detail: m.detail ?? undefined })),
    upcomingGames: await db
      .select({ id: games.id, opponent: games.opponent, gameDate: games.gameDate })
      .from(games)
      .where(and(eq(games.teamId, team.id), gte(games.gameDate, todayISO())))
      .orderBy(asc(games.gameDate), asc(games.gameTime)),
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await getUser(request);
  const { team } = await requireTeamAccess((await teamIdFromCode(params.teamCode)), user.id);
  const formData = await request.formData();
  try {
    const name = readText(formData, "name", 120);
    if (!name) throw new FormError("Give it a name, like “Surf Cup hotel”");
    const categoryRaw = String(formData.get("category") ?? "other");
    const category: ItemCategory = (ITEM_CATEGORIES as readonly string[]).includes(categoryRaw) ? (categoryRaw as ItemCategory) : "other";
    const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(formData.get("dueDate"))) ? String(formData.get("dueDate")) : null;
    const mode = formData.get("mode") === "fixed" ? "fixed" : "split";
    const totalCents = mode === "split" ? readCents(formData, "total", "the total") : null;
    const shares = readShares(formData, mode);
    if (shares.length === 0) throw new FormError("Pick who shares it");

    // A double submit: the same person made the same expense a moment ago
    const [recent] = await db
      .select({ id: ledgerItems.id })
      .from(ledgerItems)
      .where(and(eq(ledgerItems.teamId, team.id), eq(ledgerItems.name, name), eq(ledgerItems.createdBy, user.id), sql`${ledgerItems.createdAt} > datetime('now', '-30 seconds')`))
      .limit(1);
    if (recent) return redirect(teamPath(team, `finances/items/${recent.id}`));

    const [item] = await db
      .insert(ledgerItems)
      .values({
        teamId: team.id,
        name,
        category,
        details: readText(formData, "details", 1000),
        refundable: formData.get("refundable") === "1",
        dueDate,
        shareMode: mode,
        totalCents,
        rounding: formData.get("rounding") === "dollar" ? "dollar" : "cent",
        createdBy: user.id,
      })
      .returning({ id: ledgerItems.id });
    try {
      await saveShares(team.id, item.id, shares);
      await saveExpenseGames(team.id, item.id, parseIds(formData.getAll("gameId")));
    } catch (e) {
      // Nothing points at it yet, so take it back out
      await db.delete(ledgerItems).where(and(eq(ledgerItems.id, item.id), eq(ledgerItems.teamId, team.id)));
      throw e;
    }
    return redirect(teamPath(team, `finances/items/${item.id}`));
  } catch (e) {
    if (e instanceof LedgerError || e instanceof FormError) return data({ error: e.message }, { status: 400 });
    throw e;
  }
}

export default function NewExpense({ loaderData }: Route.ComponentProps) {
  const { teamCode, formKey, members, upcomingGames } = loaderData;
  const fetcher = useFetcher<{ error?: string }>();
  const busy = fetcher.state !== "idle";
  const [mode, setMode] = useState<"split" | "fixed">("split");
  const [total, setTotal] = useState("");
  const [rounding, setRounding] = useState<"cent" | "dollar">("dollar");

  return (
    <Page width="narrow">
      <PageHeader back={{ to: teamPath(teamCode, "finances"), label: "Finances" }} title="New expense" description="What it's for, what it costs and who shares it. Families see their share once you send invoices." />

      <fetcher.Form method="post" className="space-y-6">
        <input type="hidden" name="clientKey" value={`${formKey}:expense`} />
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
            <textarea id="details" name="details" rows={2} maxLength={1000} className={cx(inputClass, "h-auto min-h-16 py-2.5")} placeholder="Entry fee plus the $400 referee deposit" />
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 ring-line transition hover:bg-surface-2 has-[:checked]:bg-primary-soft has-[:checked]:ring-primary">
            <input type="checkbox" name="refundable" value="1" className="mt-0.5" />
            <span>
              <span className="block text-sm font-semibold">Refundable</span>
              <span className="block text-sm text-muted">Money can come back from it, like a referee deposit or a cancelled tournament.</span>
            </span>
          </label>
        </Card>

        <Card className="space-y-4 p-5">
          <fieldset className="space-y-2">
            <legend className="mb-2 font-semibold">How it's shared</legend>
            {(
              [
                { value: "split", label: "Split a total", hint: "A full or half share each. People added later pay the same share." },
                { value: "fixed", label: "Each person's own amount", hint: "Like a merch order, where everyone owes something different." },
              ] as const
            ).map((o) => (
              <label key={o.value} className="flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 ring-line transition hover:bg-surface-2 has-[:checked]:bg-primary-soft has-[:checked]:ring-primary">
                <input type="radio" name="mode" value={o.value} checked={mode === o.value} onChange={() => setMode(o.value)} className="mt-0.5" />
                <span>
                  <span className="block text-sm font-semibold">{o.label}</span>
                  <span className="block text-sm text-muted">{o.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {mode === "split" && (
            <>
              <div>
                <label htmlFor="total" className={labelClass}>Total</label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted" aria-hidden>$</span>
                  <input
                    id="total"
                    name="total"
                    inputMode="decimal"
                    autoComplete="off"
                    required
                    value={total}
                    onChange={(e) => setTotal(e.target.value)}
                    placeholder="0.00"
                    className={cx(inputClass, "pl-7 tabular")}
                  />
                </div>
              </div>
              <label className="flex cursor-pointer items-start gap-3">
                <input type="checkbox" name="rounding" value="dollar" checked={rounding === "dollar"} onChange={(e) => setRounding(e.target.checked ? "dollar" : "cent")} className="mt-0.5" />
                <span className="text-sm">
                  <span className="block font-semibold">Round shares up to the dollar</span>
                  <span className="block text-muted">$116 instead of $115.79. The few extra dollars come back when you settle up.</span>
                </span>
              </label>
            </>
          )}
        </Card>

        {upcomingGames.length > 0 && (
          <Card className="p-5">
            <details>
              <summary className="cursor-pointer font-semibold">
                Games it's for <span className="font-normal text-muted">(optional)</span>
              </summary>
              <p className="mt-1 text-sm text-muted">Shows the cost on your schedule and each family's share on theirs.</p>
              <ul className="mt-3 max-h-60 divide-y divide-line overflow-y-auto rounded-xl ring-1 ring-line">
                {upcomingGames.map((g) => (
                  <li key={g.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-surface-2">
                      <input type="checkbox" name="gameId" value={g.id} />
                      <span className="w-28 shrink-0 text-muted">{formatGameDate(g.gameDate, { weekday: "short", month: "short", day: "numeric" })}</span>
                      <span className="min-w-0 truncate">vs {g.opponent}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </details>
          </Card>
        )}

        <Card className="space-y-3 p-5">
          <p className="font-semibold">Who shares it</p>
          <ShareEditor
            key={mode}
            mode={mode}
            totalCents={mode === "split" ? parseCents(total) : null}
            rounding={rounding}
            options={members.map((m) => ({ ...m, checked: m.key.startsWith("player:"), weight: FULL_SHARE, fixedCents: null }))}
          />
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Add expense"}</Button>
        </div>
      </fetcher.Form>
    </Page>
  );
}
