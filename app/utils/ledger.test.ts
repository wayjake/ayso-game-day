import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LedgerError,
  accountKey,
  assertBalanced,
  balances,
  chargeLines,
  coverLines,
  creditLines,
  donationLines,
  expenseLines,
  overdrawn,
  paymentLines,
  refundLines,
  reimburseLines,
  reversalLines,
  splitPayment,
  statement,
  transferLines,
  vendorRefundLines,
  type ItemInfo,
  type Line,
  type MemberLine,
  type TxnKind,
} from "./ledger.ts";
import { sumCents } from "./money.ts";

const ava = { type: "player" as const, id: 1 };
const ben = { type: "player" as const, id: 2 };
const coach = { type: "staff" as const, id: 9 };
const key = (type: string, id: number | null = null) => `${type}:${id ?? ""}`;

// A tiny in-memory ledger, posting the way the server does: check, then append
function book() {
  const txns: { id: number; kind: TxnKind; itemId: number | null; lines: Line[]; reverses?: number }[] = [];
  return {
    txns,
    post(kind: TxnKind, lines: Line[], itemId: number | null = null, reverses?: number) {
      assertBalanced(lines);
      const before = balances(txns.flatMap((t) => t.lines));
      if (kind !== "reversal" && overdrawn(before, lines).length) throw new LedgerError("overdrawn");
      txns.push({ id: txns.length + 1, kind, itemId, lines, reverses });
      return txns.length;
    },
    reverse(id: number) {
      const t = txns.find((x) => x.id === id)!;
      return this.post("reversal", reversalLines(t.lines), t.itemId, id);
    },
    balance(type: string, id: number | null = null) {
      return balances(txns.flatMap((t) => t.lines)).get(key(type, id)) ?? 0;
    },
    memberLines(m: { type: "player" | "staff"; id: number }): MemberLine[] {
      const reversed = new Set(txns.filter((t) => t.reverses).map((t) => t.reverses));
      return txns.flatMap((t) =>
        t.lines
          .filter((l) => l.account.type === m.type && l.account.id === m.id)
          .map((l) => ({ txnId: t.id, kind: t.kind, cents: l.cents, itemId: t.itemId, reversed: reversed.has(t.id) }))
      );
    },
  };
}

const items: ItemInfo[] = [
  { id: 10, name: "Ref fees", dueDate: "2027-01-15", refundable: false },
  { id: 11, name: "Surf Cup hotel", dueDate: "2027-02-01", refundable: true },
  { id: 12, name: "Tournament entry", dueDate: null, refundable: false },
];

test("assertBalanced rejects anything that doesn't net to zero or isn't whole cents", () => {
  assert.throws(() => assertBalanced([{ account: { type: "cash", id: null }, cents: 100 }]), LedgerError);
  assert.throws(() => assertBalanced([
    { account: { type: "cash", id: null }, cents: 100 },
    { account: ava, cents: -99 },
  ]), LedgerError);
  assert.throws(() => assertBalanced([
    { account: { type: "cash", id: null }, cents: 0.1 },
    { account: ava, cents: -0.1 },
  ]), LedgerError);
  assert.throws(() => assertBalanced([
    { account: { type: "cash", id: null }, cents: 0 },
    { account: ava, cents: 0 },
  ]), LedgerError);
  assert.throws(() => assertBalanced([
    { account: { type: "cash", id: 3 }, cents: 5 },
    { account: ava, cents: -5 },
  ]), LedgerError);
  assert.throws(() => assertBalanced([
    { account: { type: "player", id: null }, cents: 5 },
    { account: { type: "cash", id: null }, cents: -5 },
  ]), LedgerError);
});

test("every builder balances", () => {
  const all: Line[][] = [
    chargeLines(10, [{ member: ava, cents: 8500 }, { member: coach, cents: 8500 }]),
    coverLines(1, [{ member: ava, cents: 4250 }]),
    creditLines(11, [{ member: ava, cents: 1000 }, { member: ben, cents: 999 }]),
    paymentLines(20000, [{ member: ava, owedCents: 8500 }, { member: ben, owedCents: 4000 }]),
    paymentLines(5000, [{ member: ava, owedCents: 8500 }, { member: ben, owedCents: 4000 }]),
    paymentLines(20000, [{ member: ava, owedCents: 8500 }], { type: "fund", fundId: 1 }),
    donationLines(1, 2500, { type: "cash" }),
    donationLines(1, 2500, { type: "member", member: ava }),
    transferLines(1, 2, 700),
    expenseLines({ type: "item", itemId: 10 }, 17000, { type: "cash" }),
    expenseLines({ type: "fund", fundId: 1 }, 3000, { type: "staff", userId: 9 }),
    reimburseLines(9, 3000),
    refundLines(ava, 1000),
    vendorRefundLines(11, 30000),
  ];
  for (const lines of all) {
    assert.doesNotThrow(() => assertBalanced(lines));
    assert.doesNotThrow(() => assertBalanced(reversalLines(lines)));
  }
});

