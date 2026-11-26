// Expenses, who shares them, and invoices. The rules are pure in ledger.ts;
// this file reads and writes the share and invoice tables, and posts through
// postTxnIn so every ledger write still goes through the same checks.
//
// The one rule: nothing reaches a family's account until it's on an invoice.
// Shares can be edited freely; "Send invoices" bills what changed since the
// last send (the difference between what each person should owe and what
// they've been billed), and puts it, with anything else not yet invoiced, on
// one locked invoice per family.

import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  db,
  contacts,
  guardians,
  ledgerEntries,
  ledgerFunds,
  ledgerInvoiceLines,
  ledgerInvoices,
  ledgerItems,
  ledgerShares,
  ledgerTxns,
  players,
  teams,
  type LedgerInvoice,
  type LedgerItem,
} from "~/db";
import {
  LedgerError,
  groupFamilies,
  invoiceStatuses,
  shareChanges,
  shareLines,
  shareTargets,
  unitPrice,
  type ExpenseSpec,
  type Member,
  type MemberCents,
  type ShareSpec,
  type TxnKind,
} from "~/utils/ledger";
import { sumCents, type Cents } from "~/utils/money";
import { memberKey, postTxnIn, type Tx } from "~/utils/ledger.server";
import { getTeamStaff } from "~/utils/team-access.server";
import { sendPush } from "~/utils/push.server";
import { formatCents } from "~/utils/money";

type Reader = typeof db | Tx;

// Kinds that go on an invoice: what someone owes for an expense, and anything
// that takes it down without them paying (a fund covering it, a refund owed)
const BILLABLE: TxnKind[] = ["charge", "adjust", "settle", "cover", "credit"];
const SHARE_KINDS: TxnKind[] = ["charge", "adjust", "settle"];

// ---------------------------------------------------------------------------
// Expenses and shares

export function expenseSpec(item: Pick<LedgerItem, "shareMode" | "totalCents" | "rounding" | "unitCents">): ExpenseSpec | null {
  if (!item.shareMode) return null; // Made before shares: charged directly
  return { mode: item.shareMode, totalCents: item.totalCents, rounding: item.rounding, unitCents: item.unitCents };
}

const shareMember = (r: { playerId: number | null; userId: number | null }): Member =>
  r.playerId !== null ? { type: "player", id: r.playerId } : { type: "staff", id: r.userId! };

export async function getShares(reader: Reader, teamId: number, itemIds?: number[]) {
  if (itemIds && itemIds.length === 0) return [];
  const rows = await reader
    .select()
    .from(ledgerShares)
    .where(itemIds ? and(eq(ledgerShares.teamId, teamId), inArray(ledgerShares.itemId, itemIds)) : eq(ledgerShares.teamId, teamId))
    .orderBy(asc(ledgerShares.id));
  return rows.map((r) => ({ itemId: r.itemId, spec: { member: shareMember(r), weight: r.weight, fixedCents: r.fixedCents } as ShareSpec }));
}

// Replaces who shares an expense. Nothing is billed here; the next invoice does that.
export async function saveShares(teamId: number, itemId: number, shares: ShareSpec[]) {
  const [item] = await db.select().from(ledgerItems).where(and(eq(ledgerItems.id, itemId), eq(ledgerItems.teamId, teamId))).limit(1);
  if (!item) throw new LedgerError("That expense isn't on this team");
  if (item.settledAt) throw new LedgerError("This expense is settled, so who shares it can't change");
  const spec = expenseSpec(item);
  if (!spec) throw new LedgerError("This expense was made before shares, so it can't be edited this way");
  // Throws on a bad weight or a missing amount
  shareTargets(spec, shares);
  const seen = new Set<string>();
  for (const s of shares) {
    const key = memberKey(s.member);
    if (seen.has(key)) throw new LedgerError("Someone is listed twice");
    seen.add(key);
  }
  await checkMembers(teamId, shares.map((s) => s.member));

  await db.transaction(async (tx) => {
    await tx.delete(ledgerShares).where(eq(ledgerShares.itemId, itemId));
    if (shares.length) {
      await tx.insert(ledgerShares).values(
        shares.map((s) => ({
          teamId,
          itemId,
          playerId: s.member.type === "player" ? s.member.id : null,
          userId: s.member.type === "staff" ? s.member.id : null,
          weight: s.weight,
          fixedCents: spec.mode === "fixed" ? s.fixedCents : null,
        }))
      );
    }
    await tx.update(ledgerItems).set({ updatedAt: new Date().toISOString() }).where(eq(ledgerItems.id, itemId));
  });
}

