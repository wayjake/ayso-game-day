import { test } from "node:test";
import assert from "node:assert/strict";
import { allocate, formatCents, parseCents, percentOf, plainAmount, sumCents } from "./money.ts";

test("parseCents reads digits, never floats", () => {
  assert.equal(parseCents("1.005"), null); // three decimals isn't money
  assert.equal(parseCents("1.01"), 101);
  assert.equal(parseCents("12.5"), 1250);
  assert.equal(parseCents("12."), 1200);
  assert.equal(parseCents(".5"), 50);
  assert.equal(parseCents("0.07"), 7);
  assert.equal(parseCents("$1,234.56"), 123456);
  assert.equal(parseCents(" 85 "), 8500);
  assert.equal(parseCents("19.99"), 1999); // 19.99 * 100 is 1998.9999999999998 as a float
  assert.equal(parseCents("-5"), null);
  assert.equal(parseCents("abc"), null);
  assert.equal(parseCents(""), null);
  assert.equal(parseCents("."), null);
  assert.equal(parseCents("1e3"), null);
});

test("every two-decimal amount up to $100 round-trips exactly", () => {
  for (let c = 0; c <= 10000; c++) {
    assert.equal(parseCents(plainAmount(c)), c);
  }
});

test("plainAmount and formatCents", () => {
  assert.equal(plainAmount(10235), "102.35");
  assert.equal(plainAmount(5), "0.05");
  assert.equal(plainAmount(0), "0.00");
  assert.equal(plainAmount(-150), "-1.50");
  assert.equal(formatCents(10235), "$102.35");
  assert.equal(formatCents(123456789), "$1,234,567.89");
});

test("percentOf rounds the way the caller asks", () => {
  assert.equal(percentOf(10000, 5000, "down"), 5000);
  assert.equal(percentOf(1, 5000, "down"), 0);
  assert.equal(percentOf(1, 5000, "up"), 1);
  assert.equal(percentOf(1, 5000, "nearest"), 1); // half rounds up
  assert.equal(percentOf(8500, 300, "nearest"), 255);
  assert.equal(percentOf(3333, 300, "down"), 99); // 99.99
  assert.equal(percentOf(3333, 300, "up"), 100);
  assert.equal(percentOf(0, 9999, "up"), 0);
  assert.throws(() => percentOf(-1, 100, "up"));
  assert.throws(() => percentOf(100, 2.5, "up"));
});

test("allocate: $100 three ways is 33.34 + 33.33 + 33.33, never 99.99", () => {
  assert.deepEqual(allocate(10000, [1, 1, 1]), [3334, 3333, 3333]);
  assert.deepEqual(allocate(200, [1, 1, 1]), [67, 67, 66]);
  assert.deepEqual(allocate(1, [1, 1, 1]), [1, 0, 0]);
  assert.deepEqual(allocate(0, [1, 1]), [0, 0]);
});

test("allocate: by weight, leftover to the largest remainder", () => {
  // $1,237.40 hotel by nights: 2, 3, 3
  assert.deepEqual(allocate(123740, [2, 3, 3]), [30935, 46403, 46402]);
  // A $300 refund by what each paid
  const paid = [8500, 8500, 4250];
  const back = allocate(30000, paid);
  assert.equal(sumCents(back), 30000);
  assert.deepEqual(back, [12000, 12000, 6000]);
  // Zero weight gets nothing, even with leftovers to hand out
  assert.deepEqual(allocate(10, [0, 1, 1, 1]), [0, 4, 3, 3]);
});

test("allocate always adds up to the total and each share is within a cent of fair", () => {
  let seed: number = 7;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  for (let run = 0; run < 2000; run++) {
    const total = rand(500000);
    const weights = Array.from({ length: 1 + rand(20) }, () => rand(10000));
    if (!weights.some((w) => w > 0)) weights[0] = 1;
    const shares = allocate(total, weights);
    const sum = weights.reduce((a, b) => a + b, 0);
    assert.equal(sumCents(shares), total);
    shares.forEach((s, i) => {
      const fair = (total * weights[i]) / sum;
      assert.ok(s >= Math.floor(fair) && s <= Math.floor(fair) + 1, `share ${s} vs fair ${fair}`);
      assert.ok(Number.isSafeInteger(s));
    });
    assert.deepEqual(allocate(total, weights), shares); // same input, same split
  }
});

test("allocate refuses what it can't split exactly", () => {
  assert.throws(() => allocate(100, []));
  assert.throws(() => allocate(100, [0, 0]));
  assert.throws(() => allocate(-1, [1]));
  assert.throws(() => allocate(10.5, [1]));
  assert.throws(() => allocate(100, [1.5, 1]));
});

test("sumCents refuses floats", () => {
  assert.equal(sumCents([1, 2, 3]), 6);
  assert.throws(() => sumCents([0.1, 0.2]));
});
