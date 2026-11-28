import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCalendar, foldLine, type IcalEvent } from "./ical.ts";

const now = new Date("2026-11-28T12:00:00Z");
const vevents = (events: IcalEvent[]) =>
  buildCalendar({ name: "Thunder", events, now })
    .split("\r\n")
    .join("\n")
    .split("BEGIN:VEVENT\n")
    .slice(1)
    .map((block) => block.split("\nEND:VEVENT")[0].split("\n"));

test("a timed game is busy", () => {
  const [lines] = vevents([{ uid: "game-1@benchtalk.app", summary: "Game vs Galaxy", date: "2026-12-05", start: "09:00", end: "10:00" }]);
  assert.ok(lines.includes("DTSTART;TZID=America/Los_Angeles:20261205T090000"));
  assert.ok(lines.includes("DTEND;TZID=America/Los_Angeles:20261205T100000"));
  assert.ok(lines.includes("TRANSP:OPAQUE"));
});

test("a tournament weekend is one free all-day event", () => {
  const [lines] = vevents([{ uid: "tournament-1@benchtalk.app", summary: "Tournament: Turkey Cup", date: "2026-12-05", endDate: "2026-12-06", start: null, end: null }]);
  assert.ok(lines.includes("DTSTART;VALUE=DATE:20261205"));
  assert.ok(lines.includes("DTEND;VALUE=DATE:20261207"), "DTEND is the day after the last day");
  assert.ok(lines.includes("TRANSP:TRANSPARENT"));
});

test("a one-day all-day event ends the next day, and an end before the start is ignored", () => {
  const [one, backwards] = vevents([
    { uid: "a", summary: "A", date: "2026-12-05", start: null, end: null },
    { uid: "b", summary: "B", date: "2026-12-05", endDate: "2026-12-01", start: null, end: null },
  ]);
  assert.ok(one.includes("DTEND;VALUE=DATE:20261206"));
  assert.ok(backwards.includes("DTEND;VALUE=DATE:20261206"));
});

test("busy can be set either way", () => {
  const [freeGame, busyDay] = vevents([
    { uid: "a", summary: "A", date: "2026-12-05", start: "09:00", end: "10:00", busy: false },
    { uid: "b", summary: "B", date: "2026-12-05", start: null, end: null, busy: true },
  ]);
  assert.ok(freeGame.includes("TRANSP:TRANSPARENT"));
  assert.ok(busyDay.includes("TRANSP:OPAQUE"));
});

test("long lines fold at 75 bytes", () => {
  const folded = foldLine(`SUMMARY:${"x".repeat(100)}`);
  for (const line of folded.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75);
});
