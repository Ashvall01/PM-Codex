#!/usr/bin/env node
/**
 * Runner for test/sync-roundtrip.test.mjs.
 *
 * Same approach as run-executor-test.mjs: compile the sync service and the
 * stores it reads into the system temp folder, put an in-memory localStorage in
 * place, then run the checks against the real code. The Google Sheet is a
 * stand-in inside the test file. Nothing here is part of the built app.
 *
 *   cd source && node test/run-sync-test.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, cpSync, writeFileSync, readFileSync, readdirSync, existsSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(tmpdir(), 'pm-codex-sync-test');

try { rmSync(out, { recursive: true, force: true }); } catch { /* fine */ }
mkdirSync(out, { recursive: true });
const linkedModules = join(out, 'node_modules');
if (!existsSync(linkedModules)) {
  try { symlinkSync(join(root, 'node_modules'), linkedModules, 'dir'); }
  catch (err) { console.log('Could not link node_modules:', err.message); }
}

console.log('Compiling the sync service and its stores…');
try {
  execFileSync('node', [
    join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
    'src/services/gasSyncService.ts',
    'src/store/syncQueueStore.ts',
    '--outDir', out,
    '--module', 'esnext',
    '--target', 'es2022',
    '--moduleResolution', 'bundler',
    '--skipLibCheck',
    '--allowSyntheticDefaultImports',
  ], { cwd: root, stdio: 'inherit' });
} catch {
  console.log('(type warnings above are from app files, output was still written)');
}

// Node's ESM loader needs the extension on relative imports, static and dynamic.
const addExtensions = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') addExtensions(full); continue; }
    if (!entry.name.endsWith('.js')) continue;
    const fix = (m, a, path, z) => (path.endsWith('.js') ? m : `${a}${path}.js${z}`);
    const src = readFileSync(full, 'utf8')
      .replace(/(from\s+['"])(\.[^'"]*?)(['"])/g, fix)
      .replace(/(import\(\s*['"])(\.[^'"]*?)(['"])/g, fix)
      .replace(/import\.meta\.env/g, '(globalThis.__VITE_ENV__)');
    writeFileSync(full, src);
  }
};
addExtensions(out);

writeFileSync(join(out, 'shim.mjs'), `
globalThis.__VITE_ENV__ = {};
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
globalThis.window = globalThis.window || globalThis;
if (!globalThis.crypto) globalThis.crypto = (await import('node:crypto')).webcrypto;
`);
cpSync(join(here, 'sync-roundtrip.test.mjs'), join(out, 'sync-roundtrip.test.mjs'));
writeFileSync(join(out, 'entry.mjs'), "import './shim.mjs';\nawait import('./sync-roundtrip.test.mjs');\n");

console.log('Running the checks…\n');
execFileSync('node', [join(out, 'entry.mjs')], { cwd: root, stdio: 'inherit', env: { ...process.env, TZ: 'Asia/Jakarta' } });
