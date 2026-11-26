// Reads and writes for the team money ledger. The rules are in ledger.ts
// (pure, unit tested); this file is the only place that writes ledger rows,
// and every write goes through postTxn.

import crypto from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  guardians,
  ledgerClaims,
  ledgerEntries,
  ledgerFunds,
  ledgerItems,
  ledgerTxns,
  players,
  teams,
  users,
  type LedgerClaim,
  type LedgerItem,
  type LedgerTxn,
} from "~/db";
import {
  LedgerError,
  accountKey,
  assertBalanced,
  balances,
  overdrawn,
  paymentLines,
  reversalLines,
  statement,
  type Account,
  type AccountType,
  type ItemCategory,
  type Line,
  type Member,
  type MemberLine,
  type PaymentMethod,
  type Statement,
  type TxnKind,
} from "~/utils/ledger";
import { sumCents, type Cents } from "~/utils/money";
import { getTeamStaff } from "~/utils/team-access.server";
import { todayISO } from "~/utils/dates";

// The schema repeats the enums in ledger.ts; this fails to compile if they drift apart
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const enumsMatch: [
  Same<LedgerTxn["kind"], TxnKind>,
  Same<LedgerItem["category"], ItemCategory>,
  Same<NonNullable<LedgerTxn["method"]>, PaymentMethod>,
  Same<(typeof ledgerEntries.$inferSelect)["accountType"], AccountType>,
] = [true, true, true, true];
void enumsMatch;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = typeof db | Tx;

export { LedgerError };

// ---------------------------------------------------------------------------
// Rows <-> accounts

type EntryRow = typeof ledgerEntries.$inferSelect;

function entryAccount(r: Pick<EntryRow, "accountType" | "playerId" | "userId" | "itemId" | "fundId">): Account {
  return { type: r.accountType, id: r.playerId ?? r.userId ?? r.itemId ?? r.fundId ?? null };
}

function entryRow(txnId: number, teamId: number, l: Line) {
  const { type, id } = l.account;
  return {
    txnId,
    teamId,
    accountType: type,
    cents: l.cents,
    playerId: type === "player" ? id : null,
    userId: type === "staff" ? id : null,
    itemId: type === "item" ? id : null,
    fundId: type === "fund" ? id : null,
  };
}

const ids = (lines: Line[], type: AccountType) => [...new Set(lines.filter((l) => l.account.type === type).map((l) => l.account.id!))];

// Every account a transaction touches has to belong to this team. Staff
// accounts: anyone on staff now, or anyone the team already has money with
// (so someone who left can still be paid back).
async function checkAccounts(tx: Reader, teamId: number, lines: Line[]) {
  const playerIds = ids(lines, "player");
  if (playerIds.length) {
    const found = await tx.select({ id: players.id }).from(players).where(and(eq(players.teamId, teamId), inArray(players.id, playerIds)));
    if (found.length !== playerIds.length) throw new LedgerError("That player isn't on this team");
  }
  const itemIds = ids(lines, "item");
  if (itemIds.length) {
    const found = await tx.select({ id: ledgerItems.id }).from(ledgerItems).where(and(eq(ledgerItems.teamId, teamId), inArray(ledgerItems.id, itemIds)));
    if (found.length !== itemIds.length) throw new LedgerError("That item isn't on this team");
  }
  const fundIds = ids(lines, "fund");
  if (fundIds.length) {
    const found = await tx.select({ id: ledgerFunds.id }).from(ledgerFunds).where(and(eq(ledgerFunds.teamId, teamId), inArray(ledgerFunds.id, fundIds)));
    if (found.length !== fundIds.length) throw new LedgerError("That fund isn't on this team");
  }
  const staffIds = ids(lines, "staff");
  if (staffIds.length) {
    const current = new Set((await getTeamStaff(teamId)).map((s) => s.userId));
    const missing = staffIds.filter((id) => !current.has(id));
    if (missing.length) {
      const past = await tx
        .selectDistinct({ userId: ledgerEntries.userId })
        .from(ledgerEntries)
        .where(and(eq(ledgerEntries.teamId, teamId), eq(ledgerEntries.accountType, "staff"), inArray(ledgerEntries.userId, missing)));
      if (past.length !== missing.length) throw new LedgerError("That person isn't on this team's staff");
    }
  }
}

