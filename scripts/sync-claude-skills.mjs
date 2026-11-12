#!/usr/bin/env node
// Mirrors .agents/skills into .claude/skills as real files.
//
// Why real files and not a link: Claude Code's skill discovery does not
// traverse a symlinked .claude/skills. Measured on 2026-11-13 — with
// .claude/skills symlinked to .agents/skills (92 skills on disk), only
// the 54 that had previously existed as real directories under
// .claude/skills were registered. Nothing behind the link was ever
// discovered. A Windows junction may behave differently, but nothing
// here should depend on that.
//
// Source of truth is .agents/skills — the only copy in version control.
// .claude/skills is gitignored and regenerated, so the two cannot drift.
//
// Runs from the `prepare` script on npm install. Must never fail an
// install: anything unexpected is a warning and exit 0.

import {cpSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, statSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(repoRoot, '.agents', 'skills');
const dest = join(repoRoot, '.claude', 'skills');

function warn(message) {
  console.warn(`sync-claude-skills: ${message}`);
  process.exit(0);
}

if (!existsSync(source)) {
  warn('.agents/skills is missing; nothing to mirror.');
}

// Clear whatever is sitting at .claude/skills if it is not a plain
// directory — a symlink or junction from the previous design, or the
// text file a symlink becomes when git checks it out without symlink
// support on Windows.
let destStat = null;
try {
  destStat = lstatSync(dest);
} catch {}

if (destStat && !destStat.isDirectory()) {
  rmSync(dest, {force: true});
  destStat = null;
} else if (destStat && destStat.isSymbolicLink()) {
  rmSync(dest, {force: true});
  destStat = null;
}

mkdirSync(dest, {recursive: true});

// Copy everything, then drop anything in dest that is no longer in
// source, so a skill removed upstream does not linger here.
try {
  cpSync(source, dest, {recursive: true, force: true});
} catch (error) {
  warn(`copy failed (${error.code || error.message}); .claude/skills may be incomplete.`);
}

let pruned = 0;
function prune(relative) {
  const from = join(source, relative);
  const to = join(dest, relative);
  for (const entry of readdirSync(to)) {
    const childRelative = join(relative, entry);
    if (!existsSync(join(from, entry))) {
      rmSync(join(to, entry), {recursive: true, force: true});
      pruned += 1;
    } else if (statSync(join(to, entry)).isDirectory()) {
      prune(childRelative);
    }
  }
}

try {
  prune('');
} catch (error) {
  warn(`prune failed (${error.code || error.message}); .claude/skills may hold stale files.`);
}

const count = readdirSync(dest).length;
console.log(
  `sync-claude-skills: .agents/skills -> .claude/skills (${count} skills` +
    (pruned ? `, ${pruned} stale entries removed` : '') +
    ')',
);