test("builders refuse zero, negative and fractional amounts", () => {
  assert.throws(() => chargeLines(10, []), LedgerError);
  assert.throws(() => chargeLines(10, [{ member: ava, cents: 0 }]), LedgerError);
  assert.throws(() => chargeLines(10, [{ member: ava, cents: -100 }]), LedgerError);
  assert.throws(() => refundLines(ava, 10.5), LedgerError);
  assert.throws(() => transferLines(1, 1, 100), LedgerError);
  assert.throws(() => paymentLines(0, [{ member: ava, owedCents: 100 }]), LedgerError);
});

test("splitPayment: in full when it covers everyone, in proportion when it's short", () => {
  const owed = [{ member: ava, owedCents: 6000 }, { member: ben, owedCents: 4000 }];
  assert.deepEqual(splitPayment(10000, owed), { shares: [{ member: ava, cents: 6000 }, { member: ben, cents: 4000 }], extra: 0 });
  assert.deepEqual(splitPayment(5000, owed), { shares: [{ member: ava, cents: 3000 }, { member: ben, cents: 2000 }], extra: 0 });
  assert.deepEqual(splitPayment(12500, owed).extra, 2500);
  // A kid with credit isn't netted against a sibling's debt
  const mixed = splitPayment(5000, [{ member: ava, owedCents: -2000 }, { member: ben, owedCents: 5000 }]);
  assert.deepEqual(mixed, { shares: [{ member: ben, cents: 5000 }], extra: 0 });
  // Nothing owed: all of it is extra
  assert.deepEqual(splitPayment(5000, [{ member: ava, owedCents: 0 }]), { shares: [], extra: 5000 });
});

test("an overpayment stays as credit unless it's donated", () => {
  const credit = balances(paymentLines(10000, [{ member: ava, owedCents: 8500 }]));
  assert.equal(credit.get(accountKey(ava)), -10000);
  const donated = balances(paymentLines(10000, [{ member: ava, owedCents: 8500 }], { type: "fund", fundId: 1 }));
  assert.equal(donated.get(accountKey(ava)), -8500);
  assert.equal(donated.get(key("fund", 1)), -1500);
});

test("a season: charges, payments, a cover, a refund, money passed on", () => {
  const b = book();
  // Ref fees $85 for both kids and the coach's own share
  b.post("charge", chargeLines(10, [{ member: ava, cents: 8500 }, { member: ben, cents: 8500 }, { member: coach, cents: 8500 }]), 10);
  // Hotel $1,237.40 split across the two families' kids... and nobody else
  b.post("charge", chargeLines(11, [{ member: ava, cents: 61870 }, { member: ben, cents: 61870 }]), 11);
  assert.equal(b.balance("item", 11), -123740);

  // Ava's family pays everything on Venmo
  b.post("payment", paymentLines(70370, [{ member: ava, owedCents: b.balance("player", 1) }]));
  assert.equal(b.balance("player", 1), 0);
  assert.equal(b.balance("cash"), 70370);

  // A sponsor gives $500 to the team fund, which covers Ben's ref fees
  b.post("donation", donationLines(1, 50000, { type: "cash" }));
  b.post("cover", coverLines(1, [{ member: ben, cents: 8500 }]), 10);
  assert.equal(b.balance("fund", 1), -41500);
  assert.equal(b.balance("player", 2), 61870);

  // The coach fronts the hotel deposit, the team pays them back
  b.post("expense", expenseLines({ type: "item", itemId: 11 }, 40000, { type: "staff", userId: 9 }), 11);
  assert.equal(b.balance("staff", 9), 8500 - 40000);
  b.post("reimburse", reimburseLines(9, 31500)); // net of their own $85 share
  assert.equal(b.balance("staff", 9), 0);

  // Can't pay out more than the team holds
  assert.throws(() => b.post("expense", expenseLines({ type: "item", itemId: 10 }, 999999, { type: "cash" }), 10), LedgerError);
  // Can't cover more than the fund has
  assert.throws(() => b.post("cover", coverLines(1, [{ member: ben, cents: 41501 }]), 11), LedgerError);

  // The hotel refunds $300; it's split by what each kid was charged
  b.post("vendor_refund", vendorRefundLines(11, 30000), 11);
  b.post("credit", creditLines(11, [{ member: ava, cents: 15000 }, { member: ben, cents: 15000 }]), 11);
  assert.equal(b.balance("player", 1), -15000); // due back to Ava's family
  b.post("refund", refundLines(ava, 15000));
  assert.equal(b.balance("player", 1), 0);

  // The books always balance: everything sums to zero
  const all = b.txns.flatMap((t) => t.lines);
  assert.equal(sumCents(all.map((l) => l.cents)), 0);
});

