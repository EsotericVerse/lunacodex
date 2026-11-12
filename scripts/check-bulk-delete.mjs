import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

// Local, zero-cost safety net: refuse to push a range of commits that
// nets out to deleting/renaming a large number of files, without
// explicit confirmation. This exists because a commit (or a push made of
// several small commits) can look "clean" while still being a mass
// deletion that was never confirmed with the user — see AGENTS.md
// §溝通節奏, stop-condition 4/5.
//
// Enable once per clone: git config core.hooksPath .githooks
//
// IMPORTANT, known limits (see AGENTS.md discussion): this is a client-
// side hook. It does not stop `git push --no-verify`, and the override
// tag below is self-asserted by whoever is pushing — it raises the bar
// against an unconfirmed mass delete happening by default, it does not
// make bypass technically impossible.
//
// Threshold is checked on the NET diff across the whole push range (base
// ref..tip), not per commit — so splitting a large deletion into many
// small commits in one push does not evade it.

const THRESHOLD = 30;
const OVERRIDE_TAG = '[bulk-delete-ok]';

function sh(args) {
  return execFileSync('git', args, {encoding: 'utf8'}).trim();
}

function hasCommit(revision) {
  try {
    sh(['cat-file', '-e', `${revision}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function pushRanges() {
  // Reads "<local ref> <local sha> <remote ref> <remote sha>" lines from
  // stdin, as git feeds a pre-push hook. Falls back to HEAD vs its
  // upstream when run manually (no stdin / not a real push).
  let input = '';
  try {
    input = readFileSync(0, 'utf8');
  } catch {}
  const lines = input.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) {
    try {
      const upstream = sh(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
      return [{base: upstream, tip: 'HEAD'}];
    } catch {
      return [];
    }
  }
  const ranges = [];
  for (const line of lines) {
    const [, localSha, , remoteSha] = line.split(/\s+/);
    if (!localSha || /^0+$/.test(localSha)) continue; // deleting a remote ref
    const base = remoteSha && !/^0+$/.test(remoteSha) ? remoteSha : null;
    ranges.push({base, tip: localSha});
  }
  return ranges;
}

let blocked = false;
for (const {base, tip} of pushRanges()) {
  if (!hasCommit(tip)) {
    blocked = true;
    console.error(`\nBLOCKED: local push commit ${tip} is unavailable. Refresh the Git repository before pushing.`);
    continue;
  }
  if (base && !hasCommit(base)) {
    // GitHub Desktop may know the remote SHA from its push handshake while
    // the corresponding commit object is still missing from the local clone.
    // Never treat that unknown range as an empty diff or bypass the D/R guard.
    blocked = true;
    console.error(`\nBLOCKED: remote commit ${base} is not yet in this local repository.`);
    console.error('  GitHub Desktop: Fetch origin, then Pull origin (resolve conflicts if prompted), then Push origin.');
    console.error('  No files were deleted by this check. Do not force-push or bypass the hook.');
    continue;
  }
  let status;
  try {
    if (base) {
      status = sh(['diff', '--name-status', `${base}..${tip}`]);
    } else {
      // New branch with no remote base: compare the complete tree to empty.
      status = sh(['diff', '--name-status', sh(['hash-object', '-t', 'tree', '/dev/null']), tip]);
    }
  } catch (error) {
    blocked = true;
    console.error(`\nBLOCKED: cannot inspect the push diff (${base || 'empty'}..${tip}).`);
    console.error('  Fetch/Pull origin in GitHub Desktop and retry. Bulk-deletion protection remains enabled.');
    continue;
  }
  const touched = status.split('\n').filter((l) => /^[DR]/.test(l));
  if (touched.length <= THRESHOLD) continue;

  const commitList = base ? `${base}..${tip}` : tip;
  let messages = '';
  try {
    messages = sh(['log', '--format=%B%x00', commitList]);
  } catch {
    messages = sh(['log', '-1', '--format=%B', tip]);
  }
  if (messages.includes(OVERRIDE_TAG)) {
    console.log(`check-bulk-delete: ${commitList} nets ${touched.length} D/R files, has ${OVERRIDE_TAG}, allowed.`);
    continue;
  }

  blocked = true;
  console.error(`\nBLOCKED: push range ${commitList} nets ${touched.length} deleted/renamed files (threshold: ${THRESHOLD}).`);
  console.error(`  AGENTS.md 溝通節奏 stop-condition 4: this scale of deletion must be confirmed with the user before pushing.`);
  console.error(`  Checked net across the whole push range, not per commit — splitting it into smaller commits does not change this result.`);
  console.error(`  If the user has already confirmed this, add "${OVERRIDE_TAG}" to a commit message in the range and push again.\n`);
}

if (blocked) process.exitCode = 1;
else console.log('check-bulk-delete: push range net D/R count within threshold.');
