// Builds drizzle/0020_uuid_ids.sql from what drizzle-kit generated
// (0020_generated_by_drizzle.sql, kept beside this file).
//
// drizzle-kit rebuilds every table whose id columns changed from integer to
// text, but it copies the old values as they are: integer 12 would just become
// text "12". This rewrites each copy so every id becomes a UUIDv7 and every
// reference points at the new id of the row it pointed at before:
//
// 1. _id_map gets one row per old (table, id) with its new UUIDv7 (left in
//    place for verify.ts; 0021 drops it). The time in
//    each UUID comes from the row's created_at (or the nearest timestamp it
//    has), nudged so new ids sort in exactly the old id order: the app reads
//    "higher id" as "newer" (unread markers, the feed, oldest-first payments).
// 2. Each table's copy looks every id column up in _id_map, including the ones
//    with no foreign key: rsvps/ledger_item_events.event_id (a game or a
//    practice, by event_type), messages.parent_id/announcement_id/
//    inbound_email_id, ledger_txns.reverses_id, the read markers, the kids in
//    ledger_claims.player_ids (JSON) and ledger_invoices.family_key.
// 3. Teams get their short URL code, drawn in SQL.
//
// It all runs as one batch (drizzle's migrate sends it with foreign keys off,
// in one transaction), so a failure leaves the database as it was.
//
// Run: node scripts/id-migration/build-sql.ts

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const input = readFileSync(join(here, "0020_generated_by_drizzle.sql"), "utf8");
const outPath = join(here, "../../drizzle/0020_uuid_ids.sql");

type Table = { name: string; columns: string[]; fks: Map<string, string> };

const tables = new Map<string, Table>();
for (const m of input.matchAll(/CREATE TABLE `__new_([a-z_]+)` \(([\s\S]*?)\n\);/g)) {
  const [, name, body] = m;
  const columns = [...body.matchAll(/^\t`([a-z_]+)`/gm)].map((c) => c[1]);
  const fks = new Map<string, string>();
  for (const fk of body.matchAll(/FOREIGN KEY \(`([a-z_]+)`\) REFERENCES `([a-z_]+)`\(`id`\)/g)) fks.set(fk[1], fk[2]);
  tables.set(name, { name, columns, fks });
}

// The two tables of fixed seed data keep integer ids and aren't rebuilt.
const KEEP_INTEGER = new Set(["template_formations", "positions"]);
for (const t of KEEP_INTEGER) if (tables.has(t)) throw new Error(`${t} should not be rebuilt`);

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const lookup = (table: string, expr: string) => `(SELECT "new" FROM "_id_map" WHERE "tbl" = ${q(table)} AND "old" = ${expr})`;

// When each row was made, in ms, as SQL over the old table (aliased src).
function msOf(col: string) {
  return `CAST(unixepoch(${col}, 'subsec') * 1000 AS INTEGER)`;
}
const TIME: Record<string, string> = {
  conversation_read_marks: msOf(`src."read_at"`),
  conversation_reads: msOf(`src."updated_at"`),
  email_logs: msOf(`src."sent_at"`),
  inbox_messages: msOf(`src."received_at"`),
  ledger_invoices: msOf(`src."issued_at"`),
  ledger_entries: msOf(`(SELECT "created_at" FROM "ledger_txns" WHERE "id" = src."txn_id")`),
  ledger_invoice_lines: msOf(`(SELECT "issued_at" FROM "ledger_invoices" WHERE "id" = src."invoice_id")`),
  ledger_item_events: msOf(`(SELECT "created_at" FROM "ledger_items" WHERE "id" = src."item_id")`),
  post_media: msOf(`(SELECT "created_at" FROM "posts" WHERE "id" = src."post_id")`),
};

// Id columns without a foreign key, and how to map them.
const event = (col: string) =>
  `CASE src."event_type" WHEN 'game' THEN ${lookup("games", `src."${col}"`)} WHEN 'practice' THEN ${lookup("practices", `src."${col}"`)} END`;
// A read marker is "everything up to this message": map it to the newest
// message at or below it, so it compares the same way against every message.
const marker = (col: string) =>
  `(SELECT "new" FROM "_id_map" WHERE "tbl" = 'messages' AND "old" <= src."${col}" ORDER BY "old" DESC LIMIT 1)`;
const ZERO_ID = q("00000000-0000-7000-8000-000000000000"); // Sorts below every real id

const SPECIAL: Record<string, Record<string, string>> = {
  rsvps: { event_id: event("event_id") },
  ledger_item_events: { event_id: event("event_id") },
  messages: {
    parent_id: lookup("messages", `src."parent_id"`),
    announcement_id: lookup("announcements", `src."announcement_id"`),
    inbound_email_id: lookup("inbound_emails", `src."inbound_email_id"`),
  },
  ledger_txns: { reverses_id: lookup("ledger_txns", `src."reverses_id"`) },
  conversation_reads: { last_read_message_id: marker("last_read_message_id") },
  conversation_read_marks: { up_to_message_id: `coalesce(${marker("up_to_message_id")}, ${ZERO_ID})` },
  ledger_claims: {
    player_ids: `(SELECT json_group_array(m."new") FROM json_each(src."player_ids") j JOIN "_id_map" m ON m."tbl" = 'players' AND m."old" = j."value")`,
  },
  ledger_invoices: {
    // "players:3,7" or "staff:12", as the family was keyed when it was sent
    family_key: `CASE
      WHEN src."family_key" LIKE 'staff:%' THEN 'staff:' || ${lookup("users", `CAST(substr(src."family_key", 7) AS INTEGER)`)}
      WHEN src."family_key" LIKE 'players:%' THEN 'players:' || (SELECT group_concat("new", ',') FROM (SELECT m."new" FROM json_each('[' || substr(src."family_key", 9) || ']') j JOIN "_id_map" m ON m."tbl" = 'players' AND m."old" = j."value" ORDER BY m."new"))
      ELSE src."family_key" END`,
  },
};

