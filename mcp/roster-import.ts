// MCP server: import a CSV roster into a brand-new team on a coach's account.
//
// Runs over stdio, so nothing here may write to stdout except the MCP transport.
// Logs go to stderr.
//
// Target database (first match wins):
//   --db=<libsql url>   e.g. --db=file:/tmp/test.db for a throwaway run
//   --target=staging    TURSO_URL / TURSO_TOKEN
//   --target=prod       TURSO_PROD_URL / TURSO_PROD_TOKEN (the default)
//
// Credentials come from .env, never from .mcp.json.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { and, eq, sql } from "drizzle-orm";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as schema from "../app/db/schema";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(projectRoot, ".env"), quiet: true });

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

function resolveTarget() {
  const arg = (name: string) =>
    process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

  const explicit = arg("db");
  if (explicit) return { label: explicit, url: explicit, authToken: undefined };

  const target = arg("target") ?? "prod";
  if (target === "staging") {
    if (!process.env.TURSO_URL || !process.env.TURSO_TOKEN) {
      throw new Error("TURSO_URL and TURSO_TOKEN must be set in .env for --target=staging");
    }
    return { label: "staging", url: process.env.TURSO_URL, authToken: process.env.TURSO_TOKEN };
  }
  if (target === "prod") {
    if (!process.env.TURSO_PROD_URL || !process.env.TURSO_PROD_TOKEN) {
      throw new Error("TURSO_PROD_URL and TURSO_PROD_TOKEN must be set in .env for --target=prod");
    }
    return { label: "PRODUCTION", url: process.env.TURSO_PROD_URL, authToken: process.env.TURSO_PROD_TOKEN };
  }
  throw new Error(`Unknown --target=${target} (use prod or staging, or pass --db=<url>)`);
}

const target = resolveTarget();
const db = drizzle(createClient({ url: target.url, authToken: target.authToken }), { schema });
console.error(`[roster-import] database: ${target.label}`);

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

// RFC 4180-ish: quoted fields, escaped quotes, CRLF, and a BOM from Excel.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); // blank rows kept so line numbers stay true; callers skip them
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const isBlank = (row: string[]) => row.every((c) => c.trim() === "");

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9#]/g, "");

// Header aliases, normalized (lowercase, no spaces or punctuation).
const COLUMN_ALIASES = {
  playerFirst: ["playerfirstname", "playerfirst", "firstname", "first"],
  playerLast: ["playerlastname", "playerlast", "lastname", "last"],
  playerName: ["playername", "player", "name", "fullname"],
  jersey: ["jersey", "jerseynumber", "jersey#", "number", "#", "no"],
  birthDate: ["birthdate", "dob", "dateofbirth", "birthday"],
  parentFirst: ["parentfirstname", "guardianfirstname", "parentfirst"],
  parentLast: ["parentlastname", "guardianlastname", "parentlast"],
  parentName: ["parentname", "guardianname", "parent", "guardian"],
  email: ["email", "parentemail", "guardianemail", "emailaddress"],
  phone: ["phone", "parentphone", "guardianphone", "cell", "mobile", "phonenumber"],
} as const;

type ColumnKey = keyof typeof COLUMN_ALIASES;