async function checkMembers(teamId: number, members: Member[]) {
  const playerIds = members.filter((m) => m.type === "player").map((m) => m.id);
  if (playerIds.length) {
    const found = await db.select({ id: players.id }).from(players).where(and(eq(players.teamId, teamId), inArray(players.id, playerIds)));
    if (found.length !== new Set(playerIds).size) throw new LedgerError("That player isn't on this team");
  }
  const staffIds = members.filter((m) => m.type === "staff").map((m) => m.id);
  if (staffIds.length) {
    const staff = new Set((await getTeamStaff(teamId)).map((s) => s.userId));
    if (staffIds.some((id) => !staff.has(id))) throw new LedgerError("That person isn't on this team's staff");
  }
}

// What each person has been billed so far, per expense (shares, changes and
// settle-ups; covers and refunds are separate). Reversed ones don't count.
async function billedByItem(reader: Reader, teamId: number) {
  const reversed = reader
    .select({ id: ledgerTxns.reversesId })
    .from(ledgerTxns)
    .where(and(eq(ledgerTxns.teamId, teamId), isNotNull(ledgerTxns.reversesId)));
  const rows = await reader
    .select({
      itemId: ledgerTxns.itemId,
      playerId: ledgerEntries.playerId,
      userId: ledgerEntries.userId,
      cents: sql<number>`sum(${ledgerEntries.cents})`,
    })
    .from(ledgerEntries)
    .innerJoin(ledgerTxns, eq(ledgerEntries.txnId, ledgerTxns.id))
    .where(
      and(
        eq(ledgerEntries.teamId, teamId),
        inArray(ledgerEntries.accountType, ["player", "staff"]),
        inArray(ledgerTxns.kind, SHARE_KINDS),
        isNotNull(ledgerTxns.itemId),
        sql`${ledgerTxns.id} not in ${reversed}`
      )
    )
    .groupBy(ledgerTxns.itemId, ledgerEntries.playerId, ledgerEntries.userId);
  const out = new Map<number, MemberCents[]>();
  for (const r of rows) {
    const list = out.get(r.itemId!) ?? [];
    list.push({ member: shareMember(r), cents: Number(r.cents) });
    out.set(r.itemId!, list);
  }
  return out;
}

export type PendingItem = { item: LedgerItem; changes: MemberCents[]; firstBilling: boolean; newMembers: Set<string> };

// For every expense with shares: what the next invoice would bill each person
export async function pendingShareChanges(reader: Reader, teamId: number): Promise<PendingItem[]> {
  const items = await reader
    .select()
    .from(ledgerItems)
    .where(and(eq(ledgerItems.teamId, teamId), isNotNull(ledgerItems.shareMode)))
    .orderBy(asc(ledgerItems.id));
  if (items.length === 0) return [];
  const shares = await getShares(reader, teamId, items.map((i) => i.id));
  const billed = await billedByItem(reader, teamId);
  const out: PendingItem[] = [];
  for (const item of items) {
    const spec = expenseSpec(item)!;
    const mine = shares.filter((s) => s.itemId === item.id).map((s) => s.spec);
    const already = billed.get(item.id) ?? [];
    let targets: MemberCents[];
    try {
      targets = shareTargets(spec, mine);
    } catch {
      continue; // A split with no total yet: nothing to bill
    }
    const changes = shareChanges(targets, already);
    const billedBefore = new Set(already.filter((b) => b.cents !== 0).map((b) => memberKey(b.member)));
    const newMembers = new Set(changes.map((c) => memberKey(c.member)).filter((k) => !billedBefore.has(k)));
    if (changes.length) out.push({ item, changes, firstBilling: billedBefore.size === 0 && spec.unitCents === null, newMembers });
  }
  return out;
}

