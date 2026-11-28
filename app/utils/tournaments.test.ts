import { test } from "node:test";
import assert from "node:assert/strict";
import { isDuring, readTournamentForm, tournamentDates } from "./tournaments.ts";

const form = (values: Record<string, string>) => ({ get: (k: string) => values[k] ?? null });

test("the tournament form", () => {
  assert.deepEqual(readTournamentForm(form({ name: " Turkey  Cup ", startDate: "2026-12-05", endDate: "2026-12-06", location: "Central Park", notes: "" })), {
    values: { name: "Turkey Cup", startDate: "2026-12-05", endDate: "2026-12-06", location: "Central Park", notes: null },
  });
  // One day when the last day is left out
  const one = readTournamentForm(form({ name: "Cup", startDate: "2026-12-05" }));
  assert.ok("values" in one && one.values.endDate === "2026-12-05");
  assert.ok("error" in readTournamentForm(form({ name: "", startDate: "2026-12-05" })));
  assert.ok("error" in readTournamentForm(form({ name: "Cup", startDate: "2026-12-05", endDate: "2026-12-04" })));
  assert.ok("error" in readTournamentForm(form({ name: "Cup", startDate: "2026-12-01", endDate: "2026-12-15" })));
  assert.ok("values" in readTournamentForm(form({ name: "Cup", startDate: "2026-12-01", endDate: "2026-12-14" })));
});

test("dates read as a range", () => {
  assert.equal(tournamentDates({ startDate: "2026-12-05", endDate: "2026-12-06" }), "Sat, Dec 5 – Sun, Dec 6");
  assert.equal(tournamentDates({ startDate: "2026-12-05", endDate: "2026-12-05" }), "Sat, Dec 5");
  assert.ok(isDuring({ startDate: "2026-12-05", endDate: "2026-12-06" }, "2026-12-06"));
  assert.ok(!isDuring({ startDate: "2026-12-05", endDate: "2026-12-06" }, "2026-12-07"));
});
