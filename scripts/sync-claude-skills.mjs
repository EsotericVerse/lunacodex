#!/usr/bin/env node
// LOC: .agents/skills holds only selected top-level skills.
// .claude/skills is an ignored discovery mirror; obsolete skill directories
// and symlinks must be removed. Detail topics live in .agents/SKILL-LINKS.md.
// Claude's discovery previously failed to traverse a linked parent folder,
// so keep this top-level mirror as real directories for reliable discovery.
// Runs during npm prepare; never scans or installs module-specific skills.

import {cpSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, '.agents', 'skills');
const dest = join(root, '.claude', 'skills');

function stat(path) {
  try { return lstatSync(path); } catch { return null; }
}

if (!existsSync(source)) {
  console.warn('sync-claude-skills: source missing; skip');
  process.exit(0);
}

try {
  const existing = stat(dest);
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) {
    // Unlink only the old alias; never traverse and delete its target.
    rmSync(dest, {recursive: true, force: true});
  }
  mkdirSync(dest, {recursive: true});

  const wanted = readdirSync(source, {withFileTypes: true})
    .filter(entry => entry.isDirectory() && existsSync(join(source, entry.name, 'SKILL.md')))
    .map(entry => entry.name);

  // Remove all previous entries (including stale aliases) before mirroring.
  for (const name of readdirSync(dest)) {
    rmSync(join(dest, name), {recursive: true, force: true});
  }
  for (const name of wanted) {
    cpSync(join(source, name), join(dest, name), {recursive: true, force: true, dereference: false});
  }
  console.log('sync-claude-skills: mirrored ' + wanted.length + ' top-level skills');
} catch (error) {
  console.warn('sync-claude-skills: ' + String(error?.message || error));
  // The skill mirror must not block npm install.
}
