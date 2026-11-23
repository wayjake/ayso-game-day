// Announcement limits and options shared by the server and the compose page
// (which can't import from announcements.server).

export type Ask = "none" | "ack" | "reply";
export const ASKS: Ask[] = ["none", "ack", "reply"];
export const MAX_SUBJECT = 150;
export const MAX_BODY = 5000;
