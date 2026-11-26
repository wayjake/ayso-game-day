import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FULL_SHARE,
  LedgerError,
  assertBalanced,
  balances,
  groupFamilies,
  invoiceStatuses,
  shareAmount,
  shareChanges,
  shareLines,
  shareTargets,
  settleTargets,
  statement,
  unitPrice,
  type ExpenseSpec,
  type MemberCents,
  type ShareSpec,
} from "./ledger.ts";
import { sumCents } from "./money.ts";
import { creditLines, expenseLines, vendorRefundLines } from "./ledger.ts";

// Ids are UUIDv7 strings; these sort the same way their numbers do, like real ones by age
const uid = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;

const player = (n: number) => ({ type: "player" as const, id: uid(n) });
const full = (id: number): ShareSpec => ({ member: player(id), weight: FULL_SHARE, fixedCents: null });
const half = (id: number): ShareSpec => ({ member: player(id), weight: 1, fixedCents: null });
const split = (totalCents: number, rounding: "cent" | "dollar" = "cent", unitCents: number | null = null): ExpenseSpec => ({
  mode: "split",
  totalCents,
  rounding,
  unitCents,
});
const amounts = (t: MemberCents[]) => t.map((x) => x.cents);

// The All-Stars, as worked out by hand on 2026-11-26
test("Palmdale: $1,100 over 9 full shares and a half, rounded up to the dollar", () => {
  const shares = [...Array.from({ length: 9 }, (_, i) => full(i + 1)), half(10)];
  const t = shareTargets(split(110000, "dollar"), shares);
  assert.deepEqual(amounts(t), [...Array(9).fill(11600), 5800]);
  assert.equal(sumCents(amounts(t)), 110200);
});

test("Beverly Hills: $1,000 over 13, rounded up to the dollar", () => {
  const t = shareTargets(split(100000, "dollar"), Array.from({ length: 13 }, (_, i) => full(i + 1)));
  assert.deepEqual(new Set(amounts(t)), new Set([7700]));
  assert.equal(sumCents(amounts(t)), 100100);
});

test("to the cent, shares land within a cent or two of the total", () => {
  for (const [total, n, halves] of [[110000, 9, 1], [100000, 13, 0], [100, 3, 0], [99999, 7, 2], [1, 1, 0]]) {
    const shares = [...Array.from({ length: n }, (_, i) => full(i + 1)), ...Array.from({ length: halves }, (_, i) => half(100 + i))];
    const sum = sumCents(amounts(shareTargets(split(total), shares)));
    assert.ok(Math.abs(sum - total) <= n + halves, `${total} over ${n}+${halves}: ${sum}`);
  }
  assert.equal(unitPrice(110000, 19, "cent"), 11579);
  assert.equal(shareAmount(11579, 1, "cent"), 5790);
  // An exact dollar amount isn't pushed up a dollar by float error
  assert.equal(unitPrice(60000, 12, "dollar"), 10000);
});

test("a late joiner pays the price fixed on the first invoice, and nobody else moves", () => {
  const spec = split(110000, "dollar");
  const first = [...Array.from({ length: 9 }, (_, i) => full(i + 1)), half(10)];
  const billed = shareTargets(spec, first);
  const locked = { ...spec, unitCents: unitPrice(110000, 19, "dollar") };
  // Billing again with the same people posts nothing
  assert.deepEqual(shareChanges(shareTargets(locked, first), billed), []);
  // Cole joins: only Cole is billed, at the same $116
  const changes = shareChanges(shareTargets(locked, [...first, full(11)]), billed);
  assert.deepEqual(changes, [{ member: player(11), cents: 11600 }]);
  // Holden goes from half to full: $58 more
  const upgraded = shareChanges(shareTargets(locked, [...first.slice(0, 9), full(10)]), billed);
  assert.deepEqual(upgraded, [{ member: player(10), cents: 5800 }]);
  // Someone leaves: their share comes off
  const left = shareChanges(shareTargets(locked, first.slice(1)), billed);
  assert.deepEqual(left, [{ member: player(1), cents: -11600 }]);
});

test("before the first invoice, a change re-prices everyone", () => {
  const spec = split(100000, "dollar");
  const twelve = shareTargets(spec, Array.from({ length: 12 }, (_, i) => full(i + 1)));
  const thirteen = shareTargets(spec, Array.from({ length: 13 }, (_, i) => full(i + 1)));
  assert.equal(twelve[0].cents, 8400);
  assert.equal(thirteen[0].cents, 7700);
});

