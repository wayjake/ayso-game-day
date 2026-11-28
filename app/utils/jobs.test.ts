import { test } from "node:test";
import assert from "node:assert/strict";
import { familyLabel, openSpots, readJobForm, timingPhrase } from "./jobs.ts";

const form = (values: Record<string, string>) => ({ get: (k: string) => values[k] ?? null });

test("family labels name the kids", () => {
  assert.equal(familyLabel(["Dev"]), "Dev's family");
  assert.equal(familyLabel(["Mia", "Leo"]), "Mia & Leo's family");
  assert.equal(familyLabel(["Ava", "Mia", "Leo"]), "Ava, Mia & Leo's family");
  assert.equal(familyLabel(["James"]), "James' family");
  assert.equal(familyLabel(["Mia", "Mia"]), "Mia's family");
  assert.equal(familyLabel([]), "A family");
});

test("timing reads as a phrase", () => {
  assert.equal(timingPhrase("before", "game"), "before the game");
  assert.equal(timingPhrase("after", "practice"), "after practice");
  assert.equal(timingPhrase(null, "game"), null);
});

test("open spots never go below zero", () => {
  assert.equal(openSpots({ spots: 2, holders: [1] }), 1);
  assert.equal(openSpots({ spots: 1, holders: [1, 2] }), 0);
});

test("the job form", () => {
  assert.deepEqual(readJobForm(form({ title: "  Snacks ", details: "Nut-free please", timing: "after", mode: "volunteer", spots: "1" })), {
    values: { title: "Snacks", details: "Nut-free please", timing: "after", mode: "volunteer", spots: 1 },
  });
  assert.deepEqual(readJobForm(form({ title: "Set up goals", timing: "sometime", mode: "assigned" })), {
    values: { title: "Set up goals", details: null, timing: null, mode: "assigned", spots: 1 },
  });
  assert.ok("error" in readJobForm(form({ title: "" })));
  assert.ok("error" in readJobForm(form({ title: "Goals", spots: "0" })));
  assert.ok("error" in readJobForm(form({ title: "Goals", spots: "1.5" })));
  assert.ok("error" in readJobForm(form({ title: "Goals", spots: "21" })));
});
