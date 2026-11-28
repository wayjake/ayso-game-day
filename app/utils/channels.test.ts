import { test } from "node:test";
import assert from "node:assert/strict";
import { audienceSummary, channelPosting, cleanChannelName, cleanTopic, compareChannels, parseAudience, usesMembers } from "./channels.ts";

test("channel names are tidied and lose a leading #", () => {
  assert.equal(cleanChannelName("  #  Tournament   travel "), "Tournament travel");
  assert.equal(cleanChannelName("##snacks"), "snacks");
  assert.equal(cleanChannelName("   "), "");
  assert.equal(cleanChannelName("x".repeat(80)).length, 60);
});

test("an empty topic is null", () => {
  assert.equal(cleanTopic("   "), null);
  assert.equal(cleanTopic(" Rides  and hotel "), "Rides and hotel");
});

test("only the four audiences parse", () => {
  assert.equal(parseAudience("private"), "private");
  assert.equal(parseAudience("families"), "families");
  assert.equal(parseAudience("team"), null);
  assert.equal(parseAudience(null), null);
});

test("picked-people audiences use member rows", () => {
  assert.deepEqual(
    (["everyone", "staff", "families", "private"] as const).map(usesMembers),
    [false, false, true, true]
  );
});

test("the audience summary counts who's picked", () => {
  assert.equal(audienceSummary("everyone"), "Everyone on the team");
  assert.equal(audienceSummary("staff"), "Staff only");
  assert.equal(audienceSummary("families", { families: 1 }), "Staff and 1 family");
  assert.equal(audienceSummary("families", { families: 6 }), "Staff and 6 families");
  assert.equal(audienceSummary("private", { people: 3 }), "Private · 3 people");
});

test("only staff post: families still reply; archived: nobody writes", () => {
  const open = { archivedAt: null, staffOnlyPosts: false };
  const staffOnly = { archivedAt: null, staffOnlyPosts: true };
  const archived = { archivedAt: "2026-11-27 10:00:00", staffOnlyPosts: false };
  assert.deepEqual(channelPosting(open, "parent"), { canPost: true, canReply: true });
  assert.deepEqual(channelPosting(staffOnly, "parent"), { canPost: false, canReply: true });
  assert.deepEqual(channelPosting(staffOnly, "coach"), { canPost: true, canReply: true });
  assert.deepEqual(channelPosting(archived, "coach"), { canPost: false, canReply: false });
});

test("channels sort by name, ignoring case", () => {
  const sorted = [{ title: "snacks" }, { title: "Carpool" }, { title: "Tournament" }].sort(compareChannels).map((c) => c.title);
  assert.deepEqual(sorted, ["Carpool", "snacks", "Tournament"]);
});
