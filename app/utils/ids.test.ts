import { test } from "node:test";
import assert from "node:assert/strict";
import { compareIds, idTime, isId, isTeamCode, maxId, newId, newTeamCode, parseId, parseIds, TEAM_CODE_ALPHABET } from "./ids.ts";

const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("newId makes lowercase UUIDv7s carrying the time", () => {
  const now = Date.UTC(2026, 10, 26, 20, 8);
  const id = newId(now + 10_000);
  assert.match(id, V7);
  assert.equal(idTime(id), now + 10_000);
});

test("ids made in order sort in order as text, even within one millisecond", () => {
  const ids: string[] = [];
  const t = Date.now() + 60_000; // Ahead of anything made earlier in this process
  for (let i = 0; i < 5000; i++) ids.push(newId(t + Math.floor(i / 1000)));
  const sorted = [...ids].sort();
  assert.deepEqual(sorted, ids);
  assert.equal(new Set(ids).size, ids.length);
});

test("a clock that steps back still gives increasing ids", () => {
  const t = Date.now() + 120_000;
  const a = newId(t);
  const b = newId(t - 5000);
  assert.ok(b > a);
  assert.match(b, V7);
});

test("the counter rolling over borrows the next millisecond", () => {
  const t = Date.now() + 180_000;
  let prev = newId(t);
  for (let i = 0; i < 0x1100; i++) {
    const next = newId(t);
    assert.ok(next > prev);
    prev = next;
  }
  assert.ok(idTime(prev) > t);
});

test("parseId takes ids and nothing else", () => {
  const id = newId();
  assert.equal(parseId(id), id);
  assert.equal(parseId(` ${id.toUpperCase()} `), id);
  assert.equal(parseId("12"), null);
  assert.equal(parseId(""), null);
  assert.equal(parseId(null), null);
  assert.equal(parseId(12), null);
  assert.equal(parseId(`${id}x`), null);
  assert.ok(isId(id));
  assert.ok(!isId("12"));
});

test("parseIds drops non-ids and repeats", () => {
  const a = newId();
  const b = newId();
  assert.deepEqual(parseIds([a, "7", b, a, null]), [a, b]);
});

test("compareIds and maxId follow creation order", () => {
  const a = newId();
  const b = newId();
  assert.equal(compareIds(a, b), -1);
  assert.equal(compareIds(b, a), 1);
  assert.equal(compareIds(a, a), 0);
  assert.equal(maxId([a, null, b, undefined]), b);
  assert.equal(maxId([]), null);
});

test("team codes are 7 letters from the unambiguous alphabet", () => {
  for (let i = 0; i < 500; i++) {
    const code = newTeamCode();
    assert.equal(code.length, 7);
    assert.ok(isTeamCode(code), code);
    for (const ch of code) assert.ok(TEAM_CODE_ALPHABET.includes(ch));
  }
  for (const bad of ["abc", "abcdefgh", "abcdef0", "abcdefl", "ABCDEFG", 13]) assert.ok(!isTeamCode(bad), String(bad));
});