// Each person's target on one expense, for its page: what they'll owe in all
export async function expenseTargets(teamId: number, item: LedgerItem) {
  const spec = expenseSpec(item);
  if (!spec) return { shares: [], targets: [] as MemberCents[], billed: [] as MemberCents[] };
  const shares = (await getShares(db, teamId, [item.id])).map((s) => s.spec);
  let targets: MemberCents[] = [];
  try {
    targets = shareTargets(spec, shares);
  } catch {
    targets = [];
  }
  const billed = (await billedByItem(db, teamId)).get(item.id) ?? [];
  return { shares, targets, billed };
}

// What each expense's shares add up to now (for a split, the shares can run a
// little over or under the total until it's settled)
export async function shareTotals(teamId: number) {
  const items = await db.select().from(ledgerItems).where(and(eq(ledgerItems.teamId, teamId), isNotNull(ledgerItems.shareMode)));
  const shares = await getShares(db, teamId, items.map((i) => i.id));
  const out = new Map<number, Cents>();
  for (const item of items) {
    try {
      const t = shareTargets(expenseSpec(item)!, shares.filter((s) => s.itemId === item.id).map((s) => s.spec));
      out.set(item.id, sumCents(t.map((x) => x.cents)));
    } catch {
      out.set(item.id, 0);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Families

export type Family = { key: string; name: string; members: Member[] };

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

function familyName(names: string[]) {
  if (names.length === 1) return names[0];
  const parts = names.map((n) => n.trim().split(/\s+/));
  const last = parts[0].length > 1 ? parts[0][parts[0].length - 1] : null;
  if (last && parts.every((p) => p.length > 1 && p[p.length - 1] === last)) {
    const firsts = parts.map((p) => p.slice(0, -1).join(" "));
    return `${firsts.slice(0, -1).join(", ")} & ${firsts[firsts.length - 1]} ${last}`;
  }
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

// Players grouped by shared contact emails and parent accounts; each staff member is their own
export async function teamFamilies(reader: Reader, teamId: number): Promise<Family[]> {
  const roster = await reader.select({ id: players.id, name: players.name }).from(players).where(eq(players.teamId, teamId)).orderBy(asc(players.name));
  const emails = await reader
    .select({ playerId: contacts.playerId, email: sql<string>`lower(trim(${contacts.email}))` })
    .from(contacts)
    .where(and(eq(contacts.teamId, teamId), isNotNull(contacts.playerId)));
  const parents = await reader.select({ playerId: guardians.playerId, userId: guardians.userId }).from(guardians).where(eq(guardians.teamId, teamId));
  const links = [
    ...emails.filter((e) => e.email).map((e) => ({ playerId: e.playerId!, key: `email:${e.email}` })),
    ...parents.map((p) => ({ playerId: p.playerId, key: `user:${p.userId}` })),
  ];
  const nameOf = new Map(roster.map((p) => [p.id, p.name]));
  const groups = groupFamilies(roster.map((p) => p.id), links);
  const staff = await getTeamStaff(teamId);
  return [
    ...groups.map((ids) => {
      const sorted = [...ids].sort((a, b) => (nameOf.get(a) ?? "").localeCompare(nameOf.get(b) ?? ""));
      return {
        key: `players:${[...ids].sort((a, b) => a - b).join(",")}`,
        name: familyName(sorted.map((id) => nameOf.get(id) ?? "A player")),
        members: sorted.map((id) => ({ type: "player" as const, id })),
      };
    }),
    ...staff.map((s) => ({ key: `staff:${s.userId}`, name: s.name || s.email.split("@")[0], members: [{ type: "staff" as const, id: s.userId }] })),
  ];
}

export function familyMembersFromKey(key: string): Member[] {
  const [type, list] = key.split(":");
  if (type === "staff") return [{ type: "staff", id: Number(list) }];
  return (list ?? "").split(",").filter(Boolean).map((id) => ({ type: "player", id: Number(id) }));
}

// ---------------------------------------------------------------------------
// What's not on an invoice yet

type OpenEntry = {
  entryId: number;
  txnId: number;
  kind: TxnKind;
  member: Member;
  cents: Cents;
  itemId: number | null;
  fundId: number | null;
  correction: boolean; // Undoes something that was already invoiced
};

async function uninvoicedEntries(reader: Reader, teamId: number): Promise<OpenEntry[]> {
  const rows = await reader
    .select({
      entryId: ledgerEntries.id,
      txnId: ledgerTxns.id,
      kind: ledgerTxns.kind,
      reversesId: ledgerTxns.reversesId,
      playerId: ledgerEntries.playerId,
      userId: ledgerEntries.userId,
      cents: ledgerEntries.cents,
      itemId: ledgerTxns.itemId,
      fundId: ledgerTxns.fundId,
    })
    .from(ledgerEntries)
    .innerJoin(ledgerTxns, eq(ledgerEntries.txnId, ledgerTxns.id))
    .leftJoin(ledgerInvoiceLines, eq(ledgerInvoiceLines.entryId, ledgerEntries.id))
    .where(and(eq(ledgerEntries.teamId, teamId), inArray(ledgerEntries.accountType, ["player", "staff"]), sql`${ledgerInvoiceLines.id} is null`))
    .orderBy(asc(ledgerEntries.id));
  if (rows.length === 0) return [];

  // Reversals: which originals they undo, what kind those were, and whether they were invoiced
  const txnIds = [...new Set(rows.map((r) => r.txnId))];
  const reversedBy = new Map(
    (await reader.select({ id: ledgerTxns.id, reversesId: ledgerTxns.reversesId }).from(ledgerTxns).where(inArray(ledgerTxns.reversesId, txnIds))).map((r) => [
      r.reversesId!,
      r.id,
    ])
  );
  const originalIds = [...new Set(rows.map((r) => r.reversesId).filter((id): id is number => id !== null))];
  const originals = originalIds.length
    ? await reader.select({ id: ledgerTxns.id, kind: ledgerTxns.kind }).from(ledgerTxns).where(inArray(ledgerTxns.id, originalIds))
    : [];
  const originalKind = new Map(originals.map((o) => [o.id, o.kind]));
  const invoicedTxns = new Set(
    originalIds.length
      ? (
          await reader
            .selectDistinct({ txnId: ledgerEntries.txnId })
            .from(ledgerInvoiceLines)
            .innerJoin(ledgerEntries, eq(ledgerInvoiceLines.entryId, ledgerEntries.id))
            .where(inArray(ledgerEntries.txnId, originalIds))
        ).map((r) => r.txnId)
      : []
  );

  const out: OpenEntry[] = [];
  for (const r of rows) {
    const member = shareMember(r);
    if (r.kind === "reversal") {
      // Only an undo of something families were already billed for needs to reach them
      const kind = r.reversesId ? originalKind.get(r.reversesId) : undefined;
      if (!kind || !BILLABLE.includes(kind) || !invoicedTxns.has(r.reversesId!)) continue;
      out.push({ entryId: r.entryId, txnId: r.txnId, kind, member, cents: r.cents, itemId: r.itemId, fundId: r.fundId, correction: true });
      continue;
    }
    if (!BILLABLE.includes(r.kind)) continue;
    // Made and undone before any invoice: the pair cancels, leave both off
    if (reversedBy.has(r.txnId)) continue;
    out.push({ entryId: r.entryId, txnId: r.txnId, kind: r.kind, member, cents: r.cents, itemId: r.itemId, fundId: r.fundId, correction: false });
  }
  return out;
}

function lineLabel(e: { kind: TxnKind; correction: boolean }, itemName: string, fundName: string) {
  const base =
    e.kind === "charge" ? `Share of ${itemName}`
    : e.kind === "adjust" ? `Change to your share of ${itemName}`
    : e.kind === "settle" ? `Settle-up for ${itemName}`
    : e.kind === "cover" ? `Paid by ${fundName}: ${itemName}`
    : e.kind === "credit" ? `Refund on ${itemName}`
    : itemName;
  return e.correction ? `Correction: ${base.charAt(0).toLowerCase()}${base.slice(1)}` : base;
}

// ---------------------------------------------------------------------------
// Preview and send

export type DraftLine = { member: Member; who: string; label: string; cents: Cents };
export type DraftInvoice = { familyKey: string; familyName: string; lines: DraftLine[]; totalCents: Cents };

async function names(reader: Reader, teamId: number) {
  const roster = await reader.select({ id: players.id, name: players.name }).from(players).where(eq(players.teamId, teamId));
  const staff = await getTeamStaff(teamId);
  const items = await reader.select({ id: ledgerItems.id, name: ledgerItems.name }).from(ledgerItems).where(eq(ledgerItems.teamId, teamId));
  const funds = await reader.select({ id: ledgerFunds.id, name: ledgerFunds.name, visible: ledgerFunds.visibleToFamilies }).from(ledgerFunds).where(eq(ledgerFunds.teamId, teamId));
  const player = new Map(roster.map((p) => [p.id, p.name]));
  const staffName = new Map(staff.map((s) => [s.userId, s.name || s.email.split("@")[0]]));
  const item = new Map(items.map((i) => [i.id, i.name]));
  const fund = new Map(funds.map((f) => [f.id, f.visible ? f.name : "the team"]));
  return {
    who: (m: Member) => (m.type === "player" ? player.get(m.id) ?? "A player" : staffName.get(m.id) ?? "A staff member"),
    item: (id: number | null) => (id === null ? "team costs" : item.get(id) ?? "an expense"),
    fund: (id: number | null) => (id === null ? "the team" : fund.get(id) ?? "the team"),
  };
}

function groupDrafts(families: Family[], lines: (DraftLine & { entryId?: number; itemId?: number | null })[]) {
  const familyOf = new Map<string, Family>();
  for (const f of families) for (const m of f.members) familyOf.set(memberKey(m), f);
  const drafts = new Map<string, DraftInvoice & { raw: typeof lines }>();
  for (const l of lines) {
    const f = familyOf.get(memberKey(l.member)) ?? {
      key: l.member.type === "staff" ? `staff:${l.member.id}` : `players:${l.member.id}`,
      name: l.who,
      members: [l.member],
    };
    const d = drafts.get(f.key) ?? { familyKey: f.key, familyName: f.name, lines: [], totalCents: 0, raw: [] };
    d.lines.push({ member: l.member, who: l.who, label: l.label, cents: l.cents });
    d.raw.push(l);
    d.totalCents += l.cents;
    drafts.set(f.key, d);
  }
  return [...drafts.values()].sort((a, b) => a.familyName.localeCompare(b.familyName));
}

// What "Send invoices" would send right now
export async function invoicePreview(teamId: number): Promise<{ drafts: DraftInvoice[]; totalCents: Cents }> {
  const n = await names(db, teamId);
  const pending = await pendingShareChanges(db, teamId);
  const open = await uninvoicedEntries(db, teamId);
  const lines: DraftLine[] = [
    ...open.map((e) => ({ member: e.member, who: n.who(e.member), label: lineLabel(e, n.item(e.itemId), n.fund(e.fundId)), cents: e.cents })),
    ...pending.flatMap((p) =>
      p.changes.map((c) => ({
        member: c.member,
        who: n.who(c.member),
        label: lineLabel(
          { kind: p.firstBilling || p.newMembers.has(memberKey(c.member)) ? "charge" : p.item.settledAt ? "settle" : "adjust", correction: false },
          p.item.name,
          ""
        ),
        cents: c.cents,
      }))
    ),
  ];
  const drafts = groupDrafts(await teamFamilies(db, teamId), lines).map(({ raw: _raw, ...d }) => d);
  return { drafts, totalCents: sumCents(drafts.map((d) => d.totalCents)) };
}

// Bills every share change, then puts everything not yet invoiced on one
// invoice per family. All or nothing; sending the same form twice sends once.
export async function sendInvoices(teamId: number, by: number, formKey: string) {
  const key = formKey.trim();
  if (!key || key.length > 60) throw new LedgerError("Reload the page and try again");

  // Reads that don't need to be in the transaction (Turso keeps those short)
  const families = await teamFamilies(db, teamId);

  const sent = await db.transaction(async (tx) => {
    const pending = await pendingShareChanges(tx, teamId);
    for (const p of pending) {
      const spec = expenseSpec(p.item)!;
      // The first invoice fixes a full share's price, so people added later pay the same
      if (spec.mode === "split" && spec.unitCents === null && spec.totalCents !== null) {
        const weight = (await getShares(tx, teamId, [p.item.id])).reduce((a, s) => a + s.spec.weight, 0);
        if (weight > 0) {
          await tx.update(ledgerItems).set({ unitCents: unitPrice(spec.totalCents, weight, spec.rounding) }).where(eq(ledgerItems.id, p.item.id));
        }
      }
      await postTxnIn(tx, {
        teamId,
        kind: p.firstBilling ? "charge" : p.item.settledAt ? "settle" : "adjust",
        lines: shareLines(p.item.id, p.changes),
        createdBy: by,
        clientKey: `${key}:item:${p.item.id}`,
        itemId: p.item.id,
      });
    }

    const open = await uninvoicedEntries(tx, teamId);
    if (open.length === 0) return [];
    const n = await names(tx, teamId);
    const invoicedShares = new Set(
      (
        await tx
          .selectDistinct({ itemId: ledgerInvoiceLines.itemId, playerId: ledgerInvoiceLines.playerId, userId: ledgerInvoiceLines.userId })
          .from(ledgerInvoiceLines)
          .innerJoin(ledgerInvoices, eq(ledgerInvoiceLines.invoiceId, ledgerInvoices.id))
          .where(and(eq(ledgerInvoices.teamId, teamId), isNotNull(ledgerInvoiceLines.itemId)))
      ).map((r) => `${r.itemId}|${memberKey(shareMember(r))}`)
    );
    const firstShare = (e: OpenEntry) =>
      e.kind === "adjust" && e.cents > 0 && e.itemId !== null && !invoicedShares.has(`${e.itemId}|${memberKey(e.member)}`);
    const drafts = groupDrafts(
      families,
      open.map((e) => ({
        member: e.member,
        who: n.who(e.member),
        label: lineLabel(firstShare(e) ? { ...e, kind: "charge" } : e, n.item(e.itemId), n.fund(e.fundId)),
        cents: e.cents,
        entryId: e.entryId,
        itemId: e.itemId,
      }))
    );

    const [last] = await tx.select({ n: sql<number>`coalesce(max(${ledgerInvoices.number}), 0)` }).from(ledgerInvoices).where(eq(ledgerInvoices.teamId, teamId));
    let number = Number(last?.n ?? 0);
    const invoices = await tx
      .insert(ledgerInvoices)
      .values(drafts.map((d) => ({ teamId, number: ++number, familyKey: d.familyKey, familyName: d.familyName, totalCents: d.totalCents, issuedBy: by, clientKey: `${key}:${d.familyKey}`.slice(0, 200) })))
      .returning({ id: ledgerInvoices.id, familyKey: ledgerInvoices.familyKey });
    const idOf = new Map(invoices.map((i) => [i.familyKey, i.id]));
    // Every line in one statement; name the kid when an invoice covers more than one
    await tx.insert(ledgerInvoiceLines).values(
      drafts.flatMap((d) => {
        const several = new Set(d.raw.map((l) => memberKey(l.member))).size > 1;
        return d.raw.map((l) => ({
          invoiceId: idOf.get(d.familyKey)!,
          entryId: l.entryId!,
          playerId: l.member.type === "player" ? l.member.id : null,
          userId: l.member.type === "staff" ? l.member.id : null,
          itemId: l.itemId ?? null,
          label: several ? `${l.label} (${firstName(l.who)})` : l.label,
          cents: l.cents,
        }));
      })
    );
    return drafts.map((d) => ({
      id: idOf.get(d.familyKey)!,
      familyKey: d.familyKey,
      familyName: d.familyName,
      totalCents: d.totalCents,
      members: [...new Map(d.raw.map((l) => [memberKey(l.member), l.member])).values()],
    }));
  });

  // Tell each family's parents (and staff members their own), after it's saved
  if (sent.length) {
    const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, teamId)).limit(1);
    for (const inv of sent) {
      const playerIds = inv.members.filter((m) => m.type === "player").map((m) => m.id);
      const parentIds = playerIds.length
        ? (await db.selectDistinct({ userId: guardians.userId }).from(guardians).where(and(eq(guardians.teamId, teamId), inArray(guardians.playerId, playerIds)))).map((r) => r.userId)
        : inv.members.map((m) => m.id);
      if (parentIds.length === 0) continue;
      await sendPush(parentIds, "team", {
        title: `${team?.name ?? "Your team"}: new invoice`,
        body: inv.totalCents > 0 ? `Your share comes to ${formatCents(inv.totalCents)}.` : `You have ${formatCents(-inv.totalCents)} coming back.`,
        url: "/family/finances",
        tag: `invoice-${inv.id}`,
      });
    }
  }
  return sent;
}

// ---------------------------------------------------------------------------
// Reading invoices

export type InvoiceView = {
  id: number;
  number: number;
  familyKey: string;
  familyName: string;
  issuedAt: string;
  totalCents: Cents;
  paid: Cents;
  remaining: Cents;
  lines: { label: string; cents: Cents; playerId: number | null; itemId: number | null }[];
};

// Balance and money paid in for a set of accounts: paid in is what's been billed less what's still owed
async function paidInFor(reader: Reader, teamId: number, members: Member[], openEntries: OpenEntry[]) {
  if (members.length === 0) return { balance: 0, open: 0 };
  const playerIds = members.filter((m) => m.type === "player").map((m) => m.id);
  const userIds = members.filter((m) => m.type === "staff").map((m) => m.id);
  const who = sql.join(
    [
      ...(playerIds.length ? [sql`(${ledgerEntries.accountType} = 'player' and ${inArray(ledgerEntries.playerId, playerIds)})`] : []),
      ...(userIds.length ? [sql`(${ledgerEntries.accountType} = 'staff' and ${inArray(ledgerEntries.userId, userIds)})`] : []),
    ],
    sql` or `
  );
  const [row] = await reader
    .select({ total: sql<number>`coalesce(sum(${ledgerEntries.cents}), 0)` })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.teamId, teamId), sql`(${who})`));
  const balance = Number(row?.total ?? 0);
  const keys = new Set(members.map(memberKey));
  const open = openEntries.filter((e) => keys.has(memberKey(e.member)));
  return { balance, open: sumCents(open.map((e) => e.cents)) };
}

