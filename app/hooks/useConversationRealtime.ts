import { useCallback, useEffect, useRef, useState } from "react";
import type { InboundMessage, PresenceMessage, PubSubClient, RealtimeChannel } from "@ably/pubsub-device";

// Live updates for one conversation over Ably (see utils/realtime.server.ts).
// The server only says "something changed"; the page reloads its data, so
// access checks and rendering stay in one place. Typing is shown through Ably
// presence: each person's presence data says whether they're typing and where
// (the main chat, or a thread by its root id).
//
// One connection per tab, opened on first use. The SDK is loaded only in the
// browser and only on pages that need it.

let clientPromise: Promise<PubSubClient> | null = null;
function getClient() {
  clientPromise ??= import("@ably/pubsub-device")
    .then(({ createClient }) => createClient({ authUrl: "/api/realtime/token", closeOnUnload: true }))
    .catch((error) => {
      clientPromise = null; // Try again next time (a stale chunk after a deploy, say)
      throw error;
    });
  return clientPromise;
}

export type RealtimeConfig = { channel: string; name: string } | null;
export type Typist = { clientId: string; name: string; where: string | null };
/** Where I'm typing: the main chat (null), a thread (its root id), or not at all (false) */
export type TypingWhere = string | null | false;

export function useConversationRealtime(config: RealtimeConfig, onChange: (event: { kind: string; threadId?: string | null }) => void) {
  const [connected, setConnected] = useState(false);
  const [typists, setTypists] = useState<Typist[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const channelName = config?.channel ?? null;
  const myName = config?.name ?? "";

  useEffect(() => {
    if (!channelName) return;
    let cancelled = false;
    let cleanup = () => {};

    getClient()
      .then(async (ably) => {
        if (cancelled) return;
        const channel = ably.channels.get(channelName);
        channelRef.current = channel;

        // Live only once this channel is attached, not just the connection: a
        // refused channel has to keep the page on its fast poll
        const onState = () => setConnected(ably.connection.state === "connected" && channel.state === "attached");
        const onMessage = (message: InboundMessage) => onChangeRef.current(message.data ?? {});
        const onPresence = async () => {
          const members: PresenceMessage[] = await channel.presence.get().catch(() => []);
          if (cancelled) return;
          setTypists(
            members
              .filter((m) => m.clientId !== ably.auth.clientId && m.data?.typing)
              .map((m) => ({ clientId: m.clientId!, name: String(m.data.name ?? "Someone"), where: m.data.where ?? null }))
          );
        };

        cleanup = () => {
          ably.connection.off(onState);
          channel.off(onState);
          channel.unsubscribe("changed", onMessage);
          channel.presence.unsubscribe(onPresence);
          channel.presence.leave().catch(() => {});
          channel.detach().catch(() => {});
        };

        ably.connection.on(onState);
        channel.on(onState);
        onState();
        const attach = async () => {
          await channel.subscribe("changed", onMessage);
          await channel.presence.subscribe(onPresence);
        };
        try {
          await attach();
        } catch {
          // The token lists the private threads that existed when it was issued.
          // One started since (a family's first message to a coach) isn't in it
          // yet: get a fresh token and try once more.
          if (cancelled) return;
          await ably.auth.authorize();
          if (cancelled) return;
          await attach();
        }
        if (cancelled) cleanup();
      })
      .catch((error) => console.warn("Realtime unavailable, polling instead:", (error as Error).message));

    return () => {
      cancelled = true;
      cleanup();
      channelRef.current = null;
      setTypists([]);
      setConnected(false);
    };
  }, [channelName]);

  const setTyping = useCallback(
    (where: TypingWhere) => {
      const channel = channelRef.current;
      if (!channel) return;
      channel.presence
        .update({ name: myName, typing: where !== false, where: where === false ? null : where })
        .catch(() => {});
    },
    [myName]
  );

  return { connected, typists, setTyping };
}

/** "Sam is typing…", "Sam and Ana are typing…", "3 people are typing…" */
export function typingLabel(typists: Typist[]) {
  const names = [...new Set(typists.map((t) => t.name.split(" ")[0]))];
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return `${names.length} people are typing…`;
}

/**
 * Calls `onEvent` for each "changed" event on any of these channels (no
 * presence). Used by the team feed. Does nothing when `channels` is empty.
 */
export function useRealtimeEvents(channels: string[], onEvent: (event: { kind?: string; postId?: string }) => void) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const key = channels.join("|");

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    let cleanup = () => {};

    getClient()
      .then(async (ably) => {
        if (cancelled) return;
        const subscribed = key.split("|").map((name) => ably.channels.get(name));
        const onMessage = (message: InboundMessage) => onEventRef.current(message.data ?? {});
        cleanup = () => {
          for (const channel of subscribed) {
            channel.unsubscribe("changed", onMessage);
            channel.detach().catch(() => {});
          }
        };
        await Promise.all(subscribed.map((channel) => channel.subscribe("changed", onMessage)));
        if (cancelled) cleanup();
      })
      .catch((error) => console.warn("Realtime unavailable, polling instead:", (error as Error).message));

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [key]);
}
