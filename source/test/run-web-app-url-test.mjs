#!/usr/bin/env node
/**
 * Checks src/utils/webAppUrl.ts: which pasted addresses the setup wizard and
 * Settings accept as "the Apps Script web app".
 *
 *   cd source && node test/run-web-app-url-test.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TSC = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const out = join(tmpdir(), 'pm-codex-web-app-url-test');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync('node', [TSC, 'src/utils/webAppUrl.ts', '--outDir', out, '--module', 'esnext', '--target', 'es2022', '--skipLibCheck'], { cwd: root, stdio: 'inherit' });
writeFileSync(join(out, 'package.json'), '{"type":"module"}');
const { checkWebAppUrl } = await import(pathToFileURL(join(out, 'webAppUrl.js')).href);

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name + (extra ? '  — ' + extra : '')); } };
const ID = 'AKfycbx-Example_0123456789abcdefghijklmnopqrstuvwxyz';
const good = `https://script.google.com/macros/s/${ID}/exec`;
const refused = (input, pattern) => { const r = checkWebAppUrl(input); return r.ok === false && pattern.test(r.message); };

ok('the web app address is accepted', checkWebAppUrl(good).ok === true && checkWebAppUrl(good).url === good);
ok('spaces and a line break around it are ignored', checkWebAppUrl(`  ${good}\n`).url === good);
ok('a query or a trailing slash pasted along is dropped', checkWebAppUrl(`${good}/?action=version&t=1#x`).url === good, checkWebAppUrl(`${good}/?action=version`).url);
ok('a Workspace address (a/macros/<domain>) is accepted', checkWebAppUrl(`https://script.google.com/a/macros/example.com/s/${ID}/exec`).ok === true);
ok('the older Workspace form (a/<domain>/macros) is accepted', checkWebAppUrl(`https://script.google.com/a/example.com/macros/s/${ID}/exec`).ok === true);
ok('nothing pasted: asks for it', refused('   ', /Paste the web app address/));
ok('not an address at all', refused('my sheet', /not a web address/));
ok('the Sheet\'s own address is named as such', refused('https://docs.google.com/spreadsheets/d/1AbC/edit#gid=0', /address of the Sheet itself/));
ok('the script editor\'s address is refused', refused('https://script.google.com/home/projects/1AbC/edit', /not the web app/));
ok('the /dev test address is explained', refused(`https://script.google.com/macros/s/${ID}/dev`, /test address/));
ok('http is refused', refused(`http://script.google.com/macros/s/${ID}/exec`, /https/));
ok('another site is refused, whatever its path', refused(`https://example.com/macros/s/${ID}/exec`, /only to your own Google Apps Script/));
ok('a look-alike host is refused', refused(`https://script.google.com.example.com/macros/s/${ID}/exec`, /only to your own/));
ok('a host hidden behind a user name is refused', refused(`https://script.google.com@example.com/macros/s/${ID}/exec`, /only to your own/));
ok('every refusal says where to find the right one', [
  'https://docs.google.com/spreadsheets/d/1/edit', 'https://script.google.com/home', 'https://example.com/x', 'nonsense',
].every((u) => /Manage deployments/.test(checkWebAppUrl(u).message)));

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
