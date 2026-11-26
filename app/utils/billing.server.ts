// Expenses, who shares them, and invoices. The rules are pure in ledger.ts;
// this file reads and writes the share and invoice tables, and posts through
// postTxnIn so every ledger write still goes through the same checks.
//
// The one rule: nothing reaches a family's account until it's on an invoice.
// Shares can be edited freely; "Send invoices" bills what changed since the
// last send (the difference between what each person should owe and what
// they've been billed), and puts it, with anything else not yet invoiced, on
// one locked invoice per family.

import crypto from "node:crypto";
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
  users,
  type LedgerInvoice,
  type LedgerItem,
} from "~/db";
import {
  LedgerError,
  groupFamilies,
  invoiceStatuses,
  shareChanges,
  settleTargets,
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
import { coachFromAddress, familyDeliveryAddress, sendEmail } from "~/utils/email.server";
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
async function billedByItem(reader: Reader, teamId: number, kinds: TxnKind[] = SHARE_KINDS) {
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
        inArray(ledgerTxns.kind, kinds),
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

// What each expense has cost the team so far: paid out, less refunds received
export async function expenseCosts(reader: Reader, teamId: number) {
  const reversed = reader
    .select({ id: ledgerTxns.reversesId })
    .from(ledgerTxns)
    .where(and(eq(ledgerTxns.teamId, teamId), isNotNull(ledgerTxns.reversesId)));
  const rows = await reader
    .select({ itemId: ledgerEntries.itemId, kind: ledgerTxns.kind, cents: sql<number>`sum(${ledgerEntries.cents})` })
    .from(ledgerEntries)
    .innerJoin(ledgerTxns, eq(ledgerEntries.txnId, ledgerTxns.id))
    .where(
      and(
        eq(ledgerEntries.teamId, teamId),
        eq(ledgerEntries.accountType, "item"),
        inArray(ledgerTxns.kind, ["expense", "vendor_refund"]),
        sql`${ledgerTxns.id} not in ${reversed}`
      )
    )
    .groupBy(ledgerEntries.itemId, ledgerTxns.kind);
  const out = new Map<number, { paidOut: Cents; returned: Cents; cost: Cents }>();
  for (const r of rows) {
    const c = out.get(r.itemId!) ?? { paidOut: 0, returned: 0, cost: 0 };
    if (r.kind === "expense") c.paidOut += Number(r.cents);
    else c.returned -= Number(r.cents);
    c.cost = c.paidOut - c.returned;
    out.set(r.itemId!, c);
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
  const settled = items.some((i) => i.settledAt);
  // A settled expense is compared against what people were billed less refunds they've had
  const billedNet = settled ? await billedByItem(reader, teamId, [...SHARE_KINDS, "credit"]) : billed;
  const costs = settled ? await expenseCosts(reader, teamId) : new Map();
  const out: PendingItem[] = [];
  for (const item of items) {
    const spec = expenseSpec(item)!;
    const mine = shares.filter((s) => s.itemId === item.id).map((s) => s.spec);
    const already = (item.settledAt ? billedNet : billed).get(item.id) ?? [];
    let targets: MemberCents[];
    try {
      targets = item.settledAt ? settleTargets(costs.get(item.id)?.cost ?? 0, mine) : shareTargets(spec, mine);
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
    // Settled: what each person's part of the real cost comes to
    targets = item.settledAt ? settleTargets((await expenseCosts(db, teamId)).get(item.id)?.cost ?? 0, shares) : shareTargets(spec, shares);
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
// Settling up: when an expense is done (everything paid out, any deposit back),
// its real cost is re-split by share. Each person's difference goes on their
// next invoice, mostly as money back. Until those are invoiced it can be reopened.

export async function settlePreview(teamId: number, item: LedgerItem) {
  const shares = (await getShares(db, teamId, [item.id])).map((s) => s.spec);
  const cost = (await expenseCosts(db, teamId)).get(item.id) ?? { paidOut: 0, returned: 0, cost: 0 };
  const net = (await billedByItem(db, teamId, [...SHARE_KINDS, "credit"])).get(item.id) ?? [];
  type Row = { member: Member; billed: Cents; final: Cents; change: Cents };
  // More came back than went out (a refund recorded before the payout): nothing to split yet
  if (shares.length === 0 || cost.cost < 0) return { ...cost, rows: [] as Row[] };
  const targets = settleTargets(cost.cost, shares);
  const billedOf = new Map(net.map((b) => [memberKey(b.member), b.cents]));
  const sharing = new Set(targets.map((t) => memberKey(t.member)));
  return {
    ...cost,
    rows: [
      ...targets.map((t) => {
        const billed = billedOf.get(memberKey(t.member)) ?? 0;
        return { member: t.member, billed, final: t.cents, change: t.cents - billed };
      }),
      // Taken off the expense after being billed: all of it comes back
      ...net.filter((b) => !sharing.has(memberKey(b.member)) && b.cents !== 0).map((b) => ({ member: b.member, billed: b.cents, final: 0, change: -b.cents })),
    ] as Row[],
  };
}

export async function settleExpense(teamId: number, itemId: number, by: number) {
  const [item] = await db.select().from(ledgerItems).where(and(eq(ledgerItems.id, itemId), eq(ledgerItems.teamId, teamId))).limit(1);
  if (!item) throw new LedgerError("That expense isn't on this team");
  if (item.shareMode !== "split") throw new LedgerError("Only an expense split between people can be settled up");
  if (item.settledAt) return;
  const shares = await getShares(db, teamId, [itemId]);
  if (shares.length === 0) throw new LedgerError("Nobody shares this expense");
  const cost = (await expenseCosts(db, teamId)).get(itemId);
  if (!cost || cost.paidOut === 0) throw new LedgerError("Record what the team paid out for it first. Settling splits what it really cost.");
  await db.update(ledgerItems).set({ settledAt: new Date().toISOString(), settledBy: by, updatedAt: new Date().toISOString() }).where(eq(ledgerItems.id, itemId));
}

// Undo a settle-up nobody has been invoiced for yet
export async function reopenExpense(teamId: number, itemId: number) {
  const [posted] = await db
    .select({ id: ledgerTxns.id })
    .from(ledgerTxns)
    .where(and(eq(ledgerTxns.teamId, teamId), eq(ledgerTxns.itemId, itemId), eq(ledgerTxns.kind, "settle")))
    .limit(1);
  if (posted) throw new LedgerError("The settle-up is already on invoices, so it can't be reopened");
  await db.update(ledgerItems).set({ settledAt: null, settledBy: null, updatedAt: new Date().toISOString() }).where(and(eq(ledgerItems.id, itemId), eq(ledgerItems.teamId, teamId)));
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
          { kind: p.item.settledAt && !p.firstBilling ? "settle" : p.firstBilling || p.newMembers.has(memberKey(c.member)) ? "charge" : "adjust", correction: false },
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
export async function sendInvoices(teamId: number, by: number, formKey: string, origin: string) {
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
    const [team] = await db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.id, teamId)).limit(1);
    if (team) await emailInvoices(team, by, sent.map((s) => s.id), origin);
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
// Paying without signing in. A link per family, signed for that family's kids:
// /pay/<team>-<player ids>-<signature>. Nothing is stored, so a link keeps
// working as long as the kids are on the team. It only shows what they owe;
// paying happens on Venmo.

function paySignature(teamId: number, ids: string) {
  const secret = process.env.SESSION_SECRET || "dev-secret-change-in-production";
  return crypto.createHmac("sha256", secret).update(`pay:${teamId}:${ids}`).digest("base64url").slice(0, 22);
}

export function payToken(teamId: number, playerIds: number[]) {
  const ids = [...new Set(playerIds)].sort((a, b) => a - b).join(".");
  return `${teamId}-${ids}-${paySignature(teamId, ids)}`;
}

export function payPath(teamId: number, familyKey: string) {
  const playerIds = familyMembersFromKey(familyKey).filter((m) => m.type === "player").map((m) => m.id);
  return playerIds.length ? `/pay/${payToken(teamId, playerIds)}` : null;
}

export async function findPayFamily(token: string) {
  const match = /^(\d+)-(\d+(?:\.\d+)*)-([A-Za-z0-9_-]{22})$/.exec(token);
  if (!match) return null;
  const teamId = Number(match[1]);
  const given = Buffer.from(match[3]);
  const expected = Buffer.from(paySignature(teamId, match[2]));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  const ids = match[2].split(".").map(Number);
  const [team] = await db.select({ id: teams.id, name: teams.name, venmoHandle: teams.venmoHandle }).from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team) return null;
  const kids = await db
    .select({ id: players.id, name: players.name })
    .from(players)
    .where(and(eq(players.teamId, teamId), inArray(players.id, ids)))
    .orderBy(asc(players.name));
  if (kids.length === 0) return null;
  return { team, kids };
}

// What a family owes, for the pay page: their invoices, and one amount for all their kids
export async function payView(teamId: number, playerIds: number[]) {
  const invoices = await familyInvoices(teamId, playerIds);
  const { balance } = await paidInFor(db, teamId, playerIds.map((id) => ({ type: "player" as const, id })), []);
  return { invoices, owed: Math.max(0, balance), dueBack: Math.max(0, -balance) };
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// Each family's invoice by email, to every contact email on their kids, with
// their pay link. Outside production it goes to the sender instead (see
// familyDeliveryAddress). A failed email doesn't undo the send.
export async function emailInvoices(team: { id: number; name: string }, by: number, invoiceIds: number[], origin: string) {
  const [sender] = await db.select({ id: users.id, name: users.name, email: users.email, sendingEmail: users.sendingEmail }).from(users).where(eq(users.id, by)).limit(1);
  if (!sender) return;
  const from = coachFromAddress(sender, team);
  const invoices = await db.select().from(ledgerInvoices).where(inArray(ledgerInvoices.id, invoiceIds));
  const lines = await db.select().from(ledgerInvoiceLines).where(inArray(ledgerInvoiceLines.invoiceId, invoiceIds)).orderBy(asc(ledgerInvoiceLines.id));
  for (const inv of invoices) {
    const path = payPath(team.id, inv.familyKey);
    if (!path) continue; // A staff member's own share: they see it in the app
    const playerIds = familyMembersFromKey(inv.familyKey).map((m) => m.id);
    const emails = await db
      .selectDistinct({ email: sql<string>`lower(trim(${contacts.email}))` })
      .from(contacts)
      // Parents and guardians, not emergency contacts
      .where(and(eq(contacts.teamId, team.id), inArray(contacts.playerId, playerIds), sql`coalesce(${contacts.relationship}, '') != 'emergency'`));
    if (emails.length === 0) continue;
    const { owed, dueBack } = await payView(team.id, playerIds);
    const url = `${origin}${path}`;
    const mine = lines.filter((l) => l.invoiceId === inv.id);
    const amount = (cents: number) => `${cents < 0 ? "−" : ""}${formatCents(Math.abs(cents))}`;
    const subject = `${team.name}: invoice #${inv.number} for ${amount(inv.totalCents)}`;
    const text = [
      "Hi,",
      "",
      `Here's invoice #${inv.number} from ${team.name}, for ${inv.familyName}:`,
      "",
      ...mine.map((l) => `  ${l.label}: ${amount(l.cents)}`),
      `  Total: ${amount(inv.totalCents)}`,
      "",
      owed > 0
        ? `You owe ${formatCents(owed)} in all. See your invoices and pay on Venmo here, no sign-in needed:`
        : dueBack > 0
          ? `The team owes you ${formatCents(dueBack)}. The coach will pay it back. Your invoices are here:`
          : "You're all paid up. Your invoices are here:",
      url,
      "",
      `Questions? Just reply to this email.`,
      "",
      sender.name || sender.email.split("@")[0],
    ].join("\n");
    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#0f172a;max-width:520px">
<p>Hi,</p>
<p>Here's invoice #${inv.number} from ${escapeHtml(team.name)}, for ${escapeHtml(inv.familyName)}:</p>
<table style="width:100%;border-collapse:collapse;font-size:14px">
${mine.map((l) => `<tr><td style="padding:6px 0;border-bottom:1px solid #e2e8f0;color:#475569">${escapeHtml(l.label)}</td><td style="padding:6px 0;border-bottom:1px solid #e2e8f0;text-align:right;white-space:nowrap">${amount(l.cents)}</td></tr>`).join("\n")}
<tr><td style="padding:8px 0;font-weight:600">Total</td><td style="padding:8px 0;text-align:right;font-weight:600">${amount(inv.totalCents)}</td></tr>
</table>
<p>${owed > 0 ? `You owe <strong>${formatCents(owed)}</strong> in all.` : dueBack > 0 ? `The team owes you <strong>${formatCents(dueBack)}</strong>. The coach will pay it back.` : "You're all paid up."}</p>
<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#0284c7;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">${owed > 0 ? `See it and pay ${formatCents(owed)}` : "See your invoices"}</a></p>
<p style="color:#64748b;font-size:13px">No sign-in needed. Questions? Just reply to this email.</p>
<p>${escapeHtml(sender.name || sender.email.split("@")[0])}</p>
</div>`;
    for (const { email } of emails) {
      if (!email) continue;
      await sendEmail({
        to: familyDeliveryAddress(email, sender.email),
        from: from.header,
        replyTo: from.address,
        subject,
        text,
        html,
        tags: [{ name: "kind", value: "invoice" }],
        idempotencyKey: `invoice-${inv.id}-${email}`.slice(0, 250),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Reading invoices

export type InvoiceView = {
  id: number;
  payPath?: string | null; // Staff only: the family's no-sign-in link
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
      payPath: payPath(teamId, inv.familyKey),
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
