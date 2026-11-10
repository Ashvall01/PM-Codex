// PM Codex — Reset. Run by reset.js.
//
// Removes the installed packages and the build, so Install starts clean. The
// Gemini key (secrets/, or ENVIRONMENT on older installs) and the data (the
// Google Sheet) are not touched.

import { rmSync } from 'node:fs';
import path from 'node:path';
import { ROOT, say } from './lib.mjs';

const failed = [];
for (const folder of ['source/node_modules', 'source/dist', 'bridge/node_modules']) {
  try {
    // Windows holds a file open while a program is using it; a few retries
    // ride out a virus scanner or an indexer passing through.
    rmSync(path.join(ROOT, folder), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (e) {
    failed.push(`${folder} (${e.code || e.message})`);
  }
}

if (failed.length) {
  say(`could not remove ${failed.join(', ')}. Stop PM Codex, quit the Claude desktop app, then click Reset again.`);
  process.exit(1);
}
say('reset done. Click Install.');
