#!/usr/bin/env node
// LOC keeps the 12 curated skills only in .agents/skills.
// .claude/skills contains per-skill directory links, not copied skill contents.
// Narrow, version-pinned HTTP references remain in .agents/SKILL-LINKS.md.
// Runs on npm prepare, NOT on each Agent request. Never installs more skills.

import {existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, symlinkSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, '.agents', 'skills');
const dest = join(root, '.claude', 'skills');
const curated = new Set([
  'auth', 'deployment', 'mcp-builder', 'media', 'security-audit', 'skill-creator',
  'sql', 'superpowers', 'ui-ux-pro-max', 'visualization', 'web', 'writing-guidelines',
]);

function stat(path) {
  try { return lstatSync(path); } catch { return null; }
}
function warn(message) {
  console.warn('sync-claude-skills: ' + message);
}
function unlinkEntry(path) {
  // On directories created by the old mirror, remove only the generated copy.
  // A symbolic link / junction is removed as an entry; never traverse its target.
  rmSync(path, {recursive: true, force: true});
}
if (!existsSync(source)) {
  warn('source missing; nothing changed');
  process.exit(0);
}

try {
  const srcNames = new Set(readdirSync(source, {withFileTypes: true})
    .filter(entry => entry.isDirectory() && existsSync(join(source, entry.name, 'SKILL.md')))
    .map(entry => entry.name));
  const unexpected = [...srcNames].filter(name => !curated.has(name));
  if (unexpected.length) warn('unregistered Skill roots ignored: ' + unexpected.join(', '));
  const missing = [...curated].filter(name => !srcNames.has(name));
  if (missing.length) warn('curated Skill roots missing: ' + missing.join(', '));
  const wanted = [...curated].filter(name => srcNames.has(name));

  const destState = stat(dest);
  if (destState?.isSymbolicLink()) {
    // Whole-folder links are not reliably discovered by Claude. Replace only
    // the alias, never any directory behind it.
    let target;
    try { target = realpathSync(dest); } catch {}
    if (target && target !== realpathSync(source)) {
      warn('existing .claude/skills points elsewhere; preserving it');
      process.exit(0);
    }
    unlinkEntry(dest);
  } else if (destState && !destState.isDirectory()) {
    warn('destination is not a skill directory; preserving it');
    process.exit(0);
  }
  mkdirSync(dest, {recursive: true});
  let removed = 0;
  let linked = 0;
  let unchanged = 0;
  let warnings = 0;

  for (const name of readdirSync(dest)) {
    if (wanted.includes(name)) continue;
    const path = join(dest, name);
    const entry = stat(path);
    if (entry?.isSymbolicLink() || (entry?.isDirectory() && existsSync(join(path, 'SKILL.md')))) {
      try { unlinkEntry(path); removed++; }
      catch (error) { warn('cannot prune ' + name + ': ' + error.message); warnings++; }
    }
  }
  for (const name of wanted) {
    const target = join(source, name);
    const link = join(dest, name);
    const entry = stat(link);
    if (entry?.isSymbolicLink()) {
      try { if (realpathSync(link) === realpathSync(target)) { unchanged++; continue; } }
      catch {}
      unlinkEntry(link);
    } else if (entry) {
      if (!entry.isDirectory() || !existsSync(join(link, 'SKILL.md'))) {
        warn('unmanaged entry blocks ' + name + '; preserving it'); warnings++; continue;
      }
      unlinkEntry(link); // stale, generated real-directory copy
    }
    try {
      symlinkSync(process.platform === 'win32' ? target : relative(dest, target),
        link, process.platform === 'win32' ? 'junction' : 'dir');
      linked++;
    } catch (error) { warn('cannot link ' + name + ': ' + error.message); warnings++; }
  }
  console.log('sync-claude-skills: ' + wanted.length + ' curated skills; ' + linked +
    ' linked, ' + unchanged + ' unchanged, ' + removed + ' obsolete entries removed, ' + warnings + ' warnings');
} catch (error) {
  warn(String(error.message || error));
  // A local link issue must not make npm install fail.
}
