// The quick reactions offered on a chat message. The server accepts only these.
export const REACTIONS = ["❤️", "👍", "😂", "😮", "🎉", "😢"] as const;
export type Reaction = (typeof REACTIONS)[number];

export function isReaction(value: unknown): value is Reaction {
  return typeof value === "string" && (REACTIONS as readonly string[]).includes(value);
}