test("a reversal undoes a transaction on every account", () => {
  const b = book();
  b.post("charge", chargeLines(10, [{ member: ava, cents: 8500 }]), 10);
  const pay = b.post("payment", paymentLines(8500, [{ member: ava, owedCents: 8500 }]));
  const snapshot = balances(b.txns.flatMap((t) => t.lines));
  b.reverse(pay);
  assert.equal(b.balance("player", 1), 8500);
  assert.equal(b.balance("cash"), 0);
  // Reversing the reversal puts it back
  b.reverse(b.txns.length);
  assert.deepEqual(balances(b.txns.flatMap((t) => t.lines)), snapshot);
});

test("statement: payments pay off items by due date; covers and credits stick to their item", () => {
  const b = book();
  b.post("charge", chargeLines(12, [{ member: ava, cents: 5000 }]), 12); // no due date: paid last
  b.post("charge", chargeLines(11, [{ member: ava, cents: 20000 }]), 11);
  b.post("charge", chargeLines(10, [{ member: ava, cents: 8500 }]), 10);
  b.post("payment", paymentLines(10000, [{ member: ava, owedCents: 33500 }]));

  const s = statement(b.memberLines(ava), items);
  assert.deepEqual(s.items.map((i) => [i.itemId, i.paid, i.remaining]), [
    [10, 8500, 0], // due first
    [11, 1500, 18500],
    [12, 0, 5000],
  ]);
  assert.equal(s.balance, 23500);
  assert.equal(s.owed, 23500);
  assert.equal(s.dueBack, 0);
});

test("statement: a cover after the family already paid turns into credit", () => {
  const b = book();
  b.post("donation", donationLines(1, 10000, { type: "cash" }));
  b.post("charge", chargeLines(10, [{ member: ava, cents: 8500 }]), 10);
  b.post("payment", paymentLines(8500, [{ member: ava, owedCents: 8500 }]));
  b.post("cover", coverLines(1, [{ member: ava, cents: 8500 }]), 10);

  const s = statement(b.memberLines(ava), items);
  assert.equal(s.items[0].covered, 8500);
  assert.equal(s.items[0].remaining, 0);
  assert.equal(s.balance, -8500);
  assert.equal(s.dueBack, 8500);
  assert.equal(s.unapplied, 8500);
});

test("statement: reversed transactions drop out, and the balance still matches the lines", () => {
  const b = book();
  b.post("charge", chargeLines(10, [{ member: ava, cents: 8500 }]), 10);
  const wrong = b.post("charge", chargeLines(11, [{ member: ava, cents: 99999 }]), 11);
  b.reverse(wrong);
  const s = statement(b.memberLines(ava), items);
  assert.deepEqual(s.items.map((i) => i.itemId), [10]);
  assert.equal(s.balance, 8500);
});

test("statement invariants hold over random seasons", () => {
  let seed: number = 42;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  for (let run = 0; run < 300; run++) {
    const b = book();
    b.post("donation", donationLines(1, 1_000_000, { type: "cash" }));
    for (let step = 0; step < 25; step++) {
      const itemId = 10 + rand(3);
      const owed = b.balance("player", 1);
      const r = rand(6);
      try {
        if (r === 0 || r === 1) b.post("charge", chargeLines(itemId, [{ member: ava, cents: 1 + rand(20000) }]), itemId);
        else if (r === 2) b.post("payment", paymentLines(1 + rand(20000), [{ member: ava, owedCents: owed }]));
        else if (r === 3) b.post("cover", coverLines(1, [{ member: ava, cents: 1 + rand(5000) }]), itemId);
        else if (r === 4 && owed < 0) b.post("refund", refundLines(ava, 1 + rand(-owed)));
        else if (r === 5 && b.txns.length > 1) {
          const t = b.txns[1 + rand(b.txns.length - 1)];
          const already = b.txns.some((x) => x.reverses === t.id);
          if (t.kind !== "reversal" && !already) b.reverse(t.id);
        }
      } catch (e) {
        if (!(e instanceof LedgerError)) throw e;
      }
    }
    const lines = b.memberLines(ava);
    const s = statement(lines, items);
    // Balance is exactly the sum of the member's lines
    assert.equal(s.balance, sumCents(lines.map((l) => l.cents)));
    // ...and exactly what's left on items, less unused credit, plus anything owed outside items
    assert.equal(s.balance, sumCents(s.items.map((i) => i.remaining)) - s.unapplied + s.otherOwed);
    for (const i of s.items) {
      assert.ok(i.paid >= 0 && i.remaining >= 0);
      // Per item: paid + remaining is what's left of the charge after covers and credits
      assert.equal(i.paid + i.remaining, Math.max(0, i.charged - i.covered - i.credited));
    }
    // The whole book still nets to zero
    assert.equal(sumCents(b.txns.flatMap((t) => t.lines).map((l) => l.cents)), 0);
  }
});