// Current balances of the cash and fund accounts these lines touch
async function heldBalances(tx: Reader, teamId: number, lines: Line[]) {
  const out = new Map<string, Cents>();
  if (lines.some((l) => l.account.type === "cash")) {
    const [row] = await tx
      .select({ total: sql<number>`coalesce(sum(${ledgerEntries.cents}), 0)` })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.teamId, teamId), eq(ledgerEntries.accountType, "cash")));
    out.set(accountKey({ type: "cash", id: null }), Number(row?.total ?? 0));
  }
  const fundIds = ids(lines, "fund");
  if (fundIds.length) {
    const rows = await tx
      .select({ fundId: ledgerEntries.fundId, total: sql<number>`coalesce(sum(${ledgerEntries.cents}), 0)` })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.teamId, teamId), eq(ledgerEntries.accountType, "fund"), inArray(ledgerEntries.fundId, fundIds)))
      .groupBy(ledgerEntries.fundId);
    for (const r of rows) out.set(accountKey({ type: "fund", id: r.fundId }), Number(r.total));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Posting

export type PostInput = {
  teamId: number;
  kind: TxnKind;
  lines: Line[];
  createdBy: number;
  clientKey: string; // From the form, so submitting it twice posts once
  itemId?: number | null;
  fundId?: number | null;
  memo?: string | null;
  method?: PaymentMethod | null;
  payerUserId?: number | null;
  payerName?: string | null;
  occurredOn?: string | null;
  reversesId?: number;
  claimId?: number; // Confirms this "I sent it" in the same transaction
};

