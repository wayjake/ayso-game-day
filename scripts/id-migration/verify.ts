// Checks a run of 0020_uuid_ids.sql: compares a copy taken before (old) with
// the migrated database (new), which must still have _id_map (run the SQL
// without its last statement). Read-only on both.
//
//   node scripts/id-migration/verify.ts old.db new.db
//
// Checks, for every rebuilt table:
// - same row count;
// - every id is a lowercase UUID (teams also get a valid code);
// - every reference column holds the new id of the row it pointed at before
//   (foreign keys, plus the id columns without one);
// - sorting by the new id gives the old id order;
// - PRAGMA foreign_key_check is clean.

// @ts-expect-error The installed @types/node (20) predates node:sqlite; run these with Node 22.5+.
import { DatabaseSync } from "node:sqlite";

const [oldPath, newPath] = process.argv.slice(2);
if (!oldPath || !newPath) throw new Error("usage: verify.ts old.db new.db");

const db = new DatabaseSync(newPath, { readOnly: true });
db.exec(`ATTACH DATABASE 'file:${oldPath}?mode=ro' AS o`);

const all = <T,>(sql: string) => db.prepare(sql).all() as T[];
const one = <T,>(sql: string) => db.prepare(sql).get() as T;

const SKIP = new Set(["_id_map", "positions", "template_formations", "sqlite_sequence", "__drizzle_migrations"]);
const tables = all<{ name: string }>(`SELECT name FROM main.sqlite_master WHERE type = 'table'`)
  .map((r) => r.name)
  .filter((n) => !SKIP.has(n) && !n.startsWith("sqlite_"));

const lookup = (table: string, expr: string) => `(SELECT "new" FROM main."_id_map" WHERE "tbl" = '${table}' AND "old" = ${expr})`;
const event = (col: string) =>
  `CASE src."event_type" WHEN 'game' THEN ${lookup("games", `src."${col}"`)} WHEN 'practice' THEN ${lookup("practices", `src."${col}"`)} END`;
const EXTRA: Record<string, Record<string, string>> = {
  rsvps: { event_id: event("event_id") },
  ledger_item_events: { event_id: event("event_id") },
  messages: {
    parent_id: lookup("messages", `src."parent_id"`),
    announcement_id: lookup("announcements", `src."announcement_id"`),
    inbound_email_id: lookup("inbound_emails", `src."inbound_email_id"`),
  },
  ledger_txns: { reverses_id: lookup("ledger_txns", `src."reverses_id"`) },
};

const problems: string[] = [];
const UUID_GLOB = "[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-7[0-9a-f][0-9a-f][0-9a-f]-[89ab][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]";

let checkedRefs = 0;
for (const t of tables) {
  const oldCount = one<{ n: number }>(`SELECT count(*) n FROM o."${t}"`).n;
  const newCount = one<{ n: number }>(`SELECT count(*) n FROM main."${t}"`).n;
  if (oldCount !== newCount) problems.push(`${t}: ${oldCount} rows before, ${newCount} after`);

  const badIds = one<{ n: number }>(`SELECT count(*) n FROM main."${t}" WHERE typeof(id) != 'text' OR id NOT GLOB '${UUID_GLOB}'`).n;
  if (badIds) problems.push(`${t}: ${badIds} ids aren't UUIDv7`);

  const join = `FROM o."${t}" src JOIN main."_id_map" m ON m."tbl" = '${t}' AND m."old" = src."id" JOIN main."${t}" n ON n."id" = m."new"`;
  const joined = one<{ n: number }>(`SELECT count(*) n ${join}`).n;
  if (joined !== oldCount) problems.push(`${t}: only ${joined} of ${oldCount} old rows found by their new id`);

  const refs: Record<string, string> = { ...(EXTRA[t] ?? {}) };
  for (const fk of all<{ from: string; table: string }>(`PRAGMA main.foreign_key_list("${t}")`)) {
    if (fk.table === "template_formations" || fk.table === "positions") {
      refs[fk.from] = `src."${fk.from}"`; // Kept as is
    } else {
      refs[fk.from] = lookup(fk.table, `src."${fk.from}"`);
    }
  }
  for (const [col, expected] of Object.entries(refs)) {
    checkedRefs++;
    const wrong = one<{ n: number }>(`SELECT count(*) n ${join} WHERE n."${col}" IS NOT ${expected}`).n;
    if (wrong) problems.push(`${t}.${col}: ${wrong} rows point at the wrong row`);
    const lost = one<{ n: number }>(`SELECT count(*) n ${join} WHERE src."${col}" IS NOT NULL AND n."${col}" IS NULL`).n;
    if (lost) problems.push(`${t}.${col}: ${lost} references became NULL (dangling before?)`);
  }

  // Order: no pair where the old id is lower but the new id isn't
  const outOfOrder = one<{ n: number }>(`
    SELECT count(*) n FROM (
      SELECT "old", "new", lag("new") OVER (ORDER BY "old") AS prev FROM main."_id_map" WHERE "tbl" = '${t}'
    ) WHERE prev IS NOT NULL AND prev >= "new"`).n;
  if (outOfOrder) problems.push(`${t}: ${outOfOrder} ids out of the old order`);
}

// Read markers: every message at or below the old marker is at or below the new one, and none above
for (const [t, col] of [["conversation_reads", "last_read_message_id"], ["conversation_read_marks", "up_to_message_id"]] as const) {
  const wrong = one<{ n: number }>(`
    SELECT count(*) n FROM o."${t}" src
    JOIN main."_id_map" m ON m."tbl" = '${t}' AND m."old" = src."id"
    JOIN main."${t}" n ON n."id" = m."new"
    JOIN main."_id_map" mm ON mm."tbl" = 'messages'
    WHERE (mm."old" <= coalesce(src."${col}", 0)) != (n."${col}" IS NOT NULL AND mm."new" <= n."${col}")`).n;
  if (wrong) problems.push(`${t}.${col}: ${wrong} (marker, message) pairs read differently`);
}

const badCodes = one<{ n: number }>(`SELECT count(*) n FROM main.teams WHERE code NOT GLOB '[2-9a-hjkmnp-z][2-9a-hjkmnp-z][2-9a-hjkmnp-z][2-9a-hjkmnp-z][2-9a-hjkmnp-z][2-9a-hjkmnp-z][2-9a-hjkmnp-z]' OR length(code) != 7`).n;
if (badCodes) problems.push(`teams: ${badCodes} bad codes`);

const fkProblems = all(`PRAGMA main.foreign_key_check`);
if (fkProblems.length) problems.push(`foreign_key_check: ${JSON.stringify(fkProblems.slice(0, 10))}`);

const integrity = one<{ integrity_check: string }>(`PRAGMA main.integrity_check`).integrity_check;
if (integrity !== "ok") problems.push(`integrity_check: ${integrity}`);

console.log(`${tables.length} tables, ${checkedRefs} reference columns checked`);
if (problems.length) {
  console.log(problems.map((p) => `✗ ${p}`).join("\n"));
  process.exit(1);
}
console.log("✓ all good");
