// Checks the Claude extension builder and the bridge's local-app settings.
// PLAN.md section 22.15.   node test/mcpb-test.mjs   (from bridge/)
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, cpSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BRIDGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name} ${extra}`); } };

const dir = mkdtempSync(path.join(tmpdir(), 'mcpb-'));
const out = path.join(dir, 'test.mcpb');
try {
  execFileSync(process.execPath, [path.join(BRIDGE, 'tools', 'build-mcpb.mjs'), out], { env: { ...process.env, PM_CODEX_PORT: '7811' }, stdio: 'pipe' });
  // Read back with a program that is not ours: unzip where there is one (macOS,
  // Linux), else the tar that ships with Windows 10 and later, which reads zips.
  const have = (cmd, args) => { try { execFileSync(cmd, args, { stdio: 'pipe' }); return true; } catch { return false; } };
  const reader = have('unzip', ['-v'])
    ? { test: () => execFileSync('unzip', ['-tq', out], { stdio: 'pipe' }), read: () => execFileSync('unzip', ['-p', out, 'manifest.json']) }
    : { test: () => execFileSync('tar', ['-tf', out], { stdio: 'pipe' }), read: () => execFileSync('tar', ['-xOf', out, 'manifest.json']) };
  let zipOk = true;
  try { reader.test(); } catch { zipOk = false; }
  check('the extension is a valid zip', zipOk);
  const m = JSON.parse(reader.read().toString());
  const server = path.join(BRIDGE, 'server.mjs');
  check('entry_point is this copy\'s server.mjs', m.server.entry_point === server, m.server.entry_point);
  check('mcp_config runs the same file', m.server.mcp_config.args[0] === server);
  check('the app port is passed to the bridge', m.server.mcp_config.env?.PM_CODEX_PORT === '7811');
  check('the Node that built it is passed to the bridge, for starting the hub', m.server.mcp_config.env?.PM_CODEX_NODE === process.execPath, m.server.mcp_config.env?.PM_CODEX_NODE);
  const pkg = JSON.parse(readFileSync(path.join(BRIDGE, 'package.json'), 'utf8'));
  check('version comes from package.json', m.version === pkg.version, m.version);
  check('no placeholder is left', !JSON.stringify(m).includes('{{'));
  const src = readFileSync(path.join(BRIDGE, 'server.mjs'), 'utf8');
  const registered = [...src.matchAll(/registerTool\(\s*'([a-z_]+)'/g)].map((x) => x[1]).sort();
  const listed = m.tools.map((t) => t.name).sort();
  check('the manifest lists exactly the tools server.mjs registers', JSON.stringify(registered) === JSON.stringify(listed), `server: ${registered.join(',')} manifest: ${listed.join(',')}`);
  check('the server registers 13 tools', registered.length === 13, String(registered.length));

  // A copy with no packages must not leave an old extension behind to be opened.
  const bare = path.join(dir, 'bare');
  cpSync(BRIDGE, path.join(bare, 'bridge'), { recursive: true, filter: (src) => !/[\\/]node_modules([\\/]|$)/.test(src) && !src.endsWith('bridge.log') });
  const stale = path.join(dir, 'stale.mcpb');
  writeFileSync(stale, 'old');
  let refused = false;
  try { execFileSync(process.execPath, [path.join(bare, 'bridge', 'tools', 'build-mcpb.mjs'), stale], { stdio: 'pipe' }); } catch { refused = true; }
  check('a bridge that is not installed makes no extension, and clears an old one', refused && !existsSync(stale));

  const cfg = (port) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
    "import('./config.mjs').then((c) => console.log(JSON.stringify({ origins: c.loadConfig().allowedOrigins, protocol: c.HUB_PROTOCOL })))"],
    { cwd: BRIDGE, env: { ...process.env, PM_CODEX_PORT: port } }).toString());
  const d = cfg('');
  check('by default the bridge accepts only the local app on 7800', JSON.stringify(d.origins) === JSON.stringify(['http://localhost:7800', 'http://127.0.0.1:7800']), JSON.stringify(d.origins));
  const p = cfg('7811');
  check('PM_CODEX_PORT moves the accepted address with it', p.origins.includes('http://localhost:7811') && !p.origins.includes('http://localhost:7800'));
  check('no AI Studio address is accepted', !d.origins.some((o) => /aistudio|run\.app/.test(o)));
  check('HUB_PROTOCOL is 6 (stands down the pre-Windows hub)', d.protocol === 6);
} catch (e) {
  fail++; console.log('  FAIL unexpected error:', e.message);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
