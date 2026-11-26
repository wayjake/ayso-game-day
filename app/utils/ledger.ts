// Team money ledger rules: pure, no database, no `~/` imports, so `npm test`
// runs them with plain Node. ledger.server.ts reads and writes the tables.
//
// Double entry. Every transaction is a set of lines that add up to exactly
// zero; nothing is ever edited or deleted, and a mistake is undone with a
// reversal. Balances are always summed from the lines.
//
// Sign: a positive line is a debit. What each account's balance means:
//   player  (one per player)       > 0 the family owes the team, < 0 the team owes them
//   staff   (one per staff member) > 0 they owe the team (their own share), < 0 the team owes them (fronted)
//   item    (one per expense)      < 0 billed to people and not yet paid out to whoever it's for
//   fund    (team fund, savings)   < 0 money in the fund
//   cash    (one per team)         > 0 money the team holds (Venmo, cash, checks)

import { allocate, isCents, sumCents, type Cents } from "./money.ts";

export const ACCOUNT_TYPES = ["player", "staff", "item", "fund", "cash"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
// `id` is the player, user, item or fund id; null for cash
export type Account = { type: AccountType; id: number | null };
export type Line = { account: Account; cents: Cents };

// Who can owe the team: a player (their family) or a staff member
export type Member = { type: "player" | "staff"; id: number };

export const TXN_KINDS = [
  "charge", // a member owes for a line item
  "payment", // money received from a member, or someone paying on their behalf
  "cover", // a fund pays a member's charge
  "donation", // money into a fund, from cash received or from a member's credit
  "transfer", // between funds
  "expense", // money passed on for an item or out of a fund, by the team or fronted by staff
  "reimburse", // the team pays back a staff member who fronted money
  "credit", // part of a refundable item comes back to members: they're owed it
  "refund", // the team pays a member back what they're owed
  "vendor_refund", // whoever an item was for sends money back to the team
  "reversal", // undoes another transaction exactly
  "adjust", // someone's share of an expense changed after it was first billed (joined, left, half to full)
  "settle", // an expense closed: shares re-split on what was really paid out
] as const;
export type TxnKind = (typeof TXN_KINDS)[number];

export const ITEM_CATEGORIES = ["ref_fees", "tournament", "lodging_travel", "uniform", "other"] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];
export const CATEGORY_LABELS: Record<ItemCategory, string> = {
  ref_fees: "Ref fees",
  tournament: "Tournament fees",
  lodging_travel: "Lodging & travel",
  uniform: "Uniforms & gear",
  other: "Other",
};

