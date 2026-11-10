// PM Codex — Update, the git part. Run by update.js.
//
//   node launcher/update.mjs         get the newest code
//   node launcher/update.mjs done    the closing note, after the rebuild
//
// After "Go back to last good version" the copy sits on a tag, not a branch;
// Update returns it to main first. A branch chosen in GitHub Desktop is left as
// it is. If the download fails (a private copy that needs a sign-in, or no
// network) this says so and still ends well, so the rebuild steps that follow
// run anyway — pull in GitHub Desktop, then run Update again.

import { git, say } from './lib.mjs';

if (process.argv[2] === 'done') {
  say('updated. Start the app again. If Claude is connected, quit and reopen the Claude desktop app so it uses the new bridge.');
  process.exit(0);
}

const onABranch = git(['symbolic-ref', '-q', 'HEAD']).ok;
let ok = onABranch || git(['checkout', '--quiet', 'main'], { show: true }).ok;
if (ok) ok = git(['pull', '--ff-only'], { show: true }).ok;
if (!ok) {
  say('could not download updates here. If this copy came from GitHub Desktop, click Fetch origin / Pull there, then run Update again.');
}
