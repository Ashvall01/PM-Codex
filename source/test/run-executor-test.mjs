#!/usr/bin/env node
/**
 * Runner for test/acr-executor.test.mjs.
 *
 * The executor is TypeScript and imports the app's Zustand stores, which in
 * turn reach for `localStorage`. Node has neither, so this script:
 *
 *   1. compiles the executor and the stores it needs into a scratch folder,
 *   2. puts a small in-memory `localStorage` in place,
 *   3. runs the checks against the real stores.
 *
 * Nothing here is part of the built app. It is a local check only.
 *
 *   cd source && node test/run-executor-test.mjs
 */
import { execFileSync } from 'node:child_process';
import {
  mkdirSync, rmSync, cpSync, writeFileSync, readFileSync, readdirSync,
  existsSync, symlinkSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
// Built in the system temp folder, not in the project: nothing to clean up,
// nothing to add to an upload by accident.
const out = join(tmpdir(), 'pm-codex-executor-test');

try { rmSync(out, { recursive: true, force: true }); } catch { /* fine */ }
mkdirSync(out, { recursive: true });

// The stores import `zustand`. Node resolves a bare name by walking up from the
// importing file, so the build folder needs the project's packages beside it.
const linkedModules = join(out, 'node_modules');
if (!existsSync(linkedModules)) {
  try { symlinkSync(join(root, 'node_modules'), linkedModules, 'dir'); }
  catch (err) { console.log('Could not link node_modules:', err.message); }
}

console.log('Compiling the executor and its stores…');
try {
  execFileSync(
    'npx',
    [
      'tsc',
      'src/services/acrExecutor.ts',
      'src/services/momActionPush.ts',
      '--outDir', out,
      '--module', 'esnext',
      '--target', 'es2022',
      '--moduleResolution', 'bundler',
      '--skipLibCheck',
      '--allowSyntheticDefaultImports',
    ],
    { cwd: root, stdio: 'inherit' },
  );
} catch {
  // tsc reports type errors from the app's own files here; the JavaScript is
  // still emitted, which is all this check needs.
  console.log('(type warnings above are from app files, output was still written)');
}

// TypeScript emits extension-less relative imports ("../store/tasksStore").
// A browser bundler resolves those; Node's ESM loader does not. Add the
// extension so the compiled output can simply be run.
const addExtensions = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { addExtensions(full); continue; }
    if (!entry.name.endsWith('.js')) continue;
    const src = readFileSync(full, 'utf8')
      .replace(
        /(from\s+['"])(\.[^'"]*?)(['"])/g,
        (m, a, path, z) => (path.endsWith('.js') ? m : `${a}${path}.js${z}`),
      )
      // `import.meta.env` is Vite's, not Node's. The stores read a couple of
      // build-time settings from it; an empty object is the right answer here.
      .replace(/import\.meta\.env/g, '(globalThis.__VITE_ENV__)');
    writeFileSync(full, src);
  }
};
addExtensions(out);

// A localStorage the stores can use. Zustand's persist middleware looks for it
// on the global object at import time.
const shim = `
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
`;
writeFileSync(join(out, 'shim.mjs'), shim);

cpSync(join(here, 'acr-executor.test.mjs'), join(out, 'acr-executor.test.mjs'));
writeFileSync(
  join(out, 'entry.mjs'),
  "import './shim.mjs';\nawait import('./acr-executor.test.mjs');\n",
);

console.log('Running the checks…\n');
execFileSync('node', [join(out, 'entry.mjs')], { cwd: root, stdio: 'inherit' });