export async function postTxn(input: PostInput): Promise<{ txnId: number; duplicate: boolean }> {
  assertBalanced(input.lines);
  const clientKey = input.clientKey.trim();
  if (!clientKey || clientKey.length > 100) throw new LedgerError("Reload the page and try again");
  const occurredOn = input.occurredOn && /^\d{4}-\d{2}-\d{2}$/.test(input.occurredOn) ? input.occurredOn : todayISO();

  const existing = async () => {
    const [row] = await db
      .select({ id: ledgerTxns.id })
      .from(ledgerTxns)
      .where(and(eq(ledgerTxns.teamId, input.teamId), eq(ledgerTxns.clientKey, clientKey)))
      .limit(1);
    return row ?? null;
  };

  try {
    return await db.transaction(async (tx) => {
      const [dupe] = await tx
        .select({ id: ledgerTxns.id })
        .from(ledgerTxns)
        .where(and(eq(ledgerTxns.teamId, input.teamId), eq(ledgerTxns.clientKey, clientKey)))
        .limit(1);
      if (dupe) return { txnId: dupe.id, duplicate: true };

      await checkAccounts(tx, input.teamId, input.lines);

      // A reversal always goes through, so a mistake can be undone even after the money was spent
      if (input.kind !== "reversal") {
        const bad = overdrawn(await heldBalances(tx, input.teamId, input.lines), input.lines);
        if (bad.some((a) => a.type === "cash")) {
          throw new LedgerError("The team doesn't hold that much. If someone paid it themselves, record it as fronted by them.");
        }
        if (bad.length) throw new LedgerError("That fund doesn't have that much in it.");
      }

      if (input.claimId) {
        const claimed = await tx
          .update(ledgerClaims)
          .set({ status: "confirmed", resolvedBy: input.createdBy, resolvedAt: new Date().toISOString() })
          .where(and(eq(ledgerClaims.id, input.claimId), eq(ledgerClaims.teamId, input.teamId), eq(ledgerClaims.status, "pending")))
          .returning({ id: ledgerClaims.id });
        if (claimed.length === 0) throw new LedgerError("Someone already handled that payment");
      }

      const [txn] = await tx
        .insert(ledgerTxns)
        .values({
          teamId: input.teamId,
          kind: input.kind,
          itemId: input.itemId ?? null,
          fundId: input.fundId ?? null,
          memo: input.memo?.trim() || null,
          method: input.method ?? null,
          payerUserId: input.payerUserId ?? null,
          payerName: input.payerName?.trim() || null,
          occurredOn,
          reversesId: input.reversesId ?? null,
          clientKey,
          createdBy: input.createdBy,
        })
        .returning({ id: ledgerTxns.id });

      await tx.insert(ledgerEntries).values(input.lines.map((l) => entryRow(txn.id, input.teamId, l)));
      if (input.claimId) await tx.update(ledgerClaims).set({ txnId: txn.id }).where(eq(ledgerClaims.id, input.claimId));
      return { txnId: txn.id, duplicate: false };
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Two submits raced past the check: the unique index kept one
    if (message.includes("ledger_txns.client_key") || message.includes("ledger_txns.team_id, ledger_txns.client_key")) {
      const row = await existing();
      if (row) return { txnId: row.id, duplicate: true };
    }
    if (message.includes("ledger_txns.reverses_id")) throw new LedgerError("That was already undone");
    throw e;
  }
}

// Undoes a transaction exactly. A reversal itself can't be undone: post it again instead.
export async function reverseTxn(teamId: number, txnId: number, by: number, clientKey: string) {
  const [txn] = await db.select().from(ledgerTxns).where(and(eq(ledgerTxns.id, txnId), eq(ledgerTxns.teamId, teamId))).limit(1);
  if (!txn) throw new LedgerError("That transaction isn't on this team");
  if (txn.kind === "reversal") throw new LedgerError("An undo can't be undone. Record it again instead.");
  const [already] = await db.select({ id: ledgerTxns.id }).from(ledgerTxns).where(eq(ledgerTxns.reversesId, txnId)).limit(1);
  if (already) throw new LedgerError("That was already undone");
  const rows = await db.select().from(ledgerEntries).where(eq(ledgerEntries.txnId, txnId));
  const lines = rows.map((r) => ({ account: entryAccount(r), cents: r.cents }));
  return postTxn({
    teamId,
    kind: "reversal",
    lines: reversalLines(lines),
    createdBy: by,
    clientKey,
    itemId: txn.itemId,
    fundId: txn.fundId,
    reversesId: txn.id,
  });
}

// ---------------------------------------------------------------------------
// Setup

export async function ensureDefaultFund(teamId: number) {
  const funds = await db.select().from(ledgerFunds).where(eq(ledgerFunds.teamId, teamId)).orderBy(asc(ledgerFunds.id));
  if (funds.length) return funds;
  await db.insert(ledgerFunds).values({ teamId, name: "Team fund" });
  return db.select().from(ledgerFunds).where(eq(ledgerFunds.teamId, teamId)).orderBy(asc(ledgerFunds.id));
}

export function cleanVenmoHandle(input: string) {
  const handle = input.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?venmo\.com\/(u\/)?/i, "").replace(/\/.*$/, "");
  if (!handle) return null;
  if (!/^[A-Za-z0-9_-]{2,40}$/.test(handle)) throw new LedgerError("That doesn't look like a Venmo username");
  return handle;
}

// A short code for the Venmo note, so staff can match a payment to a family
// without kids' names in a feed that may be public. Same family, same team,
// same code, and nothing to store.
export function familyRefCode(teamId: number, userId: number) {
  const secret = process.env.SESSION_SECRET || "dev-secret-change-in-production";
  const digest = crypto.createHmac("sha256", secret).update(`ledger-ref:${teamId}:${userId}`).digest();
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(digest.subarray(0, 5), (b) => alphabet[b % alphabet.length]).join("");
}

// ---------------------------------------------------------------------------
// The whole team's book, for staff pages. A team's season is small (hundreds
// of transactions), so everything is worked out in memory from one read.

export type BookTxn = LedgerTxn & { lines: Line[]; reversed: boolean };

export async function loadBook(teamId: number) {
  const txns = await db.select().from(ledgerTxns).where(eq(ledgerTxns.teamId, teamId)).orderBy(asc(ledgerTxns.id));
  const rows = await db.select().from(ledgerEntries).where(eq(ledgerEntries.teamId, teamId)).orderBy(asc(ledgerEntries.id));
  const byTxn = new Map<number, Line[]>();
  for (const r of rows) {
    const list = byTxn.get(r.txnId) ?? [];
    list.push({ account: entryAccount(r), cents: r.cents });
    byTxn.set(r.txnId, list);
  }
  const reversed = new Set(txns.map((t) => t.reversesId).filter((id): id is number => id !== null));
  const book: BookTxn[] = txns.map((t) => ({ ...t, lines: byTxn.get(t.id) ?? [], reversed: reversed.has(t.id) }));
  return book;
}

export function memberLinesFromBook(book: BookTxn[], m: Member): MemberLine[] {
  return book.flatMap((t) =>
    t.lines
      .filter((l) => l.account.type === m.type && l.account.id === m.id)
      .map((l) => ({ txnId: t.id, kind: t.kind, cents: l.cents, itemId: t.itemId, reversed: t.reversed }))
  );
}

export const memberKey = (m: Member) => `${m.type}:${m.id}`;

export async function getItems(teamId: number) {
  return db.select().from(ledgerItems).where(eq(ledgerItems.teamId, teamId)).orderBy(asc(ledgerItems.dueDate), asc(ledgerItems.id));
}

export async function getItem(teamId: number, itemId: number) {
  const [item] = await db.select().from(ledgerItems).where(and(eq(ledgerItems.id, itemId), eq(ledgerItems.teamId, teamId))).limit(1);
  return item ?? null;
}

export type MemberSummary = {
  member: Member;
  name: string;
  detail: string | null; // "Staff" or jersey number
  statement: Statement;
  onTeam: boolean;
};

export type ItemSummary = {
  item: LedgerItem;
  charged: Cents;
  collected: Cents; // paid by members plus covered by funds
  stillOwed: Cents;
  credited: Cents;
  passedOn: Cents; // money sent to whoever it's for
  returned: Cents; // money they sent back
  notPassedOn: Cents; // charged, less credits, less passed on, plus returned: what the team still owes them
  people: number;
};

// Everyone with an account: every player on the team (their family), every
// current staff member, and anyone else the team has had money with
export async function getMembers(teamId: number, book: BookTxn[]): Promise<MemberSummary[]> {
  const roster = await db
    .select({ id: players.id, name: players.name, jerseyNumber: players.jerseyNumber })
    .from(players)
    .where(eq(players.teamId, teamId))
    .orderBy(asc(players.name));
  const staff = await getTeamStaff(teamId);
  const staffIds = new Set(staff.map((s) => s.userId));
  const pastStaffIds = [
    ...new Set(book.flatMap((t) => t.lines.filter((l) => l.account.type === "staff").map((l) => l.account.id!)).filter((id) => !staffIds.has(id))),
  ];
  const pastStaff = pastStaffIds.length
    ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, pastStaffIds))
    : [];

  const summary = (member: Member, name: string, detail: string | null, onTeam: boolean): MemberSummary => ({
    member,
    name,
    detail,
    onTeam,
    statement: statement(memberLinesFromBook(book, member)),
  });

  return [
    ...roster.map((p) => summary({ type: "player", id: p.id }, p.name, p.jerseyNumber !== null ? `#${p.jerseyNumber}` : null, true)),
    ...staff.map((s) => summary({ type: "staff", id: s.userId }, s.name || s.email.split("@")[0], "Staff", true)),
    ...pastStaff.map((u) => summary({ type: "staff", id: u.id }, u.name || u.email.split("@")[0], "Former staff", false)),
  ];
}

