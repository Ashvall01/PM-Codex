/**
 * Live check: drives the real bridge against a real PM Codex tab.
 *
 * Run this with the app open in a browser. Unlike test/e2e.mjs (which fakes the
 * app), this proves the actual browser client answers correctly.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not .pathname — the project path contains a space, which
// .pathname hands back percent-encoded and node then cannot resolve.
const SERVER = fileURLToPath(new URL('../server.mjs', import.meta.url));

const proc = spawn('node', [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
proc.stderr.on('data', (d) => process.stdout.write(`[server] ${d.toString().trim()}\n`));

let buffer = '';
const waiters = new Map();
proc.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    const w = waiters.get(msg.id);
    if (w) { waiters.delete(msg.id); w(msg); }
  }
});

let rpcId = 0;
const rpc = (method, params) => new Promise((resolve, reject) => {
  const id = ++rpcId;
  const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), 25000);
  waiters.set(id, (m) => { clearTimeout(timer); resolve(m); });
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
const notify = (method, params) =>
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');

const call = async (name, args = {}) => {
  const r = await rpc('tools/call', { name, arguments: args });
  return { text: r?.result?.content?.map((c) => c.text).join('\n') ?? '', isError: !!r?.result?.isError };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await sleep(600);
await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'live', version: '1' } });
notify('notifications/initialized');

process.stdout.write('\nWaiting for the PM Codex tab to connect (reload it if this hangs)…\n');
let connected = false;
for (let i = 0; i < 40; i++) {
  const s = await call('bridge_status');
  if (/"appConnected": true/.test(s.text)) { connected = true; break; }
  await sleep(1000);
}

if (!connected) {
  console.log('\nNo tab connected. Open the app and reload, then run this again.');
  proc.kill();
  process.exit(1);
}

console.log('Tab connected.\n');

for (const [label, name, args] of [
  ['bridge_status', 'bridge_status', {}],
  ['get_current_screen', 'get_current_screen', {}],
  ['list_projects', 'list_projects', {}],
  ['start_session', 'start_session', {}],
  ['search_project("a")', 'search_project', { query: 'a' }],
]) {
  const r = await call(name, args);
  const body = r.text.length > 600 ? r.text.slice(0, 600) + `\n… [${r.text.length} chars total]` : r.text;
  console.log(`──────── ${label} ${r.isError ? '(ERROR)' : ''}\n${body}\n`);
}

proc.kill();
process.exit(0);
