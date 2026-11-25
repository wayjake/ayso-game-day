import { createHttpClient, type PubSubHttpClient } from "@ably/pubsub-server";
import { and, eq, inArray, or } from "drizzle-orm";
import { db, conversations, guardians, teams } from "~/db";
import { canAccessTeam } from "~/utils/team-access.server";

// Realtime through Ably. Turso stays the source of truth: after a write, the
// server publishes a small "changed" event on the conversation's channel and
// open pages reload their data (the loader also does the access checks).
// Phones never get the API key: /api/realtime/token hands each person a
// short-lived token that can only subscribe (and show typing) on channels
// they're allowed to read. Without ABLY_API_KEY everything here is a no-op and
// pages fall back to polling.

// The account is billed per monthly active user, which needs Ably's split
// SDKs: @ably/pubsub-server here (exempt from MAU counting) and
// @ably/pubsub-device in the browser. The older `ably` package is refused.
let http: PubSubHttpClient | null = null;
function client() {
  if (!process.env.ABLY_API_KEY) return null;
  http ??= createHttpClient(process.env.ABLY_API_KEY);
  return http;
}

export function isRealtimeConfigured() {
  return Boolean(process.env.ABLY_API_KEY);
}

export function conversationChannel(teamId: number, conversationId: number) {
  return `team:${teamId}:conversation:${conversationId}`;
}

// New posts, likes, comments and deletes on a team's photo feed
export function feedChannel(teamId: number) {
  return `team:${teamId}:feed`;
}

export type FeedEvent = { kind: "post" | "deleted" | "stats"; postId?: number };

export async function publishFeed(teamId: number, event: FeedEvent) {
  const ably = client();
  if (!ably) return;
  try {
    await ably.channels.get(feedChannel(teamId)).publish("changed", event);
  } catch (error) {
    console.error("Realtime publish failed:", (error as Error).message);
  }
}

export type ConversationEvent = { kind: "message" | "reaction"; threadId?: number | null };

// Awaited by callers (serverless hosts may drop work left after the response).
// Never throws: a realtime hiccup only means pages catch up on their next poll.
export async function publishConversation(teamId: number, conversationId: number, event: ConversationEvent) {
  const ably = client();
  if (!ably) return;
  try {
    await ably.channels.get(conversationChannel(teamId, conversationId)).publish("changed", event);
  } catch (error) {
    console.error("Realtime publish failed:", (error as Error).message);
  }
}

// What this person may listen to: every conversation on teams they coach, and
// on teams where they're a parent, the team chat, their own thread and the
// team's photo feed. Coaches get the feed through team:<id>:*.
async function capabilityFor(userId: number) {
  const capability: Record<string, string[]> = {};
  const allow = ["subscribe", "presence"];

  const coached = await db.select({ id: teams.id }).from(teams).where(canAccessTeam(userId));
  for (const t of coached) capability[`team:${t.id}:*`] = allow;

  const coachedIds = new Set(coached.map((t) => t.id));
  const parentTeamIds = [
    ...new Set(
      (await db.selectDistinct({ teamId: guardians.teamId }).from(guardians).where(eq(guardians.userId, userId)))
        .map((g) => g.teamId)
        .filter((id) => !coachedIds.has(id))
    ),
  ];
  for (const teamId of parentTeamIds) capability[feedChannel(teamId)] = ["subscribe"];
  if (parentTeamIds.length > 0) {
    const visible = await db
      .select({ id: conversations.id, teamId: conversations.teamId })
      .from(conversations)
      .where(
        and(
          inArray(conversations.teamId, parentTeamIds),
          or(eq(conversations.kind, "team"), eq(conversations.parentUserId, userId))
        )
      );
    for (const c of visible) capability[conversationChannel(c.teamId, c.id)] = allow;
  }
  return capability;
}

export async function createTokenRequest(userId: number) {
  const ably = client();
  if (!ably) return null;
  const capability = await capabilityFor(userId);
  // Ably refuses an empty capability; give a channel nobody publishes on
  if (Object.keys(capability).length === 0) capability[`user:${userId}`] = ["subscribe"];
  return ably.auth.createTokenRequest({
    clientId: String(userId),
    capability: JSON.stringify(capability),
    ttl: 60 * 60 * 1000,
  });
}
