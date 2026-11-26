// Ids for every row the app makes, and short codes for teams in URLs.
//
// Rows use UUIDv7: 48 bits of millisecond time, then random bits. They're
// unguessable like any UUID, but they also sort by creation time as plain
// text, which the app relies on: unread is "message ids above the read
// marker", the feed pages by post id, and lists order by id. Within one
// process, ids made in the same millisecond still go up (the 12 bits after
// the version count up from a random start, as RFC 9562 allows).
//
// Pure, with no imports, so the schema, the MCP server and node --test can
// all load it.

const HEX = "0123456789abcdef";

let lastMs = -1;
let counter = 0;

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function hex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += HEX[b >> 4] + HEX[b & 15];
  return out;
}

/** A new UUIDv7, lowercase, e.g. 0193f0c2-7b1e-7c4a-9f2e-3b8d1a6c5e40. */
export function newId(now: number = Date.now()): string {
  let ms = now;
  if (ms <= lastMs) {
    // Same millisecond (or the clock stepped back): count up instead, and
    // borrow the next millisecond when the counter runs out.
    ms = lastMs;
    counter++;
    if (counter > 0xfff) {
      ms++;
      counter = 0;
    }
  } else {
    // Start low in the counter's range so there's room to count up.
    counter = randomBytes(1)[0] & 0x7f;
  }
  lastMs = ms;
  const time = ms.toString(16).padStart(12, "0").slice(-12);
  const rand = randomBytes(8);
  rand[0] = (rand[0] & 0x3f) | 0x80; // RFC 9562 variant 10xx
  const tail = hex(rand);
  const a = counter.toString(16).padStart(3, "0");
  return `${time.slice(0, 8)}-${time.slice(8, 12)}-7${a}-${tail.slice(0, 4)}-${tail.slice(4, 16)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Whether a value looks like one of our ids (any UUID version, lowercase). */
export function isId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** A form or URL value as an id, or null when it isn't one. */
export function parseId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return UUID_RE.test(v) ? v : null;
}

/** Every value under one form key that is an id (others are dropped). */
export function parseIds(values: unknown[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    const id = parseId(v);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** The time a UUIDv7 was made, in ms since the epoch. */
export function idTime(id: string): number {
  return parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
}

// Team codes: 7 characters from an alphabet with no look-alikes (no 0/o,
// 1/l/i), so a code read aloud or off a screen is typed right. 31^7 is about
// 27 billion, and the unique index catches the rare clash.
export const TEAM_CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const TEAM_CODE_LENGTH = 7;
const TEAM_CODE_RE = new RegExp(`^[${TEAM_CODE_ALPHABET}]{${TEAM_CODE_LENGTH}}$`);

export function newTeamCode(): string {
  let out = "";
  while (out.length < TEAM_CODE_LENGTH) {
    for (const b of randomBytes(TEAM_CODE_LENGTH * 2)) {
      // 248 is the largest multiple of 31 under 256, so every letter is equally likely
      if (b < 248 && out.length < TEAM_CODE_LENGTH) out += TEAM_CODE_ALPHABET[b % 31];
    }
  }
  return out;
}

export function isTeamCode(value: unknown): value is string {
  return typeof value === "string" && TEAM_CODE_RE.test(value);
}

/** Sort comparator for ids: oldest first (UUIDv7 text order is time order). */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The newest of some ids, or null when there are none. */
export function maxId(ids: Iterable<string | null | undefined>): string | null {
  let max: string | null = null;
  for (const id of ids) if (id && (max === null || id > max)) max = id;
  return max;
}
