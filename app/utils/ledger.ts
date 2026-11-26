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
//   item    (one per line item)    < 0 charged and not yet passed on to whoever it's for
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

export type ItemInfo = { id: number; name: string; dueDate: string | null; refundable: boolean };

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
// off items in due-date order (no due date last, then oldest item), so a
// family sees which fees are done. Covers or credits beyond what's left on an
// item (it was already paid) become credit on the account, the same as an
// overpayment. Balance always equals the sum of the lines.
export function statement(lines: MemberLine[], items: ItemInfo[]): Statement {
  const live = lines.filter((l) => !l.reversed && l.kind !== "reversal");
  const byItem = new Map<number, ItemStatus>();
  const status = (itemId: number) => {
    let s = byItem.get(itemId);
    if (!s) byItem.set(itemId, (s = { itemId, charged: 0, covered: 0, credited: 0, paid: 0, remaining: 0 }));
    return s;
  };

  let pool = 0; // credits not tied to an item, minus money paid back out
  for (const l of live) {
    if (l.itemId !== null && l.kind === "charge") status(l.itemId).charged += l.cents;
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

  const info = new Map(items.map((i) => [i.id, i]));
  const order = [...byItem.values()].sort((a, b) => {
    const da = info.get(a.itemId)?.dueDate ?? "9999-99-99";
    const db = info.get(b.itemId)?.dueDate ?? "9999-99-99";
    return da < db ? -1 : da > db ? 1 : a.itemId - b.itemId;
  });

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