export function summarizeItems(book: BookTxn[], items: LedgerItem[], members: MemberSummary[]): ItemSummary[] {
  return items.map((item) => {
    let passedOn = 0;
    let returned = 0;
    for (const t of book) {
      if (t.itemId !== item.id || t.reversed || t.kind === "reversal") continue;
      for (const l of t.lines) {
        if (l.account.type !== "item" || l.account.id !== item.id) continue;
        if (t.kind === "expense") passedOn += l.cents;
        if (t.kind === "vendor_refund") returned -= l.cents;
      }
    }
    let charged = 0, covered = 0, credited = 0, paid = 0, stillOwed = 0, people = 0;
    for (const m of members) {
      const s = m.statement.items.find((i) => i.itemId === item.id);
      if (!s) continue;
      if (s.charged > 0) people++;
      charged += s.charged;
      covered += s.covered;
      credited += s.credited;
      paid += s.paid;
      stillOwed += s.remaining;
    }
    return {
      item,
      charged,
      collected: paid + Math.min(covered, charged),
      stillOwed,
      credited,
      passedOn,
      returned,
      notPassedOn: charged - credited - passedOn + returned,
      people,
    };
  });
}

export function fundBalances(book: BookTxn[]) {
  const all = balances(book.flatMap((t) => t.lines));
  return {
    cash: all.get(accountKey({ type: "cash", id: null })) ?? 0,
    fund: (fundId: number) => -(all.get(accountKey({ type: "fund", id: fundId })) ?? 0),
  };
}

