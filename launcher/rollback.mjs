// PM Codex — Go back to the last good version, the git part. Run by rollback.js.
//
// Checks out the newest version tagged as verified live (v…-live). Update
// brings the copy back to the newest version.
//
// On Windows a version from before Windows support cannot be used: its Update
// button is Unix shell, so there would be no way forward again. Those tags are
// skipped there (a tag counts when it holds launcher/update.mjs).

import { git, say, PLATFORM } from './lib.mjs';

const listed = git(['tag', '-l', 'v*-live', '--sort=-v:refname']);
const tags = listed.out.split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
const usable = PLATFORM === 'win32'
  ? tags.filter((t) => git(['cat-file', '-e', `${t}:launcher/update.mjs`]).ok)
  : tags;

if (!usable.length) {
  say(tags.length
    ? 'there is no known-good version that runs on Windows yet. Nothing changed.'
    : 'there is no known-good version yet. Nothing changed.');
} else if (git(['checkout', '--quiet', usable[0]], { show: true }).ok) {
  say(`now on ${usable[0]}. Restart the app. Update brings you back to the newest version.`);
} else {
  say(`could not switch to ${usable[0]}. Nothing changed.`);
}
