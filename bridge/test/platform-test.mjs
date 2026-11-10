// Checks the parts of the bridge that differ between macOS and Windows: where
// the hub listens for the MCP servers, and which program starts the hub.
// PLAN.md, "Windows".   node test/platform-test.mjs   (from bridge/)
//
// The Windows answers are worked out here on any system. Whether a real named
// pipe carries the traffic is e2e.mjs's job, run on Windows by the GitHub check.
import { hubSocketPath, isNamedPipe, looksLikeNode, nodeCandidates } from '../config.mjs';

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name} ${extra}`); } };

// ---- the hub's address
const mac = hubSocketPath({}, 'darwin');
check('macOS: a socket file in /tmp, as before', /^\/tmp\/pm-codex-bridge-[\w-]+\.sock$/.test(mac), mac);
check('macOS: the address is a file', !isNamedPipe(mac));
const win = hubSocketPath({}, 'win32');
check('Windows: a named pipe', /^\\\\\.\\pipe\\pm-codex-bridge-[a-z0-9_-]+$/.test(win), win);
check('Windows: the address is not a file', isNamedPipe(win));
check('a pipe name holds nothing a pipe cannot (no space, slash or colon after the prefix)', !/[\s/:]/.test(win.slice('\\\\.\\pipe\\'.length)), win);
check('config.json still overrides the address on any system', hubSocketPath({ hubSocketPath: '/x/y.sock' }, 'win32') === '/x/y.sock');
check('a \\\\?\\pipe\\ spelling is a pipe too', isNamedPipe('\\\\?\\pipe\\x'));
check('an ordinary Windows path is not a pipe', !isNamedPipe('C:\\Users\\a\\pipe\\x.sock'));

// ---- recognising node
check('node is node', looksLikeNode('/usr/local/bin/node'));
check('node.exe under backslashes is node', looksLikeNode('C:\\Program Files\\nodejs\\node.exe'));
check('NODE.EXE is node', looksLikeNode('C:\\x\\NODE.EXE'));
check('Claude Helper is not node', !looksLikeNode('/Applications/Claude.app/Contents/Frameworks/Claude Helper (Plugin).app/Contents/MacOS/Claude Helper (Plugin)'));
check('claude.exe is not node', !looksLikeNode('C:\\Users\\a\\AppData\\Local\\AnthropicClaude\\claude.exe'));
check('a folder named node does not make its program node', !looksLikeNode('C:\\node\\claude.exe'));

// ---- which program starts the hub
const HELPER = '/Applications/Claude.app/Contents/Frameworks/Claude Helper (Plugin).app/Contents/MacOS/Claude Helper (Plugin)';
const PINOKIO_MAC = '/Users/a/pinokio/bin/miniconda/bin/node';
const onMac = nodeCandidates({ execPath: HELPER, platform: 'darwin', env: { PM_CODEX_NODE: PINOKIO_MAC }, exists: (p) => p === PINOKIO_MAC });
check('macOS inside Claude: the Node that ran Connect to Claude comes first', onMac[0] === PINOKIO_MAC, onMac.join(' | '));
check('macOS inside Claude: the Claude helper is never started', !onMac.includes(HELPER), onMac.join(' | '));
check('macOS: the usual folders and PATH still follow', onMac.includes('/opt/homebrew/bin/node') && onMac.at(-1) === 'node');

const gone = nodeCandidates({ execPath: HELPER, platform: 'darwin', env: { PM_CODEX_NODE: '/moved/away/node' }, exists: () => false });
check('a recorded Node that is no longer there is skipped', !gone.includes('/moved/away/node'), gone.join(' | '));

const CLAUDE_WIN = 'C:\\Users\\a\\AppData\\Local\\AnthropicClaude\\claude.exe';
const PINOKIO_WIN = 'C:\\pinokio\\bin\\miniconda\\node.exe';
const SYSTEM_WIN = 'C:\\Program Files\\nodejs\\node.exe';
const onWin = nodeCandidates({
  execPath: CLAUDE_WIN, platform: 'win32',
  env: { PM_CODEX_NODE: PINOKIO_WIN, ProgramFiles: 'C:\\Program Files' },
  exists: (p) => p === PINOKIO_WIN || p === SYSTEM_WIN,
});
check('Windows inside Claude: the recorded Node comes first', onWin[0] === PINOKIO_WIN, onWin.join(' | '));
check('Windows: an installed Node in Program Files is tried', onWin.includes(SYSTEM_WIN), onWin.join(' | '));
check('Windows: no macOS folder is tried', !onWin.some((c) => c.startsWith('/')), onWin.join(' | '));
check('Windows: PATH, then Claude run as node, close the list', onWin.at(-2) === 'node' && onWin.at(-1) === CLAUDE_WIN, onWin.join(' | '));

const plain = nodeCandidates({ execPath: 'C:\\Program Files\\nodejs\\node.exe', platform: 'win32', env: {}, exists: () => false });
check('started by a real node: that node is used', plain[0] === 'C:\\Program Files\\nodejs\\node.exe', plain.join(' | '));
check('no program is listed twice', new Set(onWin).size === onWin.length && new Set(onMac).size === onMac.length);

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
