#!/usr/bin/env node
/**
 * Runner for test/acr-diff.mjs — the shared old-versus-new comparison.
 *
 * The checks import the helper as ./acrDiff.mjs, so this compiles
 * src/utils/acrDiff.ts into a scratch folder, puts the checks beside it and
 * runs them. It replaces the copy-and-paste steps that used to sit in that
 * file's header, which only worked in a Unix shell.
 *
 *   cd source && node test/run-acr-diff-test.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const TSC = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const out = join(tmpdir(), 'pm-codex-acr-diff-test');
try { rmSync(out, { recursive: true, force: true }); } catch { /* fine */ }
mkdirSync(out, { recursive: true });

try {
  execFileSync('node', [
    TSC, 'src/utils/acrDiff.ts', '--outDir', out,
    '--module', 'esnext', '--target', 'es2020', '--moduleResolution', 'bundler', '--skipLibCheck',
  ], { cwd: root, stdio: 'inherit' });
} catch {
  // Type notes from files the helper imports; the JavaScript is still written.
  console.log('(type warnings above are from app files, output was still written)');
}

// tsc keeps the folder shape when the helper imports from beside itself.
const built = [join(out, 'utils', 'acrDiff.js'), join(out, 'acrDiff.js')].find(existsSync);
if (!built) { console.error('acrDiff.ts did not compile to a file this runner knows.'); process.exit(1); }
cpSync(built, join(out, 'acrDiff.mjs'));
cpSync(join(here, 'acr-diff.mjs'), join(out, 'acr-diff.mjs'));
execFileSync('node', [join(out, 'acr-diff.mjs')], { stdio: 'inherit' });
