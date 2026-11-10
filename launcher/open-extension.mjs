// PM Codex — Connect to Claude, the second half. Run by connect.js after
// bridge/tools/build-mcpb.mjs has made pm-codex-bridge.mcpb.
//
// Opens the extension with the Claude desktop app, which shows its install
// window. Whatever happens, it also prints the manual way in, because "the
// system accepted the file" is not proof that a window appeared.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT, say, openFile } from './lib.mjs';

const file = path.join(ROOT, 'pm-codex-bridge.mcpb');
const byHand = `in Claude desktop open Settings → Extensions → Advanced settings → Install Extension, and choose this file: ${file}`;

if (!existsSync(file)) {
  say('the extension was not made (see the lines above). Run Install or Update, then click Connect to Claude again.');
  process.exit(1);
}

if (openFile(file)) {
  say('Claude desktop should now show an install window. Click Install. Then start a new Claude conversation and say: Start a PM Codex session.');
  say(`If no window appeared, ${byHand}`);
} else {
  say('could not open the extension. Install the Claude desktop app (claude.ai/download), then click Connect to Claude again.');
  say(`If Claude desktop is already installed, ${byHand}`);
}
