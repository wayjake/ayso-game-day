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
  type Line,
  type MemberLine,
  type TxnKind,
} from "./ledger.ts";
import { sumCents } from "./money.ts";

// Ids are UUIDv7 strings; these sort the same way their numbers do, like real ones by age
const uid = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;

const ava = { type: "player" as const, id: uid(1) };
const ben = { type: "player" as const, id: uid(2) };
const coach = { type: "staff" as const, id: uid(9) };
const key = (type: string, n: number | null = null) => `${type}:${n === null ? "" : uid(n)}`;

// A tiny in-memory ledger, posting the way the server does: check, then append
function book() {
  const txns: { id: string; kind: TxnKind; itemId: string | null; lines: Line[]; reverses?: string }[] = [];
  return {
    txns,
    // itemNo is the item's number (its id is uid(itemNo)); returns the new transaction's id
    post(kind: TxnKind, lines: Line[], itemNo: number | null = null, reverses?: string): string {
      return this.postFor(kind, lines, itemNo === null ? null : uid(itemNo), reverses);
    },
    postFor(kind: TxnKind, lines: Line[], itemId: string | null, reverses?: string): string {
      assertBalanced(lines);
      const before = balances(txns.flatMap((t) => t.lines));
      if (kind !== "reversal" && overdrawn(before, lines).length) throw new LedgerError("overdrawn");
      const id = uid(txns.length + 1);
      txns.push({ id, kind, itemId, lines, reverses });
      return id;
    },
    reverse(id: string) {
      const t = txns.find((x) => x.id === id)!;
      return this.postFor("reversal", reversalLines(t.lines), t.itemId, id);
    },
    balance(type: string, n: number | null = null) {
      return balances(txns.flatMap((t) => t.lines)).get(key(type, n)) ?? 0;
    },
    memberLines(m: { type: "player" | "staff"; id: string }): MemberLine[] {
      const reversed = new Set(txns.filter((t) => t.reverses).map((t) => t.reverses));
      return txns.flatMap((t) =>
        t.lines
          .filter((l) => l.account.type === m.type && l.account.id === m.id)
          .map((l) => ({ txnId: t.id, kind: t.kind, cents: l.cents, itemId: t.itemId, reversed: reversed.has(t.id) }))
      );
    },
  };
}

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
    { account: { type: "cash", id: uid(3) }, cents: 5 },
    { account: ava, cents: -5 },
  ]), LedgerError);
  assert.throws(() => assertBalanced([
    { account: { type: "player", id: null }, cents: 5 },
    { account: { type: "cash", id: null }, cents: -5 },
  ]), LedgerError);
});

test("every builder balances", () => {
  const all: Line[][] = [
    chargeLines(uid(10), [{ member: ava, cents: 8500 }, { member: coach, cents: 8500 }]),
    coverLines(uid(1), [{ member: ava, cents: 4250 }]),
    creditLines(uid(11), [{ member: ava, cents: 1000 }, { member: ben, cents: 999 }]),
    paymentLines(20000, [{ member: ava, owedCents: 8500 }, { member: ben, owedCents: 4000 }]),
    paymentLines(5000, [{ member: ava, owedCents: 8500 }, { member: ben, owedCents: 4000 }]),
    paymentLines(20000, [{ member: ava, owedCents: 8500 }], { type: "fund", fundId: uid(1) }),
    donationLines(uid(1), 2500, { type: "cash" }),
    donationLines(uid(1), 2500, { type: "member", member: ava }),
    transferLines(uid(1), uid(2), 700),
    expenseLines({ type: "item", itemId: uid(10) }, 17000, { type: "cash" }),
    expenseLines({ type: "fund", fundId: uid(1) }, 3000, { type: "staff", userId: uid(9) }),
    reimburseLines(uid(9), 3000),
    refundLines(ava, 1000),
    vendorRefundLines(uid(11), 30000),
  ];
  for (const lines of all) {
    assert.doesNotThrow(() => assertBalanced(lines));
    assert.doesNotThrow(() => assertBalanced(reversalLines(lines)));
  }
});

test("builders refuse zero, negative and fractional amounts", () => {
  assert.throws(() => chargeLines(uid(10), []), LedgerError);
  assert.throws(() => chargeLines(uid(10), [{ member: ava, cents: 0 }]), LedgerError);
  assert.throws(() => chargeLines(uid(10), [{ member: ava, cents: -100 }]), LedgerError);
  assert.throws(() => refundLines(ava, 10.5), LedgerError);
  assert.throws(() => transferLines(uid(1), uid(1), 100), LedgerError);
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
  const donated = balances(paymentLines(10000, [{ member: ava, owedCents: 8500 }], { type: "fund", fundId: uid(1) }));
  assert.equal(donated.get(accountKey(ava)), -8500);
  assert.equal(donated.get(key("fund", 1)), -1500);
});