export async function pendingClaims(teamId: number) {
  const rows = await db
    .select({ claim: ledgerClaims, userName: users.name, userEmail: users.email })
    .from(ledgerClaims)
    .innerJoin(users, eq(ledgerClaims.userId, users.id))
    .where(and(eq(ledgerClaims.teamId, teamId), eq(ledgerClaims.status, "pending")))
    .orderBy(asc(ledgerClaims.id));
  return rows.map((r) => ({ ...r.claim, playerIds: parsePlayerIds(r.claim.playerIds), from: r.userName || r.userEmail.split("@")[0] }));
}

export async function countPendingClaims(teamId: number) {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(ledgerClaims)
    .where(and(eq(ledgerClaims.teamId, teamId), eq(ledgerClaims.status, "pending")));
  return Number(row?.n ?? 0);
}

export function parsePlayerIds(json: string): number[] {
  try {
    const value = JSON.parse(json);
    return Array.isArray(value) ? value.filter((v): v is number => Number.isInteger(v)) : [];
  } catch {
    return [];
  }
}

// Parent accounts linked to a player, with their Venmo note codes
export async function guardianCodes(teamId: number, playerId: number) {
  const rows = await db
    .select({ userId: users.id, name: users.name, email: users.email })
    .from(guardians)
    .innerJoin(users, eq(guardians.userId, users.id))
    .where(and(eq(guardians.playerId, playerId), eq(guardians.teamId, teamId)));
  return rows.map((r) => ({ userId: r.userId, name: r.name || r.email.split("@")[0], code: familyRefCode(teamId, r.userId) }));
}

export async function hasLedgerHistory(playerId: number) {
  const [row] = await db.select({ id: ledgerEntries.id }).from(ledgerEntries).where(eq(ledgerEntries.playerId, playerId)).limit(1);
  return Boolean(row);
}

// ---------------------------------------------------------------------------
// The family side. Reads only the entry rows on the viewer's own kids'
// accounts (never the other side of a transaction, which can carry other
// families or a fund's total), the items those rows point at, and the
// balances of funds the team shows families.

export type FamilyHistoryRow = {
  txnId: number;
  playerId: number;
  kind: TxnKind;
  cents: Cents; // + adds to what they owe
  itemName: string | null;
  fundName: string | null;
  memo: string | null;
  method: PaymentMethod | null;
  paidByYou: boolean;
  occurredOn: string;
  reversed: boolean;
};

export type FamilyTeamMoney = {
  teamId: number;
  teamName: string;
  venmoHandle: string | null;
  refCode: string;
  kids: { playerId: number; name: string; statement: Statement }[];
  items: Pick<LedgerItem, "id" | "name" | "details" | "dueDate" | "refundable" | "category">[];
  history: FamilyHistoryRow[];
  funds: { id: number; name: string; balance: Cents }[];
  pending: Pick<LedgerClaim, "id" | "cents" | "method" | "createdAt">[];
  owed: Cents; // what to pay: the sum of what each kid owes (a sibling's credit isn't netted)
  dueBack: Cents;
};