function mapColumns(headers: string[]) {
  const normalized = headers.map(norm);
  const map: Partial<Record<ColumnKey, number>> = {};
  for (const key of Object.keys(COLUMN_ALIASES) as ColumnKey[]) {
    for (const alias of COLUMN_ALIASES[key]) {
      const idx = normalized.indexOf(alias);
      if (idx !== -1 && !Object.values(map).includes(idx)) { map[key] = idx; break; }
    }
  }
  const used = new Set(Object.values(map));
  const ignored = headers.filter((_, i) => !used.has(i));
  return { map, ignored };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ParsedRow {
  line: number;
  playerName: string;
  jerseyNumber: number | null;
  birthDate: string | null;
  parentName: string | null;
  email: string | null;
  phone: string | null;
}

function parseRoster(text: string) {
  const rows = parseCsv(text);
  const headerIdx = rows.findIndex((r) => !isBlank(r));
  if (headerIdx === -1 || rows.slice(headerIdx + 1).every(isBlank)) {
    throw new Error("CSV needs a header row and at least one player row");
  }
  const headers = rows[headerIdx];
  const body = rows.slice(headerIdx + 1);
  const { map, ignored } = mapColumns(headers);

  const hasSplitName = map.playerFirst !== undefined;
  if (!hasSplitName && map.playerName === undefined) {
    throw new Error(`Couldn't find a player name column. Headers: ${headers.join(", ")}`);
  }

  const get = (row: string[], key: ColumnKey) =>
    map[key] === undefined ? "" : (row[map[key]!] ?? "").trim();

  const players: ParsedRow[] = [];
  const warnings: string[] = [];

  body.forEach((row, i) => {
    if (isBlank(row)) return;
    const line = headerIdx + i + 2; // 1-based file line
    const playerName = hasSplitName
      ? [get(row, "playerFirst"), get(row, "playerLast")].filter(Boolean).join(" ")
      : get(row, "playerName");
    if (!playerName) { warnings.push(`Line ${line}: no player name, skipped`); return; }

    const jerseyRaw = get(row, "jersey");
    const jerseyNumber = jerseyRaw && /^\d{1,3}$/.test(jerseyRaw) ? Number(jerseyRaw) : null;
    if (jerseyRaw && jerseyNumber === null) warnings.push(`Line ${line}: jersey "${jerseyRaw}" isn't a number, left blank`);

    const parentName =
      [get(row, "parentFirst"), get(row, "parentLast")].filter(Boolean).join(" ") ||
      get(row, "parentName") || null;

    let email: string | null = get(row, "email").toLowerCase() || null;
    if (email && !EMAIL_RE.test(email)) {
      warnings.push(`Line ${line}: "${email}" isn't a valid email, no parent contact created`);
      email = null;
    }

    players.push({
      line,
      playerName,
      jerseyNumber,
      birthDate: get(row, "birthDate") || null,
      parentName,
      email,
      phone: get(row, "phone") || null,
    });
  });

  const seen = new Map<string, number>();
  for (const p of players) {
    const key = p.playerName.toLowerCase();
    if (seen.has(key)) warnings.push(`Line ${p.line}: "${p.playerName}" also appears on line ${seen.get(key)}`);
    else seen.set(key, p.line);
  }

  const mapped = Object.fromEntries(
    (Object.entries(map) as [ColumnKey, number][]).map(([k, idx]) => [k, headers[idx]])
  );
  return { players, warnings, mapped, ignored };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findUser(email: string) {
  const [user] = await db
    .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name })
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${email.trim().toLowerCase()}`)
    .limit(1);
  if (!user) throw new Error(`No account with email ${email} on ${target.label}`);
  return user;
}

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const fail = (s: string) => ({ content: [{ type: "text" as const, text: s }], isError: true });

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new McpServer({ name: "ayso-roster-import", version: "1.0.0" });

server.registerTool(
  "list_teams",
  {
    title: "List teams",
    description: `List the teams a coach owns on the ${target.label} database, with player counts. Use it to check for an existing team before importing.`,
    inputSchema: { owner_email: z.string().describe("The coach's login email") },
    annotations: { readOnlyHint: true },
  },
  async ({ owner_email }) => {
    try {
      const user = await findUser(owner_email);
      const rows = await db
        .select({
          id: schema.teams.id,
          name: schema.teams.name,
          format: schema.teams.format,
          ageGroup: schema.teams.ageGroup,
          season: schema.teams.season,
          region: schema.teams.region,
          players: sql<number>`count(${schema.players.id})`,
        })
        .from(schema.teams)
        .leftJoin(schema.players, eq(schema.players.teamId, schema.teams.id))
        .where(eq(schema.teams.coachId, user.id))
        .groupBy(schema.teams.id);
      const lines = rows.map(
        (t) => `#${t.id} ${t.name} (${t.format}${t.ageGroup ? `, ${t.ageGroup}` : ""}${t.season ? `, ${t.season}` : ""}${t.region ? `, region ${t.region}` : ""}): ${t.players} players`
      );
      return text(`${target.label}: ${user.email} (user ${user.id}) owns ${rows.length} teams\n${lines.join("\n")}`);
    } catch (e) {
      return fail((e as Error).message);
    }
  }
);

