#!/usr/bin/env node
/**
 * Runner for test/sheet-engine.test.ts: compiles the formula engine and the
 * checks with the project's TypeScript into the system temp folder, then runs
 * them. Nothing here is part of the built app.
 *
 *   cd source && node test/run-sheet-engine-test.mjs
 */
import { execFileSync } from 'node:child_process';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), 'pm-codex-sheet-test');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'package.json'), '{"type":"commonjs"}');
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync('node', [
  tsc, join(root, 'test', 'sheet-engine.test.ts'),
  '--outDir', out, '--rootDir', root, '--module', 'commonjs', '--moduleResolution', 'node',
  '--target', 'es2022', '--skipLibCheck', '--esModuleInterop', '--lib', 'es2022,dom',
], { stdio: 'inherit' });
execFileSync('node', [join(out, 'test', 'sheet-engine.test.js')], { stdio: 'inherit' });
