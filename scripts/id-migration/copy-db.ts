// Copies a libSQL/Turso database into a local SQLite file, read-only on the
// source: schema (tables, then indexes) and every row. For rehearsing the id
// migration on real data.
//
//   npx tsx scripts/id-migration/copy-db.ts <libsql url> <token or ""> <out.db>

import { createClient } from "@libsql/client";
// @ts-expect-error The installed @types/node (20) predates node:sqlite; run these with Node 22.5+.
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";

const [url, token, out] = process.argv.slice(2);
if (!url || !out) throw new Error("usage: copy-db.ts <url> <token> <out.db>");
if (existsSync(out)) throw new Error(`${out} already exists`);

(async () => {
  const src = createClient({ url, authToken: token || undefined });
  const dst = new DatabaseSync(out);
  dst.exec("PRAGMA foreign_keys = OFF"); // Copy tables in any order
  const objects = await src.execute(
    `SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, rowid`,
  );
  for (const o of objects.rows) if (o.type === "table") dst.exec(String(o.sql));
  let rows = 0;
  for (const o of objects.rows) {
    if (o.type !== "table") continue;
    const res = await src.execute(`SELECT * FROM "${o.name}"`);
    if (!res.rows.length) continue;
    const cols = res.columns;
    const ins = dst.prepare(`INSERT INTO "${o.name}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`);
    dst.exec("BEGIN");
    for (const r of res.rows) ins.run(...cols.map((c) => (r[c] as any) ?? null));
    dst.exec("COMMIT");
    rows += res.rows.length;
  }
  for (const o of objects.rows) if (o.type !== "table") dst.exec(String(o.sql));
  dst.close();
  console.log(`Copied ${objects.rows.filter((o) => o.type === "table").length} tables, ${rows} rows to ${out}`);
})();
