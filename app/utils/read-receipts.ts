// Read receipts, worked out in the browser from one summary per conversation
// (read-receipts.server.ts): each reader's marker, and every time it moved.

export type ReadReceipts = {
  kind: "team" | "direct" | "group";
  participants: number; // People on the app in it, you included; under 2 means nobody else can read
  readers: {
    userId: number;
    name: string;
    upTo: number; // Has read every message up to this id
    marks: [upTo: number, at: string][]; // Each move of the marker, oldest first
  }[];
};

export type MessageReader = { userId: number; name: string; at: string | null };

// Who has read this message, earliest first. The sender never counts. `at` is
// null when they read it before read times were kept.
export function readersOf(receipts: ReadReceipts | null | undefined, messageId: number, senderId: number | null): MessageReader[] {
  if (!receipts || messageId <= 0) return [];
  return receipts.readers
    .filter((r) => r.upTo >= messageId && r.userId !== senderId)
    .map((r) => ({ userId: r.userId, name: r.name, at: r.marks.find(([upTo]) => upTo >= messageId)?.[1] ?? null }))
    .sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
}
