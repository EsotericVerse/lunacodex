#!/usr/bin/env node
// Points this clone at .githooks so pre-push guards actually run.
//
// Why: .githooks/pre-push runs check-bulk-delete.mjs, which blocks an
// unconfirmed mass delete/rename. git only calls it when core.hooksPath
// is set, which is per-clone and manual — so by default the guard did
// not exist for anyone who had not run the config command by hand.
//
// Runs from the `prepare` script on npm install. It must never fail an
// install: no git, no work tree, or a hooksPath the user chose on
// purpose are all reasons to leave things alone and exit 0.

import {execFileSync} from 'node:child_process';

const HOOKS_PATH = '.githooks';

function git(args) {
  return execFileSync('git', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
}

function tryGit(args) {
  try {
    return git(args);
  } catch {
    return null;
  }
}

if (tryGit(['rev-parse', '--is-inside-work-tree']) !== 'true') {
  // Installed from a tarball, a Docker layer without .git, or no git binary.
  process.exit(0);
}

const current = tryGit(['config', '--local', '--get', 'core.hooksPath']);

if (current === HOOKS_PATH) {
  process.exit(0);
}

if (current) {
  console.warn(
    `setup-git-hooks: core.hooksPath is "${current}", leaving it alone. ` +
      `Pre-push guards in ${HOOKS_PATH} will not run unless you point it there.`,
  );
  process.exit(0);
}

if (tryGit(['config', '--local', 'core.hooksPath', HOOKS_PATH]) === null) {
  console.warn(`setup-git-hooks: could not set core.hooksPath to ${HOOKS_PATH}; skipping.`);
  process.exit(0);
}

console.log(`setup-git-hooks: core.hooksPath -> ${HOOKS_PATH} (pre-push guards enabled)`);