export const PAYMENT_METHODS = ["venmo", "cash", "check", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const METHOD_LABELS: Record<PaymentMethod, string> = { venmo: "Venmo", cash: "Cash", check: "Check", other: "Other" };

// How staff read each kind in activity and undo messages. "Charge" is kept for
// a card actually being charged, which the app doesn't do yet.
export const KIND_LABELS: Record<TxnKind, string> = {
  charge: "share",
  payment: "payment",
  cover: "covered by a fund",
  donation: "money in",
  transfer: "move between funds",
  expense: "paid out",
  reimburse: "paid back",
  credit: "refund owed",
  refund: "refund",
  vendor_refund: "refund received",
  reversal: "undo",
  adjust: "share change",
  settle: "settle-up",
};

export class LedgerError extends Error {}

export const accountKey = (a: Account) => `${a.type}:${a.id ?? ""}`;
const CASH: Account = { type: "cash", id: null };
const member = (m: Member): Account => ({ type: m.type, id: m.id });

// ---------------------------------------------------------------------------
// The one check every transaction passes before it's written

export function assertBalanced(lines: Line[]): void {
  if (lines.length < 2) throw new LedgerError("A transaction needs at least two lines");
  for (const l of lines) {
    if (!isCents(l.cents) || l.cents === 0) throw new LedgerError(`Each line must be a non-zero whole number of cents (got ${l.cents})`);
    if (!ACCOUNT_TYPES.includes(l.account.type)) throw new LedgerError(`Unknown account type ${l.account.type}`);
    if ((l.account.type === "cash") !== (l.account.id === null)) throw new LedgerError("Only the cash account has no id");
  }
  if (sumCents(lines.map((l) => l.cents)) !== 0) throw new LedgerError("Transaction lines don't add up to zero");
}

// Merges lines on the same account and drops ones that net to zero
function tidy(lines: Line[]): Line[] {
  const merged = new Map<string, Line>();
  for (const l of lines) {
    const key = accountKey(l.account);
    const prev = merged.get(key);
    merged.set(key, { account: l.account, cents: (prev?.cents ?? 0) + l.cents });
  }
  return [...merged.values()].filter((l) => l.cents !== 0);
}

function positive(cents: Cents, what: string) {
  if (!isCents(cents) || cents <= 0) throw new LedgerError(`${what} must be more than $0`);
}

function sharesTotal(shares: { cents: Cents }[]) {
  if (shares.length === 0) throw new LedgerError("Pick at least one person");
  shares.forEach((s) => positive(s.cents, "Each amount"));
  return sumCents(shares.map((s) => s.cents));
}

// ---------------------------------------------------------------------------
// Builders: one per kind of transaction. Each returns balanced lines.

export type Share = { member: Member; cents: Cents };

// Members owe for a line item
export function chargeLines(itemId: number, shares: Share[]): Line[] {
  const total = sharesTotal(shares);
  return tidy([...shares.map((s) => ({ account: member(s.member), cents: s.cents })), { account: { type: "item", id: itemId }, cents: -total }]);
}

// A fund pays members' charges for an item
export function coverLines(fundId: number, shares: Share[]): Line[] {
  const total = sharesTotal(shares);
  return tidy([{ account: { type: "fund", id: fundId }, cents: total }, ...shares.map((s) => ({ account: member(s.member), cents: -s.cents }))]);
}

// Part of a refundable item comes back: members are owed it
export function creditLines(itemId: number, shares: Share[]): Line[] {
  const total = sharesTotal(shares);
  return tidy([{ account: { type: "item", id: itemId }, cents: total }, ...shares.map((s) => ({ account: member(s.member), cents: -s.cents }))]);
}

// How a family's payment spreads over their kids (or one staff member).
// Pays everyone's balance in full when it can; short of that, splits it in
// proportion to what each owes, so no one kid is left with the whole gap.
// Anything over what's owed goes to `extraTo`: the first member's credit
// (the default: they decide later) or a fund (only when the payer chose to donate it).
export function splitPayment(cents: Cents, owed: { member: Member; owedCents: Cents }[]): { shares: Share[]; extra: Cents } {
  positive(cents, "The payment");
  if (owed.length === 0) throw new LedgerError("A payment has to be for someone");
  const due = owed.map((o) => Math.max(0, o.owedCents));
  const totalDue = sumCents(due);
  if (cents >= totalDue) {
    return { shares: owed.map((o, i) => ({ member: o.member, cents: due[i] })).filter((s) => s.cents > 0), extra: cents - totalDue };
  }
  const split = allocate(cents, due);
  return { shares: owed.map((o, i) => ({ member: o.member, cents: split[i] })).filter((s) => s.cents > 0), extra: 0 };
}

export function paymentLines(
  cents: Cents,
  owed: { member: Member; owedCents: Cents }[],
  extraTo: { type: "credit" } | { type: "fund"; fundId: number } = { type: "credit" }
): Line[] {
  const { shares, extra } = splitPayment(cents, owed);
  const lines: Line[] = [{ account: CASH, cents }, ...shares.map((s) => ({ account: member(s.member), cents: -s.cents }))];
  if (extra > 0) {
    lines.push(
      extraTo.type === "fund"
        ? { account: { type: "fund", id: extraTo.fundId }, cents: -extra }
        : { account: member(owed[0].member), cents: -extra }
    );
  }
  return tidy(lines);
}

// Money into a fund: received now (from: cash), or a member giving up credit they're owed
export function donationLines(fundId: number, cents: Cents, from: { type: "cash" } | { type: "member"; member: Member }): Line[] {
  positive(cents, "The amount");
  const source = from.type === "cash" ? CASH : member(from.member);
  return tidy([{ account: source, cents }, { account: { type: "fund", id: fundId }, cents: -cents }]);
}

export function transferLines(fromFundId: number, toFundId: number, cents: Cents): Line[] {
  positive(cents, "The amount");
  if (fromFundId === toFundId) throw new LedgerError("Pick two different funds");
  return [{ account: { type: "fund", id: fromFundId }, cents }, { account: { type: "fund", id: toFundId }, cents: -cents }];
}

// Money passed on for an item, or spent out of a fund. Paid from team cash,
// or fronted by a staff member, which the team then owes them.
export function expenseLines(
  target: { type: "item"; itemId: number } | { type: "fund"; fundId: number },
  cents: Cents,
  paidBy: { type: "cash" } | { type: "staff"; userId: number }
): Line[] {
  positive(cents, "The amount");
  const account: Account = target.type === "item" ? { type: "item", id: target.itemId } : { type: "fund", id: target.fundId };
  const from: Account = paidBy.type === "cash" ? CASH : { type: "staff", id: paidBy.userId };
  return [{ account, cents }, { account: from, cents: -cents }];
}

export function reimburseLines(userId: number, cents: Cents): Line[] {
  positive(cents, "The amount");
  return [{ account: { type: "staff", id: userId }, cents }, { account: CASH, cents: -cents }];
}

export function refundLines(m: Member, cents: Cents): Line[] {
  positive(cents, "The refund");
  return [{ account: member(m), cents }, { account: CASH, cents: -cents }];
}

export function vendorRefundLines(itemId: number, cents: Cents): Line[] {
  positive(cents, "The amount");
  return [{ account: CASH, cents }, { account: { type: "item", id: itemId }, cents: -cents }];
}

// ---------------------------------------------------------------------------
// Expenses and shares. Who shares an expense is a list that can change; what
// each person should be billed comes from it, and only the difference from what
// was already billed is ever posted (on the next invoice). Running it twice
// posts nothing the second time.
//
// Weights are whole numbers so splits stay exact: 2 is a full share, 1 a half.

export const FULL_SHARE = 2;
export type Rounding = "cent" | "dollar";
export type ExpenseSpec = {
  mode: "split" | "fixed";
  totalCents: Cents | null;
  rounding: Rounding;
  unitCents: Cents | null; // A full share's price, fixed when it was first invoiced
};
export type ShareSpec = { member: Member; weight: number; fixedCents: Cents | null };
export type MemberCents = { member: Member; cents: Cents };

const memberKeyOf = (m: Member) => `${m.type}:${m.id}`;

function round(raw: number, rounding: Rounding): Cents {
  // Up to the next whole dollar, or to the nearest cent. The 1e-9 keeps an
  // exact dollar (11600.0000001 from float division) from rounding up a dollar.
  return rounding === "dollar" ? Math.ceil(raw / 100 - 1e-9) * 100 : Math.round(raw);
}

// A full share's price: the total over the shares, rounded the expense's way
export function unitPrice(totalCents: Cents, totalWeight: number, rounding: Rounding): Cents {
  positive(totalCents, "The total");
  if (!Number.isInteger(totalWeight) || totalWeight <= 0) throw new LedgerError("Pick at least one person to share it");
  return round((totalCents * FULL_SHARE) / totalWeight, rounding);
}

export function shareAmount(unitCents: Cents, weight: number, rounding: Rounding): Cents {
  return round((unitCents * weight) / FULL_SHARE, rounding);
}

// What each person on an expense should be billed in all, right now
export function shareTargets(spec: ExpenseSpec, shares: ShareSpec[]): MemberCents[] {
  for (const s of shares) {
    if (!Number.isInteger(s.weight) || s.weight < 1 || s.weight > 20) throw new LedgerError("Each share must be a half, a full share or more");
  }
  if (spec.mode === "fixed") {
    return shares.map((s) => {
      if (s.fixedCents === null || !isCents(s.fixedCents) || s.fixedCents < 0) throw new LedgerError("Each person needs an amount");
      return { member: s.member, cents: s.fixedCents };
    });
  }
  if (shares.length === 0) return [];
  if (spec.totalCents === null) throw new LedgerError("A split expense needs a total");
  const unit = spec.unitCents ?? unitPrice(spec.totalCents, shares.reduce((a, s) => a + s.weight, 0), spec.rounding);
  return shares.map((s) => ({ member: s.member, cents: shareAmount(unit, s.weight, spec.rounding) }));
}

// Each person's target less what they've already been billed for this expense.
// Someone no longer sharing it has a target of zero.
export function shareChanges(targets: MemberCents[], billed: MemberCents[]): MemberCents[] {
  const out = new Map<string, MemberCents>();
  for (const b of billed) out.set(memberKeyOf(b.member), { member: b.member, cents: -b.cents });
  for (const t of targets) {
    const key = memberKeyOf(t.member);
    out.set(key, { member: t.member, cents: (out.get(key)?.cents ?? 0) + t.cents });
  }
  return [...out.values()].filter((c) => c.cents !== 0);
}

// Posts share changes: up adds to what someone owes, down takes it off
export function shareLines(itemId: number, changes: MemberCents[]): Line[] {
  const lines = tidy([
    ...changes.map((c) => ({ account: member(c.member), cents: c.cents })),
    { account: { type: "item", id: itemId } as Account, cents: -sumCents(changes.map((c) => c.cents)) },
  ]);
  if (lines.length < 2) throw new LedgerError("Nothing changed");
  return lines;
}

// ---------------------------------------------------------------------------
// Families and invoices

// Players who share a contact email or a parent account are one family, and
// get one invoice. Linked through any chain, so two brothers listed under mom's
// email and dad's both land together.
export function groupFamilies(playerIds: number[], links: { playerId: number; key: string }[]): number[][] {
  const parent = new Map<number, number>(playerIds.map((id) => [id, id]));
  const find = (id: number): number => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  const firstWithKey = new Map<string, number>();
  for (const { playerId, key } of links) {
    if (!parent.has(playerId)) continue;
    const other = firstWithKey.get(key);
    if (other === undefined) firstWithKey.set(key, playerId);
    else parent.set(find(playerId), find(other));
  }
  const groups = new Map<number, number[]>();
  for (const id of playerIds) groups.set(find(id), [...(groups.get(find(id)) ?? []), id]);
  return [...groups.values()].map((g) => g.sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);
}

// Money a family has paid in, applied to their invoices oldest first. An
// invoice that comes to less than zero (a fund covered a share, a refund) pays
// toward the others the same way.
export function invoiceStatuses(invoices: { id: number; totalCents: Cents }[], paidIn: Cents) {
  let pool = paidIn + sumCents(invoices.map((i) => Math.max(0, -i.totalCents)));
  return invoices.map((inv) => {
    const due = Math.max(0, inv.totalCents);
    const paid = Math.max(0, Math.min(due, pool));
    pool -= paid;
    return { id: inv.id, paid, remaining: due - paid };
  });
}

export function reversalLines(lines: Line[]): Line[] {
  return lines.map((l) => ({ account: l.account, cents: -l.cents }));
}

// ---------------------------------------------------------------------------
// Balances

export function balances(lines: Line[]): Map<string, Cents> {
  const out = new Map<string, Cents>();
  for (const l of lines) out.set(accountKey(l.account), (out.get(accountKey(l.account)) ?? 0) + l.cents);
  return out;
}

// Money the team holds: cash can't go below zero (spend more than you have and
// it's fronted by someone), and neither can a fund. Returns what would go
// negative, so the caller can refuse the transaction.
export function overdrawn(before: Map<string, Cents>, lines: Line[]): Account[] {
  const after = new Map(before);
  const touched = new Map<string, Account>();
  for (const l of lines) {
    const key = accountKey(l.account);
    after.set(key, (after.get(key) ?? 0) + l.cents);
    touched.set(key, l.account);
  }
  return [...touched.values()].filter((a) => {
    const b = after.get(accountKey(a)) ?? 0;
    if (a.type === "cash") return b < 0;
    if (a.type === "fund") return b > 0;
    return false;
  });
}

// ---------------------------------------------------------------------------
// One member's statement: what each line item comes to and how much of it is paid

// One line on a member's account, with what it was for
export type MemberLine = {
  txnId: number;
  kind: TxnKind;
  cents: Cents; // as on the member's account: + adds to what they owe
  itemId: number | null;
  reversed: boolean; // this transaction was reversed (it and its reversal are both left out)
};

export type ItemStatus = {
  itemId: number;
  charged: Cents;
  covered: Cents; // paid by a fund
  credited: Cents; // came back (refundable items)
  paid: Cents; // from the member's own payments, applied oldest due first
  remaining: Cents;
};

export type Statement = {
  items: ItemStatus[];
  balance: Cents; // > 0 owes, < 0 is owed
  owed: Cents; // max(balance, 0)
  dueBack: Cents; // max(-balance, 0)
  unapplied: Cents; // payments and credit not used up by any item
  otherOwed: Cents; // owed but not for any item (e.g. credit given away that wasn't there)
};

// Charges, covers and credits are tied to an item. Payments aren't: they pay
// off items in the order they were charged, oldest first, so what a family
// already paid for stays paid when a new charge comes along (even one due
// sooner). Covers or credits beyond what's left on an item (it was already
// paid) become credit on the account, the same as an overpayment. Balance
// always equals the sum of the lines.
export function statement(lines: MemberLine[]): Statement {
  const live = lines.filter((l) => !l.reversed && l.kind !== "reversal");
  const byItem = new Map<number, ItemStatus>();
  const status = (itemId: number) => {
    let s = byItem.get(itemId);
    if (!s) byItem.set(itemId, (s = { itemId, charged: 0, covered: 0, credited: 0, paid: 0, remaining: 0 }));
    return s;
  };

  let pool = 0; // credits not tied to an item, minus money paid back out
  for (const l of live) {
    if (l.itemId !== null && (l.kind === "charge" || l.kind === "adjust" || l.kind === "settle")) status(l.itemId).charged += l.cents;
    else if (l.itemId !== null && l.kind === "cover") status(l.itemId).covered -= l.cents;
    else if (l.itemId !== null && l.kind === "credit") status(l.itemId).credited -= l.cents;
    else pool -= l.cents; // payments, refunds paid out, donations of credit
  }

  // Covers and credits past what was charged spill into the pool
  for (const s of byItem.values()) {
    const net = s.charged - s.covered - s.credited;
    s.remaining = Math.max(0, net);
    if (net < 0) pool += -net;
  }

  // When each item was first charged to this member (or first touched at all)
  const firstSeen = new Map<number, number>();
  for (const l of live) {
    if (l.itemId === null) continue;
    const seen = firstSeen.get(l.itemId);
    if (seen === undefined || l.txnId < seen) firstSeen.set(l.itemId, l.txnId);
  }
  const order = [...byItem.values()].sort((a, b) => (firstSeen.get(a.itemId) ?? 0) - (firstSeen.get(b.itemId) ?? 0) || a.itemId - b.itemId);

  for (const s of order) {
    if (pool <= 0) break;
    const pay = Math.min(pool, s.remaining);
    s.paid += pay;
    s.remaining -= pay;
    pool -= pay;
  }

  const balance = sumCents(live.map((l) => l.cents));
  return {
    items: order,
    balance,
    owed: Math.max(0, balance),
    dueBack: Math.max(0, -balance),
    unapplied: Math.max(0, pool),
    otherOwed: Math.max(0, -pool),
  };
}

// How much more a fund can cover, or a refundable item credit, for one member:
// up to what they were charged for it, less what's already been covered or
// credited. Past what's already paid, it turns into credit they're owed.
export function maxReducible(s: ItemStatus | undefined): Cents {
  if (!s) return 0;
  return Math.max(0, s.charged - s.covered - s.credited);
}