// Seven random letters from the team code alphabet (utils/ids.ts)
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const teamCode = Array.from({ length: 7 }, () => `substr(${q(ALPHABET)}, 1 + (abs(random()) % 31), 1)`).join(" || ");

// Every id column of every rebuilt table must be handled, or the copy would
// keep an old integer in a text column.
function idColumns(t: Table) {
  return t.columns.filter((c) => c === "id" || t.fks.has(c) || SPECIAL[t.name]?.[c]);
}
const looksLikeId = /(^id$|_id$|_ids$|_by$|^family_key$)/;
for (const t of tables.values()) {
  for (const c of t.columns) {
    if (!looksLikeId.test(c) || idColumns(t).includes(c)) continue;
    // Known non-ids that happen to match the pattern
    const fine = new Set([
      "messages.resend_email_id", "messages.email_message_id", "announcement_recipients.resend_email_id",
      "announcement_recipients.email_message_id", "inbound_emails.resend_email_id", "inbound_emails.email_message_id",
      "email_logs.provider_message_id", "inbox_messages.provider_message_id", "inbox_messages.gmail_message_id",
      "inbox_threads.gmail_thread_id", "practices.series_id", "post_comments.client_id",
      "ledger_txns.client_key", "inbound_emails.matched_by", "share_links.share_id",
    ]);
    if (!fine.has(`${t.name}.${c}`)) throw new Error(`Unhandled id-like column ${t.name}.${c}`);
  }
  if (t.name === "games" && !t.fks.has("formation_id")) throw new Error("games.formation_id should keep its FK");
}

const parts: string[] = [];
parts.push(`CREATE TABLE "_id_map" ("tbl" text NOT NULL, "old" integer NOT NULL, "new" text NOT NULL, PRIMARY KEY ("tbl", "old"));`);

// Rows in old id order get strictly increasing ms, never earlier than their
// own timestamp: ms_i = max over j <= i of (ts_j - j) + i.
for (const t of tables.values()) {
  const ts = TIME[t.name] ?? msOf(`src."created_at"`);
  if (!TIME[t.name] && !t.columns.includes("created_at")) throw new Error(`No time column for ${t.name}`);
  parts.push(`INSERT INTO "_id_map" ("tbl", "old", "new")
SELECT ${q(t.name)}, "id",
  substr("h", 1, 8) || '-' || substr("h", 9, 4) || '-7' || substr(lower(hex(randomblob(2))), 1, 3) || '-' ||
  substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 1, 3) || '-' || lower(hex(randomblob(6)))
FROM (
  SELECT "id", printf('%012x', max("v") OVER (ORDER BY "id") + "rn") AS "h" FROM (
    SELECT src."id" AS "id", coalesce(${ts}, 0) - row_number() OVER (ORDER BY src."id") AS "v", row_number() OVER (ORDER BY src."id") AS "rn"
    FROM \`${t.name}\` src
  )
);`);
}

let out = input;
let rewritten = 0;
out = out.replace(/INSERT INTO `__new_([a-z_]+)`\(([^)]*)\) SELECT [^;]*? FROM `\1`;/g, (_all, name: string, colList: string) => {
  const t = tables.get(name)!;
  const cols = colList.split(", ").map((c) => c.replace(/"/g, ""));
  if (name === "teams" && !cols.includes("code")) cols.push("code");
  const exprs = cols.map((c) => {
    if (c === "id") return lookup(name, `src."id"`);
    if (name === "teams" && c === "code") return teamCode; // New column: drizzle copies it, but it isn't there yet
    const special = SPECIAL[name]?.[c];
    if (special) return special;
    const ref = t.fks.get(c);
    if (ref && !KEEP_INTEGER.has(ref)) return lookup(ref, `src."${c}"`);
    return `src."${c}"`;
  });
  rewritten++;
  return `INSERT INTO \`__new_${name}\`(${cols.map((c) => `"${c}"`).join(", ")}) SELECT ${exprs.join(", ")} FROM \`${name}\` src;`;
});
if (rewritten !== tables.size) throw new Error(`Rewrote ${rewritten} copies for ${tables.size} tables`);
if (!out.includes('"code"')) throw new Error("teams.code not filled");

// The map goes first (it reads the old tables) and is dropped at the end.
const [head, ...rest] = out.split("--> statement-breakpoint\n");
if (!head.startsWith("PRAGMA foreign_keys=OFF;")) throw new Error("Expected drizzle's PRAGMA first");
const header = `-- Generated by scripts/id-migration/build-sql.ts from 0020_generated_by_drizzle.sql; edit the script, not this file.\n`;
out = [header + head, ...parts, ...rest].join("--> statement-breakpoint\n");
// _id_map stays, so verify.ts can check the run against a copy taken before
// it; migration 0021 drops it once production checks out.
out = out.trimEnd();
writeFileSync(outPath, out + "\n");
console.log(`Wrote ${outPath}: ${tables.size} tables`);
