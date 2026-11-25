#!/usr/bin/env node
// Worktree status: which trees exist, what each is for, how far it is from
// preview, what it runs on, and which migration numbers it holds. Everything
// is worked out from git and running processes each time, so it can't go
// stale the way a hand-kept list would.
//
//   npm run trees              all trees (fetches origin first)
//   npm run trees -- --brief   short form, printed to every Claude session at start
//   npm run trees -- --check   before merging this tree's branch into preview:
//                              did preview move, would it conflict, migration
//                              clashes, and is a preview -> main PR open.
//                              Exits 1 when something needs attention.
//   --no-fetch                 skip the fetch (offline, or already fetched)
//
// A tree's purpose is its branch description:
//   git branch --edit-description          (or)
//   git config branch.<branch>.description "Tasks for families"
//
// Plain Node (26 runs TypeScript directly) with no dependencies, so it works
// in a fresh worktree before npm install.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

const args = new Set(process.argv.slice(2));
const brief = args.has("--brief");
const check = args.has("--check");
const fetch = !args.has("--no-fetch");
const BASE = "origin/preview";

function run(cmd: string, argv: string[], opts: { cwd?: string; timeout?: number } = {}) {
  const r = spawnSync(cmd, argv, { cwd: opts.cwd, encoding: "utf8", timeout: opts.timeout ?? 15000 });
  return { ok: r.status === 0, status: r.status, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}
const git = (argv: string[], cwd?: string) => run("git", argv, { cwd });

// ---------------------------------------------------------------------------
// Where we are

const here = git(["rev-parse", "--show-toplevel"]);
if (!here.ok) {
  console.error("Not inside a git repository");
  process.exit(brief ? 0 : 1);
}
const currentTop = realpathSync(here.out);
const commonDir = realpathSync(path.resolve(currentTop, git(["rev-parse", "--git-common-dir"]).out));
const mainRoot = path.dirname(commonDir); // The main checkout holds .git

let fetched = false;
if (fetch) fetched = run("git", ["fetch", "--quiet", "origin"], { cwd: mainRoot, timeout: 8000 }).ok;
const hasBase = git(["rev-parse", "--verify", "--quiet", BASE], mainRoot).ok;

// ---------------------------------------------------------------------------
// Trees

type Tree = {
  path: string;
  name: string;
  branch: string | null;
  head: string;
  main: boolean;
  where: "here" | "other-machine" | "missing";
  current: boolean;
};

function listTrees(): Tree[] {
  const raw = git(["worktree", "list", "--porcelain"], mainRoot).out;
  const trees: Tree[] = [];
  for (const block of raw.split(/\n\n+/)) {
    const lines = block.split("\n");
    const p = lines.find((l) => l.startsWith("worktree "))?.slice(9);
    if (!p) continue;
    const branchRef = lines.find((l) => l.startsWith("branch "))?.slice(7) ?? null;
    const head = lines.find((l) => l.startsWith("HEAD "))?.slice(5, 12) ?? "";
    const exists = existsSync(p);
    const real = exists ? realpathSync(p) : p;
    const main = real === mainRoot;
    // Syncthing syncs .git (so git knows about trees made on the other
    // machine) but not .claude/worktrees (so their folders aren't here)
    const where = exists ? "here" : real.startsWith(mainRoot + path.sep) ? "missing" : "other-machine";
    trees.push({
      path: real,
      name: main ? "main checkout" : path.basename(real),
      branch: branchRef ? branchRef.replace(/^refs\/heads\//, "") : null,
      head,
      main,
      where,
      current: real === currentTop,
    });
  }
  return trees;
}

// ---------------------------------------------------------------------------
// Dev servers: listening TCP ports, matched to a tree by the process's cwd

function portsByDir(): Map<string, number[]> {
  const result = new Map<string, number[]>();
  const listen = run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"], { timeout: 5000 });
  if (!listen.out) return result;
  const portsByPid = new Map<string, Set<number>>();
  let pid = "";
  for (const line of listen.out.split("\n")) {
    if (line.startsWith("p")) pid = line.slice(1);
    else if (line.startsWith("n")) {
      const port = Number(line.slice(line.lastIndexOf(":") + 1));
      if (port >= 3000 && port < 10000) portsByPid.set(pid, (portsByPid.get(pid) ?? new Set()).add(port));
    }
  }
  if (portsByPid.size === 0) return result;
  const cwd = run("lsof", ["-a", "-d", "cwd", "-p", [...portsByPid.keys()].join(","), "-Fpn"], { timeout: 5000 });
  for (const line of cwd.out.split("\n")) {
    if (line.startsWith("p")) pid = line.slice(1);
    else if (line.startsWith("n")) {
      let dir = line.slice(1);
      try {
        dir = realpathSync(dir);
      } catch {}
      result.set(dir, [...(result.get(dir) ?? []), ...(portsByPid.get(pid) ?? [])].sort((a, b) => a - b));
    }
  }
  return result;
}

function portsFor(tree: Tree, ports: Map<string, number[]>) {
  const found = new Set<number>();
  for (const [dir, list] of ports) {
    // A server started in a subfolder still belongs to the tree, but the main
    // checkout must not claim servers running inside its worktrees
    const inside = dir === tree.path || dir.startsWith(tree.path + path.sep);
    const inWorktree = tree.main && dir.startsWith(path.join(tree.path, ".claude", "worktrees") + path.sep);
    if (inside && !inWorktree) list.forEach((p) => found.add(p));
  }
  return [...found].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Migrations: drizzle/NNNN_name.sql files a tree has that preview doesn't

const MIGRATION = /^(\d{4})_.+\.sql$/;

function baseMigrations() {
  if (!hasBase) return [];
  return git(["ls-tree", "--name-only", `${BASE}:drizzle`], mainRoot).out.split("\n").filter((f) => MIGRATION.test(f));
}

function treeMigrations(tree: Tree) {
  if (tree.where === "here") {
    const dir = path.join(tree.path, "drizzle");
    return existsSync(dir) ? readdirSync(dir).filter((f) => MIGRATION.test(f)) : [];
  }
  if (!tree.branch) return [];
  return git(["ls-tree", "--name-only", `${tree.branch}:drizzle`], mainRoot).out.split("\n").filter((f) => MIGRATION.test(f));
}

const num = (file: string) => Number(file.slice(0, 4));
const pad = (n: number) => String(n).padStart(4, "0");

// ---------------------------------------------------------------------------
// Per-tree facts

type Status = Tree & {
  description: string | null;
  ahead: number | null;
  behind: number | null;
  unmerged: boolean | null; // Has changes preview doesn't
  dirty: number | null;
  lastCommit: string | null;
  ports: number[];
  newMigrations: string[];
};

function status(tree: Tree, ports: Map<string, number[]>, base: Set<string>): Status {
  const s: Status = { ...tree, description: null, ahead: null, behind: null, unmerged: null, dirty: null, lastCommit: null, ports: [], newMigrations: [] };
  if (tree.branch) {
    s.description = git(["config", "--get", `branch.${tree.branch}.description`], mainRoot).out.split("\n")[0] || null;
    const branchExists = git(["rev-parse", "--verify", "--quiet", tree.branch], mainRoot).ok;
    if (branchExists) {
      s.lastCommit = git(["log", "-1", "--format=%cr", tree.branch], mainRoot).out || null;
      if (hasBase) {
        const counts = git(["rev-list", "--left-right", "--count", `${BASE}...${tree.branch}`], mainRoot).out.split(/\s+/).map(Number);
        [s.behind, s.ahead] = counts;
        // Three dots: what the branch changed since it left preview
        s.unmerged = !git(["diff", "--quiet", `${BASE}...${tree.branch}`], mainRoot).ok;
      }
    }
  }
  if (tree.where === "here") {
    const st = git(["status", "--porcelain"], tree.path);
    s.dirty = st.ok ? st.out.split("\n").filter(Boolean).length : null;
    s.ports = portsFor(tree, ports);
  }
  s.newMigrations = treeMigrations(tree).filter((f) => !base.has(f));
  return s;
}

// ---------------------------------------------------------------------------
// Report

const trees = listTrees();
const ports = portsByDir();
const baseFiles = baseMigrations();
const base = new Set(baseFiles);
const statuses = trees.map((t) => status(t, ports, base));

// Migration numbers claimed by more than one name, across preview and every tree
const claims = new Map<number, Map<string, string[]>>();
const claim = (file: string, owner: string) => {
  const byName = claims.get(num(file)) ?? new Map<string, string[]>();
  byName.set(file, [...(byName.get(file) ?? []), owner]);
  claims.set(num(file), byName);
};
baseFiles.forEach((f) => claim(f, "preview"));
for (const s of statuses) s.newMigrations.forEach((f) => claim(f, s.branch ?? s.name));
const clashes = [...claims].filter(([, byName]) => byName.size > 1);
const nextFree = pad(Math.max(0, ...claims.keys()) + 1);

function line(s: Status) {
  const bits: string[] = [];
  if (s.branch) bits.push(s.branch);
  else bits.push(`detached ${s.head}`);
  if (!s.main && s.ahead != null) {
    if (s.ahead === 0 && !s.dirty) bits.push(s.where === "here" ? "no work of its own (merged, or not started)" : "merged");
    else if (s.ahead > 0 && s.unmerged === false) bits.push(`${s.ahead} commit(s), all already in preview`);
    else bits.push(`${s.ahead} ahead, ${s.behind} behind preview`);
  }
  if (s.dirty) bits.push(`${s.dirty} uncommitted`);
  if (s.lastCommit && !s.main) bits.push(`last commit ${s.lastCommit}`);
  if (s.ports.length) bits.push(`dev server ${s.ports.map((p) => `:${p}`).join(" ")}`);
  if (s.newMigrations.length) bits.push(`new migrations ${s.newMigrations.map((f) => f.replace(/\.sql$/, "")).join(", ")}`);
  return bits.join(" · ");
}

const local = statuses.filter((s) => s.where === "here");
const elsewhere = statuses.filter((s) => s.where === "other-machine");
const missing = statuses.filter((s) => s.where === "missing");

if (check) {
  process.exit(runCheck());
} else if (brief) {
  printBrief();
} else {
  printFull();
}

function printFull() {
  console.log(`Worktrees${fetched ? "" : fetch ? " (fetch failed; preview may be out of date)" : " (not fetched)"}\n`);
  for (const s of local) {
    console.log(`${s.current ? "▸" : " "} ${s.name}${s.current ? " (you are here)" : ""}`);
    console.log(`    ${line(s)}`);
    if (s.description) console.log(`    “${s.description}”`);
  }
  if (local.some((s) => !s.main && !s.description)) {
    console.log(`\n  Say what a tree is for: git config branch.<branch>.description "what it's for"`);
  }
  if (missing.length) {
    console.log(`\nRegistered here but the folder is gone:`);
    for (const s of missing) console.log(`    ${s.name} · ${line(s)}`);
    console.log(`    Remove with: git worktree remove --force <path> (only if it was yours)`);
  }
  if (elsewhere.length) {
    console.log(`\nOn your other machine (Syncthing syncs .git, not the folders):`);
    for (const s of elsewhere) console.log(`    ${s.name} · ${line(s)}${s.description ? ` · “${s.description}”` : ""}`);
    console.log(`    Don't prune or remove these from here; that breaks them over there.`);
  }
  printMigrations();
}

function printMigrations() {
  console.log("");
  for (const [n, byName] of clashes) {
    console.log(`⚠ Migration number ${pad(n)} is claimed twice: ${[...byName].map(([f, owners]) => `${f} (${owners.join(", ")})`).join(" and ")}`);
  }
  console.log(`Next free migration number: ${nextFree}`);
}

function printBrief() {
  const out: string[] = [];
  const others = local.filter((s) => !s.current);
  const me = local.find((s) => s.current);
  out.push(`Worktree status (npm run trees for detail):`);
  if (me) out.push(`- You are in ${me.main ? "the main checkout" : `worktree ${me.name}`}: ${line(me)}`);
  for (const s of others) out.push(`- ${s.main ? "Main checkout" : `Worktree ${s.name}`}: ${line(s)}${s.description ? ` · “${s.description}”` : ""}`);
  if (elsewhere.length) out.push(`- ${elsewhere.length} more on the other machine (${elsewhere.map((s) => s.branch ?? s.name).join(", ")}); leave them alone`);
  for (const [n, byName] of clashes) out.push(`- ⚠ Migration ${pad(n)} is claimed twice: ${[...byName.keys()].join(" and ")}`);
  out.push(`- Next free migration number: ${nextFree}. Before merging into preview: npm run trees -- --check`);
  console.log(out.join("\n"));
}

// ---------------------------------------------------------------------------
// --check: is this tree's branch safe to merge into preview right now?

function runCheck() {
  const me = statuses.find((s) => s.current);
  if (!me?.branch || me.main) {
    console.log("Run --check from a feature worktree, on its branch.");
    return 1;
  }
  if (!hasBase) {
    console.log(`No ${BASE} to compare against. Fetch first.`);
    return 1;
  }
  let problems = 0;
  const say = (ok: boolean, text: string) => {
    if (!ok) problems++;
    console.log(`${ok ? "✓" : "✗"} ${text}`);
  };

  console.log(`Checking ${me.branch} against ${BASE}${fetched ? "" : " (not freshly fetched)"}\n`);

  // 1. Preview moved since the branch last took it in
  const moved = git(["log", "--oneline", "--no-merges", `${me.branch}..${BASE}`], mainRoot).out.split("\n").filter(Boolean);
  say(moved.length === 0, moved.length === 0 ? "Preview hasn't moved since this branch last merged it" : `Preview has ${moved.length} commit(s) this branch doesn't. Merge ${BASE} into the branch here first:`);
  moved.slice(0, 8).forEach((c) => console.log(`    ${c}`));
  if (moved.length > 8) console.log(`    …and ${moved.length - 8} more`);

  // 2. Would merging conflict? Tested in memory; nothing is touched
  const mt = git(["merge-tree", "--write-tree", "--name-only", "--no-messages", BASE, me.branch], mainRoot);
  if (mt.status === 0) say(true, "Merges into preview cleanly");
  else if (mt.status === 1) {
    const files = mt.out.split("\n").slice(1).filter(Boolean);
    say(false, `Merging would conflict in ${files.length} file(s):`);
    files.forEach((f) => console.log(`    ${f}`));
  } else say(false, `Couldn't test the merge: ${mt.err || mt.out}`);

  // 3. Uncommitted work would be left behind
  say(!me.dirty, me.dirty ? `${me.dirty} uncommitted change(s) in this tree` : "Everything is committed");

  // 4. Migration numbers
  const mineClash = clashes.filter(([n]) => me.newMigrations.some((f) => num(f) === n));
  if (me.newMigrations.length === 0) say(true, "No new migrations");
  else if (mineClash.length === 0) say(true, `New migrations don't clash: ${me.newMigrations.join(", ")}`);
  else
    for (const [n, byName] of mineClash) {
      const onBase = [...byName.values()].some((owners) => owners.includes("preview"));
      say(false, `Migration ${pad(n)} is also claimed by ${[...byName].filter(([f]) => !me.newMigrations.includes(f)).map(([f, o]) => `${f} (${o.join(", ")})`).join(", ")}.${onBase ? ` Renumber yours to ${nextFree} (see CLAUDE.md, number clashes).` : " Whichever isn't on prod yet moves."}`);
    }

  // 5. An open preview -> main PR takes in anything pushed to preview
  const prs = run("gh", ["pr", "list", "--base", "main", "--head", "preview", "--state", "open", "--json", "number,title"], { cwd: mainRoot, timeout: 8000 });
  if (prs.ok) {
    const open = JSON.parse(prs.out || "[]") as { number: number; title: string }[];
    if (open.length === 0) console.log("✓ No preview → main PR is open");
    else open.forEach((p) => console.log(`! PR #${p.number} (preview → main) is open: pushing preview adds this branch to it. “${p.title}”`));
  } else console.log("? Couldn't ask GitHub about open PRs (gh not signed in?)");

  console.log(problems ? `\n${problems} thing(s) to sort out before merging.` : "\nReady to merge into preview.");
  return problems ? 1 : 0;
}