// Every invoice on a team, newest first, with how much of each is paid
export async function teamInvoices(teamId: number): Promise<InvoiceView[]> {
  const invoices = await db.select().from(ledgerInvoices).where(eq(ledgerInvoices.teamId, teamId)).orderBy(asc(ledgerInvoices.id));
  if (invoices.length === 0) return [];
  const lines = await db
    .select()
    .from(ledgerInvoiceLines)
    .where(inArray(ledgerInvoiceLines.invoiceId, invoices.map((i) => i.id)))
    .orderBy(asc(ledgerInvoiceLines.id));
  const byFamily = new Map<string, LedgerInvoice[]>();
  for (const inv of invoices) byFamily.set(inv.familyKey, [...(byFamily.get(inv.familyKey) ?? []), inv]);
  const status = new Map<number, { paid: Cents; remaining: Cents }>();
  const openEntries = await uninvoicedEntries(db, teamId);
  for (const [familyKey, list] of byFamily) {
    const { balance, open } = await paidInFor(db, teamId, familyMembersFromKey(familyKey), openEntries);
    const paidIn = sumCents(list.map((i) => i.totalCents)) + open - balance;
    for (const s of invoiceStatuses(list, paidIn)) status.set(s.id, s);
  }
  return invoices
    .map((inv) => ({
      id: inv.id,
      number: inv.number,
      familyKey: inv.familyKey,
      familyName: inv.familyName,
      issuedAt: inv.issuedAt,
      totalCents: inv.totalCents,
      paid: status.get(inv.id)?.paid ?? 0,
      remaining: status.get(inv.id)?.remaining ?? 0,
      lines: lines.filter((l) => l.invoiceId === inv.id).map((l) => ({ label: l.label, cents: l.cents, playerId: l.playerId, itemId: l.itemId })),
    }))
    .reverse();
}