export async function getFamilyMoney(userId: number, kids: { playerId: number; name: string; teamId: number; teamName: string }[]): Promise<FamilyTeamMoney[]> {
  if (kids.length === 0) return [];
  const playerIds = kids.map((k) => k.playerId);
  const rows = await db
    .select({
      txnId: ledgerTxns.id,
      teamId: ledgerEntries.teamId,
      playerId: ledgerEntries.playerId,
      cents: ledgerEntries.cents,
      kind: ledgerTxns.kind,
      itemId: ledgerTxns.itemId,
      fundId: ledgerTxns.fundId,
      memo: ledgerTxns.memo,
      method: ledgerTxns.method,
      payerUserId: ledgerTxns.payerUserId,
      occurredOn: ledgerTxns.occurredOn,
    })
    .from(ledgerEntries)
    .innerJoin(ledgerTxns, eq(ledgerEntries.txnId, ledgerTxns.id))
    .where(and(eq(ledgerEntries.accountType, "player"), inArray(ledgerEntries.playerId, playerIds)))
    .orderBy(asc(ledgerTxns.id));

  const txnIds = [...new Set(rows.map((r) => r.txnId))];
  const reversed = new Set(
    txnIds.length
      ? (await db.select({ id: ledgerTxns.reversesId }).from(ledgerTxns).where(inArray(ledgerTxns.reversesId, txnIds))).map((r) => r.id!)
      : []
  );
  const itemIds = [...new Set(rows.map((r) => r.itemId).filter((id): id is number => id !== null))];
  const items = itemIds.length ? await db.select().from(ledgerItems).where(inArray(ledgerItems.id, itemIds)) : [];
  const itemById = new Map(items.map((i) => [i.id, i]));

  const teamIds = [...new Set(kids.map((k) => k.teamId))];
  const teamRows = await db.select({ id: teams.id, venmoHandle: teams.venmoHandle }).from(teams).where(inArray(teams.id, teamIds));
  const visibleFunds = await db
    .select({ id: ledgerFunds.id, teamId: ledgerFunds.teamId, name: ledgerFunds.name })
    .from(ledgerFunds)
    .where(and(inArray(ledgerFunds.teamId, teamIds), eq(ledgerFunds.visibleToFamilies, true)))
    .orderBy(asc(ledgerFunds.id));
  const fundTotals = visibleFunds.length
    ? await db
        .select({ fundId: ledgerEntries.fundId, total: sql<number>`coalesce(sum(${ledgerEntries.cents}), 0)` })
        .from(ledgerEntries)
        .where(and(eq(ledgerEntries.accountType, "fund"), inArray(ledgerEntries.fundId, visibleFunds.map((f) => f.id))))
        .groupBy(ledgerEntries.fundId)
    : [];
  const fundTotal = new Map(fundTotals.map((f) => [f.fundId, -Number(f.total)]));
  // Names of all of the team's funds, so a cover from a hidden fund still says where it came from
  const allFunds = await db.select({ id: ledgerFunds.id, name: ledgerFunds.name, visible: ledgerFunds.visibleToFamilies }).from(ledgerFunds).where(inArray(ledgerFunds.teamId, teamIds));
  const fundName = new Map(allFunds.map((f) => [f.id, f.visible ? f.name : "the team"]));

  const pending = await db
    .select({ id: ledgerClaims.id, teamId: ledgerClaims.teamId, cents: ledgerClaims.cents, method: ledgerClaims.method, createdAt: ledgerClaims.createdAt })
    .from(ledgerClaims)
    .where(and(eq(ledgerClaims.userId, userId), inArray(ledgerClaims.teamId, teamIds), eq(ledgerClaims.status, "pending")))
    .orderBy(asc(ledgerClaims.id));

  return teamIds.map((teamId) => {
    const teamKids = kids.filter((k) => k.teamId === teamId);
    const teamRowsForTeam = rows.filter((r) => r.teamId === teamId);
    const teamItems = [...new Set(teamRowsForTeam.map((r) => r.itemId).filter((id): id is number => id !== null))]
      .map((id) => itemById.get(id)!)
      .filter(Boolean);
    const kidMoney = teamKids.map((k) => {
      const lines: MemberLine[] = teamRowsForTeam
        .filter((r) => r.playerId === k.playerId)
        .map((r) => ({ txnId: r.txnId, kind: r.kind, cents: r.cents, itemId: r.itemId, reversed: reversed.has(r.txnId) }));
      return { playerId: k.playerId, name: k.name, statement: statement(lines) };
    });
    const history: FamilyHistoryRow[] = teamRowsForTeam
      .map((r) => ({
        txnId: r.txnId,
        playerId: r.playerId!,
        kind: r.kind,
        cents: r.cents,
        itemName: r.itemId ? itemById.get(r.itemId)?.name ?? null : null,
        fundName: r.fundId ? fundName.get(r.fundId) ?? null : null,
        memo: r.memo,
        method: r.method,
        paidByYou: r.payerUserId === userId,
        occurredOn: r.occurredOn,
        reversed: reversed.has(r.txnId),
      }))
      .reverse();
    return {
      teamId,
      teamName: teamKids[0].teamName,
      venmoHandle: teamRows.find((t) => t.id === teamId)?.venmoHandle ?? null,
      refCode: familyRefCode(teamId, userId),
      kids: kidMoney,
      items: teamItems.map((i) => ({ id: i.id, name: i.name, details: i.details, dueDate: i.dueDate, refundable: i.refundable, category: i.category })),
      history,
      funds: visibleFunds.filter((f) => f.teamId === teamId).map((f) => ({ id: f.id, name: f.name, balance: fundTotal.get(f.id) ?? 0 })),
      pending: pending.filter((p) => p.teamId === teamId),
      owed: sumCents(kidMoney.map((k) => k.statement.owed)),
      dueBack: sumCents(kidMoney.map((k) => k.statement.dueBack)),
    };
  });
}