server.registerTool(
  "import_roster_csv",
  {
    title: "Import roster CSV into a new team",
    description:
      `Create a new team on a coach's account (${target.label} database) and add every player from a CSV, plus a parent contact per player when the row has an email. ` +
      "Recognizes split or combined player name columns, jersey number, birth date, parent name, email and phone; other columns are ignored and listed. " +
      "dry_run defaults to true and writes nothing: always run it first, show the user the preview, and only call again with dry_run=false once they confirm.",
    inputSchema: {
      csv_path: z.string().describe("Path to the CSV file, absolute or relative to the ayso-game-day project"),
      owner_email: z.string().describe("Login email of the coach who will own the team"),
      team_name: z.string().min(1),
      format: z.enum(["7v7", "9v9", "11v11"]),
      age_group: z.string().optional().describe("e.g. U14"),
      season: z.string().optional().describe("e.g. Fall 2026. Defaults to '<year> Season' like the app does"),
      region: z.string().optional().describe("AYSO region number"),
      team_number: z.string().optional().describe("AYSO team number printed on game cards"),
      birth_date_in_notes: z.boolean().default(true).describe("Put 'Born <date>' in each player's notes, since players have no birth date field"),
      allow_duplicate_name: z.boolean().default(false).describe("Allow creating a team when the coach already has one with the same name and season"),
      dry_run: z.boolean().default(true),
    },
    annotations: { destructiveHint: false, idempotentHint: false },
  },
  async (args) => {
    try {
      const csvPath = path.isAbsolute(args.csv_path) ? args.csv_path : path.join(projectRoot, args.csv_path);
      const roster = parseRoster(await readFile(csvPath, "utf8"));
      if (roster.players.length === 0) return fail("No players found in the CSV.");

      const user = await findUser(args.owner_email);
      const season = args.season?.trim() || `${new Date().getFullYear()} Season`;

      const [clash] = await db
        .select({ id: schema.teams.id })
        .from(schema.teams)
        .where(and(
          eq(schema.teams.coachId, user.id),
          sql`lower(${schema.teams.name}) = ${args.team_name.trim().toLowerCase()}`,
          sql`lower(coalesce(${schema.teams.season}, '')) = ${season.toLowerCase()}`
        ))
        .limit(1);
      if (clash && !args.allow_duplicate_name) {
        return fail(`${user.email} already has "${args.team_name}" for ${season} (team #${clash.id}). Pick another name or season, or pass allow_duplicate_name=true.`);
      }

      const contactCount = roster.players.filter((p) => p.email).length;
      const families = new Set(roster.players.map((p) => p.email).filter(Boolean)).size;

      const preview = [
        `${args.dry_run ? "DRY RUN, nothing written." : "IMPORTED."} Database: ${target.label}`,
        `Owner: ${user.name ?? ""} <${user.email}> (user ${user.id})`,
        `Team: "${args.team_name.trim()}" ${args.format}${args.age_group ? `, ${args.age_group}` : ""}, ${season}${args.region ? `, region ${args.region}` : ""}${args.team_number ? `, team #${args.team_number}` : ""}`,
        `Columns used: ${Object.entries(roster.mapped).map(([k, h]) => `${h} -> ${k}`).join(", ")}`,
        roster.ignored.length ? `Columns ignored: ${roster.ignored.join(", ")}` : null,
        `${roster.players.length} players, ${contactCount} parent contacts across ${families} families${roster.players.length - contactCount ? `, ${roster.players.length - contactCount} players without an email` : ""}`,
        "",
        ...roster.players.map((p) =>
          `  ${p.playerName}${p.jerseyNumber !== null ? ` #${p.jerseyNumber}` : ""}${args.birth_date_in_notes && p.birthDate ? ` (born ${p.birthDate})` : ""}` +
          (p.email ? `  parent: ${p.parentName ?? "(no name)"} <${p.email}>${p.phone ? ` ${p.phone}` : ""}` : "  no parent contact")
        ),
        roster.warnings.length ? `\nWarnings:\n${roster.warnings.map((w) => `  ${w}`).join("\n")}` : null,
      ].filter((l) => l !== null).join("\n");

      if (args.dry_run) return text(preview);

      // One transaction: the team, its players and their parent contacts land together or not at all.
      const teamId = await db.transaction(async (tx) => {
        const [team] = await tx.insert(schema.teams).values({
          name: args.team_name.trim(),
          coachId: user.id,
          format: args.format,
          ageGroup: args.age_group?.trim() || null,
          season,
          region: args.region?.trim() || null,
          teamNumber: args.team_number?.trim() || null,
        }).returning({ id: schema.teams.id });

        for (const p of roster.players) {
          const [player] = await tx.insert(schema.players).values({
            teamId: team.id,
            coachId: user.id,
            name: p.playerName,
            jerseyNumber: p.jerseyNumber,
            description: args.birth_date_in_notes && p.birthDate ? `Born ${p.birthDate}` : null,
          }).returning({ id: schema.players.id });

          if (p.email) {
            await tx.insert(schema.contacts).values({
              teamId: team.id,
              playerId: player.id,
              name: p.parentName || p.email,
              email: p.email,
              phone: p.phone,
              relationship: "parent",
              isPrimary: true,
            });
          }
        }
        return team.id;
      });

      return text(`${preview}\n\nCreated team #${teamId}: /dashboard/team/${teamId}/roster`);
    } catch (e) {
      return fail((e as Error).message);
    }
  }
);

await server.connect(new StdioServerTransport());
