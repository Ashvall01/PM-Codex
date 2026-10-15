#!/usr/bin/env node
/**
 * Runner for test/field-schema.test.mjs.
 *
 * Same shape as run-executor-test.mjs, for the same reason: fieldSchema.ts is
 * TypeScript and pulls in risksStore.ts, a real Zustand store that reaches for
 * localStorage at import time. Node has neither compiled output nor
 * localStorage, so this script:
 *
 *   1. compiles fieldSchema.ts and what it imports into a scratch folder,
 *   2. puts a small in-memory localStorage in place,
 *   3. runs the checks against the real module.
 *
 * Nothing here is part of the built app. It is a local check only.
 *
 *   cd source && node test/run-field-schema-test.mjs
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
const out = join(tmpdir(), 'pm-codex-field-schema-test');

try { rmSync(out, { recursive: true, force: true }); } catch { /* fine */ }
mkdirSync(out, { recursive: true });

const linkedModules = join(out, 'node_modules');
if (!existsSync(linkedModules)) {
  try { symlinkSync(join(root, 'node_modules'), linkedModules, 'dir'); }
  catch (err) { console.log('Could not link node_modules:', err.message); }
}

console.log('Compiling fieldSchema.ts and its imports…');
try {
  execFileSync(
    'npx',
    [
      'tsc',
      'src/services/fieldSchema.ts',
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
  console.log('(type warnings above are from app files, output was still written)');
}

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
      .replace(/import\.meta\.env/g, '(globalThis.__VITE_ENV__)');
    writeFileSync(full, src);
  }
};
addExtensions(out);

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

cpSync(join(here, 'field-schema.test.mjs'), join(out, 'field-schema.test.mjs'));
writeFileSync(
  join(out, 'entry.mjs'),
  "import './shim.mjs';\nawait import('./field-schema.test.mjs');\n",
);

console.log('Running the checks…\n');
execFileSync('node', [join(out, 'entry.mjs')], { cwd: root, stdio: 'inherit' });
