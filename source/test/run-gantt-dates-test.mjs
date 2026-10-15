#!/usr/bin/env node
/**
 * Checks for src/features/Timeline/ganttDates.ts — the date rules every
 * position on the Gantt chart is built from.
 *
 * Compiles the one file into the system temp folder and runs the checks twice:
 * in Jakarta (UTC+7, where the user is and where a stored timestamp lands on
 * the next calendar day) and in New York (UTC-4 in September), so a rule that
 * only works in one time zone fails here.
 *
 *   cd source && node test/run-gantt-dates-test.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(tmpdir(), 'pm-codex-gantt-dates-test');
try { rmSync(out, { recursive: true, force: true }); } catch { /* fine */ }
mkdirSync(out, { recursive: true });

execFileSync('npx', ['tsc', 'src/features/Timeline/ganttDates.ts', '--outDir', out,
  '--module', 'esnext', '--target', 'es2022', '--skipLibCheck'], { cwd: root, stdio: 'inherit' });
writeFileSync(join(out, 'package.json'), '{"type":"module"}');
cpSync(join(here, 'gantt-dates.test.mjs'), join(out, 'gantt-dates.test.mjs'));

let failed = false;
for (const tz of ['Asia/Jakarta', 'America/New_York']) {
  console.log(`\n--- TZ=${tz}`);
  try {
    execFileSync('node', [join(out, 'gantt-dates.test.mjs')], { stdio: 'inherit', env: { ...process.env, TZ: tz } });
  } catch { failed = true; }
}
process.exit(failed ? 1 : 0);
