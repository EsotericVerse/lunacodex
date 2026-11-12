#!/usr/bin/env node
// Makes .claude/skills point at .agents/skills, so one copy of each skill
// serves both Claude Code (reads .claude) and the other agents (read .agents).
//
// Why a generated link instead of a committed symlink: git on Windows
// checks a committed symlink out as a plain text file unless
// core.symlinks is on (needs Developer Mode or admin), which would leave
// Claude Code seeing no skills at all. So .claude/skills is gitignored
// and created locally — a junction on Windows (no admin needed), a
// symlink elsewhere.
//
// Runs from the `prepare` script on npm install. Must never fail an
// install: anything unexpected is a warning and exit 0.

import {existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync, symlinkSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const linkPath = join(repoRoot, '.claude', 'skills');
const targetPath = join(repoRoot, '.agents', 'skills');

function warn(message) {
  console.warn(`link-claude-skills: ${message}`);
  process.exit(0);
}

if (!existsSync(targetPath)) {
  warn(`.agents/skills is missing; nothing to link to.`);
}

if (existsSync(linkPath) || isBrokenLink(linkPath)) {
  const stat = lstatSync(linkPath);

  if (stat.isSymbolicLink()) {
    const current = resolve(dirname(linkPath), readlinkSync(linkPath));
    if (current === targetPath && existsSync(linkPath)) {
      process.exit(0); // Already correct.
    }
    rmSync(linkPath, {force: true}); // Wrong target, or dangling.
  } else if (stat.isFile()) {
    // A committed symlink checked out as text by a git without symlink
    // support. Safe to drop: it is a 17-byte path string, not content.
    rmSync(linkPath, {force: true});
  } else if (stat.isDirectory()) {
    if (readdirSync(linkPath).length > 0) {
      warn(`.claude/skills is a real directory with files in it. Leaving it alone — move or delete it, then rerun this script.`);
    }
    rmSync(linkPath, {recursive: true, force: true}); // Empty, safe to replace.
  } else {
    warn(`.claude/skills is something unexpected; leaving it alone.`);
  }
}

function isBrokenLink(p) {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

mkdirSync(dirname(linkPath), {recursive: true});

// 'junction' on Windows: works without Developer Mode or admin rights, but
// needs an absolute target. Elsewhere a relative symlink keeps the repo
// portable if it is moved.
try {
  if (process.platform === 'win32') {
    symlinkSync(targetPath, linkPath, 'junction');
  } else {
    symlinkSync(join('..', '.agents', 'skills'), linkPath, 'dir');
  }
} catch (error) {
  warn(`could not create the link (${error.code || error.message}). Claude Code will not see the skills in .agents/skills until this is fixed.`);
}

const count = readdirSync(linkPath).length;
console.log(`link-claude-skills: .claude/skills -> .agents/skills (${count} skills)`);