// A family says they sent money. Only for their own kids on that team.
export async function createClaim(input: {
  teamId: number;
  userId: number;
  playerIds: number[];
  cents: Cents;
  method: PaymentMethod;
  note: string | null;
  clientKey: string;
}) {
  if (!Number.isSafeInteger(input.cents) || input.cents <= 0) throw new LedgerError("Enter how much you sent");
  if (input.playerIds.length === 0) throw new LedgerError("Pick who it's for");
  const clientKey = input.clientKey.trim();
  if (!clientKey || clientKey.length > 100) throw new LedgerError("Reload the page and try again");
  const [dupe] = await db
    .select({ id: ledgerClaims.id })
    .from(ledgerClaims)
    .where(and(eq(ledgerClaims.teamId, input.teamId), eq(ledgerClaims.clientKey, clientKey)))
    .limit(1);
  if (dupe) return dupe.id;
  try {
    const [row] = await db
      .insert(ledgerClaims)
      .values({
        teamId: input.teamId,
        userId: input.userId,
        playerIds: JSON.stringify(input.playerIds),
        cents: input.cents,
        method: input.method,
        note: input.note?.trim().slice(0, 300) || null,
        clientKey,
      })
      .returning({ id: ledgerClaims.id });
    return row.id;
  } catch (e) {
    if (e instanceof Error && e.message.includes("ledger_claims")) {
      const [row] = await db.select({ id: ledgerClaims.id }).from(ledgerClaims).where(and(eq(ledgerClaims.teamId, input.teamId), eq(ledgerClaims.clientKey, clientKey))).limit(1);
      if (row) return row.id;
    }
    throw e;
  }
}

export async function withdrawClaim(userId: number, claimId: number) {
  await db
    .update(ledgerClaims)
    .set({ status: "dismissed", resolvedBy: userId, resolvedAt: new Date().toISOString() })
    .where(and(eq(ledgerClaims.id, claimId), eq(ledgerClaims.userId, userId), eq(ledgerClaims.status, "pending")));
}

// ---------------------------------------------------------------------------
// Common writes

export async function memberBalances(teamId: number): Promise<Map<string, Cents>> {
  const rows = await db
    .select({
      accountType: ledgerEntries.accountType,
      playerId: ledgerEntries.playerId,
      userId: ledgerEntries.userId,
      total: sql<number>`coalesce(sum(${ledgerEntries.cents}), 0)`,
    })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.teamId, teamId), inArray(ledgerEntries.accountType, ["player", "staff"])))
    .groupBy(ledgerEntries.accountType, ledgerEntries.playerId, ledgerEntries.userId);
  return new Map(rows.map((r) => [`${r.accountType}:${r.playerId ?? r.userId}`, Number(r.total)]));
}

// Money in from (or on behalf of) one or more members: pays what each owes,
// in proportion when it's short; anything over stays as credit on the first
// member unless the payer chose to donate it to a fund.
export async function recordPayment(
  input: Omit<PostInput, "kind" | "lines" | "fundId"> & { members: Member[]; cents: Cents; donateExtraTo?: number | null }
) {
  if (input.members.length === 0) throw new LedgerError("Pick who it's for");
  const owed = await memberBalances(input.teamId);
  const lines = paymentLines(
    input.cents,
    input.members.map((m) => ({ member: m, owedCents: owed.get(memberKey(m)) ?? 0 })),
    input.donateExtraTo ? { type: "fund", fundId: input.donateExtraTo } : { type: "credit" }
  );
  return postTxn({ ...input, kind: "payment", lines, fundId: input.donateExtraTo ?? null });
}

