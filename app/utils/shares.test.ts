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
  statement,
  unitPrice,
  type ExpenseSpec,
  type MemberCents,
  type ShareSpec,
} from "./ledger.ts";
import { sumCents } from "./money.ts";

const player = (id: number) => ({ type: "player" as const, id });
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
  const lines = shareLines(7, changes);
  assertBalanced(lines);
  assert.equal(balances(lines).get("item:7"), -17400);
  // Mixed up and down that nets to zero still balances, with no item line
  const swap = shareLines(7, [
    { member: player(1), cents: 500 },
    { member: player(2), cents: -500 },
  ]);
  assertBalanced(swap);
  assert.equal(swap.length, 2);
  assert.throws(() => shareLines(7, []), LedgerError);
});

test("share changes count as billed in a statement", () => {
  const s = statement([
    { txnId: 1, kind: "charge", cents: 11600, itemId: 7, reversed: false },
    { txnId: 2, kind: "adjust", cents: 5800, itemId: 7, reversed: false },
    { txnId: 3, kind: "payment", cents: -10000, itemId: null, reversed: false },
  ]);
  assert.equal(s.items[0].charged, 17400);
  assert.equal(s.items[0].paid, 10000);
  assert.equal(s.owed, 7400);
});

test("families: shared emails or parent accounts join players, through any chain", () => {
  const groups = groupFamilies(
    [1, 2, 3, 4, 5, 6],
    [
      { playerId: 1, key: "mom@x" },
      { playerId: 2, key: "mom@x" }, // 1 and 2 are brothers
      { playerId: 2, key: "dad@x" },
      { playerId: 3, key: "dad@x" }, // 3 shares dad with 2, so joins 1 and 2
      { playerId: 4, key: "solo@x" },
      { playerId: 4, key: "solo2@x" }, // one kid, two emails: still one family
      { playerId: 99, key: "mom@x" }, // not on the team: ignored
    ]
  );
  assert.deepEqual(groups, [[1, 2, 3], [4], [5], [6]]);
});

test("invoices are paid oldest first", () => {
  const s = invoiceStatuses(
    [
      { id: 1, totalCents: 19300 },
      { id: 2, totalCents: 4900 },
      { id: 3, totalCents: -2100 }, // a credit note
    ],
    20000
  );
  assert.deepEqual(s, [
    { id: 1, paid: 19300, remaining: 0 },
    { id: 2, paid: 700, remaining: 4200 },
    { id: 3, paid: 0, remaining: 0 },
  ]);
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
    const billed = new Map<number, number>();
    const lines = [];
    let locked: ExpenseSpec = spec;
    for (let step = 0; step < 6; step++) {
      const targets = shareTargets(locked, shares);
      const changes = shareChanges(
        targets,
        [...billed].map(([id, cents]) => ({ member: player(id), cents }))
      );
      if (changes.length) {
        const l = shareLines(1, changes);
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
    const item = balances(lines).get("item:1") ?? 0;
    assert.equal(item, -sumCents([...billed.values()]));
  }
});