test("fixed amounts: each person's own, like a merch order", () => {
  const spec: ExpenseSpec = { mode: "fixed", totalCents: null, rounding: "cent", unitCents: null };
  const t = shareTargets(spec, [
    { member: player(1), weight: 2, fixedCents: 16300 },
    { member: player(2), weight: 2, fixedCents: 8800 },
    { member: player(3), weight: 2, fixedCents: 0 },
  ]);
  assert.deepEqual(amounts(t), [16300, 8800, 0]);
  assert.deepEqual(shareChanges(t, []), [
    { member: player(1), cents: 16300 },
    { member: player(2), cents: 8800 },
  ]);
  assert.throws(() => shareTargets(spec, [{ member: player(1), weight: 2, fixedCents: null }]), LedgerError);
});

test("share lines balance, and the expense account holds what was billed", () => {
  const changes = [
    { member: player(1), cents: 11600 },
    { member: player(2), cents: 5800 },
  ];
  const lines = shareLines(uid(7), changes);
  assertBalanced(lines);
  assert.equal(balances(lines).get(`item:${uid(7)}`), -17400);
  // Mixed up and down that nets to zero still balances, with no item line
  const swap = shareLines(uid(7), [
    { member: player(1), cents: 500 },
    { member: player(2), cents: -500 },
  ]);
  assertBalanced(swap);
  assert.equal(swap.length, 2);
  assert.throws(() => shareLines(uid(7), []), LedgerError);
});

test("share changes count as billed in a statement", () => {
  const s = statement([
    { txnId: uid(1), kind: "charge", cents: 11600, itemId: uid(7), reversed: false },
    { txnId: uid(2), kind: "adjust", cents: 5800, itemId: uid(7), reversed: false },
    { txnId: uid(3), kind: "payment", cents: -10000, itemId: null, reversed: false },
  ]);
  assert.equal(s.items[0].charged, 17400);
  assert.equal(s.items[0].paid, 10000);
  assert.equal(s.owed, 7400);
});

test("families: shared emails or parent accounts join players, through any chain", () => {
  const groups = groupFamilies(
    [1, 2, 3, 4, 5, 6].map(uid),
    [
      { playerId: uid(1), key: "mom@x" },
      { playerId: uid(2), key: "mom@x" }, // 1 and 2 are brothers
      { playerId: uid(2), key: "dad@x" },
      { playerId: uid(3), key: "dad@x" }, // 3 shares dad with 2, so joins 1 and 2
      { playerId: uid(4), key: "solo@x" },
      { playerId: uid(4), key: "solo2@x" }, // one kid, two emails: still one family
      { playerId: uid(99), key: "mom@x" }, // not on the team: ignored
    ]
  );
  assert.deepEqual(groups, [[uid(1), uid(2), uid(3)], [uid(4)], [uid(5)], [uid(6)]]);
});

test("invoices are paid oldest first", () => {
  const s = invoiceStatuses(
    [
      { id: uid(1), totalCents: 19300 },
      { id: uid(2), totalCents: 4900 },
      { id: uid(3), totalCents: -2100 }, // a credit note
    ],
    20000
  );
  assert.deepEqual(s, [
    { id: uid(1), paid: 19300, remaining: 0 },
    { id: uid(2), paid: 2800, remaining: 2100 }, // $7 paid in plus the $21 credit note
    { id: uid(3), paid: 0, remaining: 0 },
  ]);
});

test("a credit invoice counts toward the ones still due", () => {
  // $116 share, then a fund covers $50 of it on the next invoice: $66 left, nothing paid in yet
  assert.deepEqual(
    invoiceStatuses(
      [
        { id: uid(1), totalCents: 11600 },
        { id: uid(2), totalCents: -5000 },
      ],
      0
    ),
    [
      { id: uid(1), paid: 5000, remaining: 6600 },
      { id: uid(2), paid: 0, remaining: 0 },
    ]
  );
});