// ---------------------------------------------------------------------------
// Activity, as staff read it

export type ActivityRow = {
  id: number;
  kind: TxnKind;
  text: string;
  cents: Cents;
  occurredOn: string;
  by: string | null;
  memo: string | null;
  reversed: boolean;
  itemId: number | null;
};

export function describeBook(
  book: BookTxn[],
  names: { member: (m: Member) => string; item: (id: number) => string; fund: (id: number) => string; user: (id: number) => string | null }
): ActivityRow[] {
  const byId = new Map(book.map((t) => [t.id, t]));
  return book.map((t) => {
    const members = t.lines
      .filter((l) => l.account.type === "player" || l.account.type === "staff")
      .map((l) => names.member({ type: l.account.type as Member["type"], id: l.account.id! }));
    const who = members.length === 0 ? "" : members.length <= 2 ? members.join(" and ") : `${members.length} people`;
    const item = t.itemId ? names.item(t.itemId) : "team costs";
    const funds = t.lines.filter((l) => l.account.type === "fund");
    const fundIn = funds.find((l) => l.cents < 0);
    const fundOut = funds.find((l) => l.cents > 0);
    const staffLine = t.lines.find((l) => l.account.type === "staff");
    const from = t.payerName ? ` (from ${t.payerName})` : "";
    let text: string;
    switch (t.kind) {
      case "charge": text = `Charged ${who} for ${item}`; break;
      case "payment": text = `Payment for ${who}${from}${fundIn ? `, extra to ${names.fund(fundIn.account.id!)}` : ""}`; break;
      case "cover": text = `${fundOut ? names.fund(fundOut.account.id!) : "A fund"} covered ${item} for ${who}`; break;
      case "donation": text = `Added to ${fundIn ? names.fund(fundIn.account.id!) : "a fund"}${members.length ? ` from ${who}'s credit` : from}`; break;
      case "transfer": text = `Moved from ${fundOut ? names.fund(fundOut.account.id!) : "?"} to ${fundIn ? names.fund(fundIn.account.id!) : "?"}`; break;
      case "expense":
        text = `Paid for ${t.itemId ? item : fundOut ? `${names.fund(fundOut.account.id!)} spending` : "team costs"}${
          staffLine ? `, fronted by ${names.member({ type: "staff", id: staffLine.account.id! })}` : ""
        }`;
        break;
      case "reimburse": text = `Paid back ${who}`; break;
      case "credit": text = `Money back on ${item} for ${who}`; break;
      case "refund": text = `Paid back ${who}`; break;
      case "vendor_refund": text = `${item}: money returned to the team`; break;
      case "reversal": {
        const original = t.reversesId ? byId.get(t.reversesId) : undefined;
        text = `Undid #${t.reversesId}${original ? ` (${original.kind.replace("_", " ")})` : ""}`;
        break;
      }
      default: text = t.kind;
    }
    return {
      id: t.id,
      kind: t.kind,
      text,
      cents: sumCents(t.lines.filter((l) => l.cents > 0).map((l) => l.cents)),
      occurredOn: t.occurredOn,
      by: names.user(t.createdBy),
      memo: t.memo,
      reversed: t.reversed,
      itemId: t.itemId,
    };
  });
}

export async function userNames(ids: number[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map<number, string>();
  const rows = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, r.name || r.email.split("@")[0]]));
}

// Names for everything a team's activity can mention
export async function activityNames(teamId: number, book: BookTxn[], members: MemberSummary[], items: LedgerItem[]) {
  const funds = await db.select({ id: ledgerFunds.id, name: ledgerFunds.name }).from(ledgerFunds).where(eq(ledgerFunds.teamId, teamId));
  const users = await userNames(book.map((t) => t.createdBy));
  const memberName = new Map(members.map((m) => [memberKey(m.member), m.name]));
  const itemName = new Map(items.map((i) => [i.id, i.name]));
  const fundName = new Map(funds.map((f) => [f.id, f.name]));
  return {
    member: (m: Member) => memberName.get(memberKey(m)) ?? (m.type === "player" ? "a player" : "a staff member"),
    item: (id: number) => itemName.get(id) ?? "an item",
    fund: (id: number) => fundName.get(id) ?? "a fund",
    user: (id: number) => users.get(id) ?? null,
  };
}