// A parent's invoices on one team: only the lines for their own kids, and
// what's paid worked out from their own kids' accounts
export async function familyInvoices(teamId: number, playerIds: number[]): Promise<InvoiceView[]> {
  if (playerIds.length === 0) return [];
  const lines = await db
    .select({ line: ledgerInvoiceLines, invoice: ledgerInvoices })
    .from(ledgerInvoiceLines)
    .innerJoin(ledgerInvoices, eq(ledgerInvoiceLines.invoiceId, ledgerInvoices.id))
    .where(and(eq(ledgerInvoices.teamId, teamId), inArray(ledgerInvoiceLines.playerId, playerIds)))
    .orderBy(asc(ledgerInvoices.id), asc(ledgerInvoiceLines.id));
  if (lines.length === 0) return [];
  const invoices = new Map<number, InvoiceView>();
  for (const { line, invoice } of lines) {
    const view = invoices.get(invoice.id) ?? {
      id: invoice.id,
      number: invoice.number,
      familyKey: invoice.familyKey,
      familyName: invoice.familyName,
      issuedAt: invoice.issuedAt,
      totalCents: 0,
      paid: 0,
      remaining: 0,
      lines: [],
    };
    view.lines.push({ label: line.label, cents: line.cents, playerId: line.playerId, itemId: line.itemId });
    view.totalCents += line.cents;
    invoices.set(invoice.id, view);
  }
  const list = [...invoices.values()];
  const { balance, open } = await paidInFor(db, teamId, playerIds.map((id) => ({ type: "player" as const, id })), await uninvoicedEntries(db, teamId));
  const paidIn = sumCents(list.map((i) => i.totalCents)) + open - balance;
  const statuses = invoiceStatuses(list, paidIn);
  return list.map((inv, i) => ({ ...inv, paid: statuses[i].paid, remaining: statuses[i].remaining })).reverse();
}

export async function latestInvoiceDate(teamId: number) {
  const [row] = await db.select({ issuedAt: ledgerInvoices.issuedAt }).from(ledgerInvoices).where(eq(ledgerInvoices.teamId, teamId)).orderBy(desc(ledgerInvoices.id)).limit(1);
  return row?.issuedAt ?? null;
}