test("a season: charges, payments, a cover, a refund, money passed on", () => {
  const b = book();
  // Ref fees $85 for both kids and the coach's own share
  b.post("charge", chargeLines(uid(10), [{ member: ava, cents: 8500 }, { member: ben, cents: 8500 }, { member: coach, cents: 8500 }]), 10);
  // Hotel $1,237.40 split across the two families' kids... and nobody else
  b.post("charge", chargeLines(uid(11), [{ member: ava, cents: 61870 }, { member: ben, cents: 61870 }]), 11);
  assert.equal(b.balance("item", 11), -123740);

  // Ava's family pays everything on Venmo
  b.post("payment", paymentLines(70370, [{ member: ava, owedCents: b.balance("player", 1) }]));
  assert.equal(b.balance("player", 1), 0);
  assert.equal(b.balance("cash"), 70370);

  // A sponsor gives $500 to the team fund, which covers Ben's ref fees
  b.post("donation", donationLines(uid(1), 50000, { type: "cash" }));
  b.post("cover", coverLines(uid(1), [{ member: ben, cents: 8500 }]), 10);
  assert.equal(b.balance("fund", 1), -41500);
  assert.equal(b.balance("player", 2), 61870);

  // The coach fronts the hotel deposit, the team pays them back
  b.post("expense", expenseLines({ type: "item", itemId: uid(11) }, 40000, { type: "staff", userId: uid(9) }), 11);
  assert.equal(b.balance("staff", 9), 8500 - 40000);
  b.post("reimburse", reimburseLines(uid(9), 31500)); // net of their own $85 share
  assert.equal(b.balance("staff", 9), 0);

  // Can't pay out more than the team holds
  assert.throws(() => b.post("expense", expenseLines({ type: "item", itemId: uid(10) }, 999999, { type: "cash" }), 10), LedgerError);
  // Can't cover more than the fund has
  assert.throws(() => b.post("cover", coverLines(uid(1), [{ member: ben, cents: 41501 }]), 11), LedgerError);

  // The hotel refunds $300; it's split by what each kid was charged
  b.post("vendor_refund", vendorRefundLines(uid(11), 30000), 11);
  b.post("credit", creditLines(uid(11), [{ member: ava, cents: 15000 }, { member: ben, cents: 15000 }]), 11);
  assert.equal(b.balance("player", 1), -15000); // due back to Ava's family
  b.post("refund", refundLines(ava, 15000));
  assert.equal(b.balance("player", 1), 0);

  // The books always balance: everything sums to zero
  const all = b.txns.flatMap((t) => t.lines);
  assert.equal(sumCents(all.map((l) => l.cents)), 0);
});

test("a reversal undoes a transaction on every account", () => {
  const b = book();
  b.post("charge", chargeLines(uid(10), [{ member: ava, cents: 8500 }]), 10);
  const pay = b.post("payment", paymentLines(8500, [{ member: ava, owedCents: 8500 }]));
  const snapshot = balances(b.txns.flatMap((t) => t.lines));
  b.reverse(pay);
  assert.equal(b.balance("player", 1), 8500);
  assert.equal(b.balance("cash"), 0);
  // Reversing the reversal puts it back
  b.reverse(b.txns[b.txns.length - 1].id);
  assert.deepEqual(balances(b.txns.flatMap((t) => t.lines)), snapshot);
});

test("statement: payments pay off the oldest charge first, and stay put when a newer charge comes", () => {
  const b = book();
  b.post("charge", chargeLines(uid(11), [{ member: ava, cents: 20000 }]), 11); // hotel, due Feb 1
  b.post("payment", paymentLines(20000, [{ member: ava, owedCents: 20000 }]));
  // Ref fees are due sooner, but the hotel payment is still the hotel's
  b.post("charge", chargeLines(uid(10), [{ member: ava, cents: 8500 }]), 10);
  b.post("charge", chargeLines(uid(12), [{ member: ava, cents: 5000 }]), 12);
  b.post("payment", paymentLines(10000, [{ member: ava, owedCents: 13500 }]));

  const s = statement(b.memberLines(ava));
  assert.deepEqual(s.items.map((i) => [i.itemId, i.paid, i.remaining]), [
    [uid(11), 20000, 0],
    [uid(10), 8500, 0],
    [uid(12), 1500, 3500],
  ]);
  assert.equal(s.balance, 3500);
  assert.equal(s.owed, 3500);
  assert.equal(s.dueBack, 0);
});

test("statement: a cover after the family already paid turns into credit", () => {
  const b = book();
  b.post("donation", donationLines(uid(1), 10000, { type: "cash" }));
  b.post("charge", chargeLines(uid(10), [{ member: ava, cents: 8500 }]), 10);
  b.post("payment", paymentLines(8500, [{ member: ava, owedCents: 8500 }]));
  b.post("cover", coverLines(uid(1), [{ member: ava, cents: 8500 }]), 10);

  const s = statement(b.memberLines(ava));
  assert.equal(s.items[0].covered, 8500);
  assert.equal(s.items[0].remaining, 0);
  assert.equal(s.balance, -8500);
  assert.equal(s.dueBack, 8500);
  assert.equal(s.unapplied, 8500);
});

test("statement: reversed transactions drop out, and the balance still matches the lines", () => {
  const b = book();
  b.post("charge", chargeLines(uid(10), [{ member: ava, cents: 8500 }]), 10);
  const wrong = b.post("charge", chargeLines(uid(11), [{ member: ava, cents: 99999 }]), 11);
  b.reverse(wrong);
  const s = statement(b.memberLines(ava));
  assert.deepEqual(s.items.map((i) => i.itemId), [uid(10)]);
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
    b.post("donation", donationLines(uid(1), 1_000_000, { type: "cash" }));
    for (let step = 0; step < 25; step++) {
      const itemId = 10 + rand(3);
      const owed = b.balance("player", 1);
      const r = rand(6);
      try {
        if (r === 0 || r === 1) b.post("charge", chargeLines(uid(itemId), [{ member: ava, cents: 1 + rand(20000) }]), itemId);
        else if (r === 2) b.post("payment", paymentLines(1 + rand(20000), [{ member: ava, owedCents: owed }]));
        else if (r === 3) b.post("cover", coverLines(uid(1), [{ member: ava, cents: 1 + rand(5000) }]), itemId);
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
    const s = statement(lines);
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