test("settling Palmdale: $1,102 billed, $1,100 paid out, then $400 of deposit back", () => {
  const shares = [...Array.from({ length: 9 }, (_, i) => full(i + 1)), half(10)];
  const billed = shareTargets(split(110000, "dollar"), shares);
  const lines = [
    ...shareLines(uid(1), shareChanges(billed, [])),
    ...expenseLines({ type: "item", itemId: uid(1) }, 110000, { type: "cash" }),
    ...vendorRefundLines(uid(1), 40000),
  ];
  const cost = 110000 - 40000;
  const settle = shareChanges(settleTargets(cost, shares), billed);
  // A full share really cost $73.68 (the 4 odd cents go to the first four), Holden's half $36.84
  assert.equal(settle[0].cents, 7369 - 11600);
  assert.equal(settle[8].cents, 7368 - 11600);
  assert.equal(settle[9].cents, 3684 - 5800);
  lines.push(...shareLines(uid(1), settle));
  assert.equal(balances(lines).get(`item:${uid(1)}`) ?? 0, 0);
  assert.equal(sumCents(settleTargets(cost, shares).map((t) => t.cents)), cost);
});

test("settling counts refunds already given, and leaves the expense at zero", () => {
  const shares = [full(1), full(2), full(3)];
  const billed = shareTargets(split(30000), shares); // $100 each
  const lines = [
    ...shareLines(uid(1), shareChanges(billed, [])),
    ...expenseLines({ type: "item", itemId: uid(1) }, 30000, { type: "cash" }),
    ...vendorRefundLines(uid(1), 6000),
    // $10 each already given back by hand
    ...creditLines(uid(1), shares.map((s) => ({ member: s.member, cents: 1000 }))),
  ];
  // Billed less refunds given: what settling compares against
  const net = billed.map((b) => ({ member: b.member, cents: b.cents - 1000 }));
  const settle = shareChanges(settleTargets(24000, shares), net);
  assert.deepEqual(settle.map((c) => c.cents), [-1000, -1000, -1000]);
  lines.push(...shareLines(uid(1), settle));
  assert.equal(balances(lines).get(`item:${uid(1)}`) ?? 0, 0);
});

test("settling with nothing paid out, or nobody on it", () => {
  assert.deepEqual(amounts(settleTargets(0, [full(1), half(2)])), [0, 0]);
  assert.throws(() => settleTargets(100, []), LedgerError);
  assert.throws(() => settleTargets(-1, [full(1)]), LedgerError);
});

// Randomized: whatever order people join, leave or change share, billing the
// changes each time leaves everyone billed exactly their target, and the
// expense account always holds minus what's been billed.
test("random share edits always bill exactly the targets", () => {
  let seed = 7;
  const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
  for (let run = 0; run < 200; run++) {
    const spec = split(1000 + rand(500000), rand(2) ? "cent" : "dollar");
    let shares: ShareSpec[] = Array.from({ length: 1 + rand(12) }, (_, i) => ({ member: player(i + 1), weight: 1 + rand(2), fixedCents: null }));
    const billed = new Map<string, number>();
    const lines = [];
    let locked: ExpenseSpec = spec;
    for (let step = 0; step < 6; step++) {
      const targets = shareTargets(locked, shares);
      const changes = shareChanges(
        targets,
        [...billed].map(([id, cents]) => ({ member: { type: "player" as const, id }, cents }))
      );
      if (changes.length) {
        const l = shareLines(uid(1), changes);
        assertBalanced(l);
        lines.push(...l);
        for (const c of changes) billed.set(c.member.id, (billed.get(c.member.id) ?? 0) + c.cents);
      }
      if (locked.unitCents === null && shares.length) {
        locked = { ...spec, unitCents: unitPrice(spec.totalCents!, shares.reduce((a, s) => a + s.weight, 0), spec.rounding) };
      }
      for (const t of targets) assert.equal(billed.get(t.member.id) ?? 0, t.cents);
      // Someone joins, leaves, or changes share
      const r = rand(3);
      if (r === 0) shares = [...shares, { member: player(100 + step), weight: 1 + rand(2), fixedCents: null }];
      if (r === 1 && shares.length > 1) shares = shares.slice(1);
      if (r === 2) shares = shares.map((s, i) => (i === 0 ? { ...s, weight: s.weight === 1 ? 2 : 1 } : s));
    }
    const item = balances(lines).get(`item:${uid(1)}`) ?? 0;
    assert.equal(item, -sumCents([...billed.values()]));
  }
});
