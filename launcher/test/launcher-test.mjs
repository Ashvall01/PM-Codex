// Checks the launcher scripts behind Pinokio's buttons: Update, Go back to last
// good version, Reset and Connect to Claude. PLAN.md, "Windows".
//
//   node launcher/test/launcher-test.mjs      (from the app folder)
//
// Each script is run as Pinokio runs it — a separate `node …` — against a
// throwaway folder (PM_CODEX_LAUNCHER_ROOT), with real git. Nothing here
// touches this copy of PM Codex, GitHub, or the Claude desktop app.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCommand } from '../lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LAUNCHER = path.resolve(HERE, '..');
const APP = path.resolve(LAUNCHER, '..');
const WINDOWS = process.platform === 'win32';

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name} ${extra}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A folder name with a space and an apostrophe: a Windows user folder is often
// "C:\Users\First Last", and that is where quoting goes wrong.
const TMP = mkdtempSync(path.join(tmpdir(), "pmc launcher o'test "));

const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
};
const run = (script, { root, args = [], env = {} } = {}) => {
  const r = spawnSync('node', [path.join(LAUNCHER, script), ...args], {
    encoding: 'utf8', env: { ...process.env, PM_CODEX_LAUNCHER_ROOT: root || TMP, ...env },
  });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};
const commit = (cwd, file, text, message) => {
  mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
  writeFileSync(path.join(cwd, file), text);
  git(cwd, 'add', '-A'); git(cwd, 'commit', '-q', '-m', message);
};

try {
  /* ------------------------------------------------ Pinokio's own lines */
  console.log('Pinokio lines');
  const require = createRequire(import.meta.url);
  const lines = [];
  for (const file of ['install.js', 'start.js', 'update.js', 'rollback.js', 'reset.js', 'connect.js']) {
    for (const step of require(path.join(APP, file)).run) {
      if (step.method !== 'shell.run') continue;
      for (const message of [].concat(step.params.message)) lines.push({ file, message });
    }
  }
  // Only a program and plain arguments. Anything else — a quote, &&, ||, $( ),
  // a redirect, a semicolon — reads differently in cmd.exe than in a Unix shell.
  const plain = /^(node|npm) [A-Za-z0-9 ./_-]+$/;
  const odd = lines.filter((l) => !plain.test(l.message));
  check(`all ${lines.length} Pinokio commands are plain "node …" / "npm …" lines`, lines.length >= 10 && odd.length === 0, odd.map((l) => `${l.file}: ${l.message}`).join(' | '));
  const scripts = lines.map((l) => l.message.match(/^node (\S+\.mjs)/)?.[1]).filter(Boolean);
  const missing = [...new Set(scripts)].filter((s) => !existsSync(path.join(APP, s.startsWith('launcher/') || s.startsWith('bridge/') ? s : path.join('source', s))));
  check('every script a button runs is in the repo', missing.length === 0, missing.join(', '));

  /* ---------------------------------------------------------- the opener */
  console.log('Opening the extension');
  const mac = openCommand('/Users/a b/pm-codex-bridge.mcpb', 'darwin');
  check('macOS opens with `open`', mac.command === 'open' && mac.args.length === 1 && mac.args[0] === '/Users/a b/pm-codex-bridge.mcpb');
  const winFile = "C:\\Users\\Jo O'Neil & Co\\pinokio\\api\\PM-Codex.git\\pm-codex-bridge.mcpb";
  const win = openCommand(winFile, 'win32');
  const decoded = Buffer.from(win.args.at(-1), 'base64').toString('utf16le');
  check('Windows opens through PowerShell, not cmd\'s `start`', win.command === 'powershell.exe' && win.args.includes('-EncodedCommand'));
  check('Windows: the path travels encoded, so no space, & or quote can split it', !win.args.some((a) => a.includes('Users')) && decoded.includes("-FilePath 'C:\\Users\\Jo O''Neil & Co\\pinokio"), decoded);
  check('Windows: a failure to open is an error, not silence', decoded.includes("$ErrorActionPreference = 'Stop'"));
  check('Linux opens with `xdg-open`', openCommand('/x', 'linux').command === 'xdg-open');

  const noFile = run('open-extension.mjs', { root: path.join(TMP, 'empty') });
  check('with no extension made, it says so and fails', noFile.status === 1 && /was not made/.test(noFile.out), noFile.out);

  // A real open. On Windows: the real opener on a .cmd file, whose "open" is to
  // run — it leaves a marker. Elsewhere: a stand-in `xdg-open` on PATH, so no
  // program on the developer's machine is disturbed.
  const openRoot = path.join(TMP, 'open root');
  mkdirSync(openRoot, { recursive: true });
  writeFileSync(path.join(openRoot, 'pm-codex-bridge.mcpb'), 'not a real extension');
  if (WINDOWS) {
    const { openFile } = await import('../lib.mjs');
    const cmd = path.join(openRoot, 'mark.cmd');
    const marker = path.join(openRoot, 'marker.txt');
    writeFileSync(cmd, '@echo off\r\necho opened> "%~dp0marker.txt"\r\n');
    const accepted = openFile(cmd);
    for (let i = 0; i < 60 && !existsSync(marker); i++) await sleep(250);
    check('Windows: the opener really opens a file in a folder with a space and an apostrophe', accepted && existsSync(marker));
    // Not a pass/fail: Windows may refuse an unknown file type or ask the user
    // what to open it with. Either is fine (the manual way in is always
    // printed); this line records which one this Windows does.
    writeFileSync(path.join(openRoot, 'nothing.pmcodex-no-such-type'), 'x');
    console.log(`  note Windows, a file type nothing is registered for: ${openFile(path.join(openRoot, 'nothing.pmcodex-no-such-type')) ? 'accepted (Windows asks the user)' : 'refused (reported as "could not open")'}`);
  } else {
    const bin = path.join(TMP, 'bin');
    mkdirSync(bin, { recursive: true });
    const marker = path.join(openRoot, 'marker.txt');
    writeFileSync(path.join(bin, 'xdg-open'), `#!/bin/sh\nprintf '%s' "$1" > "${marker.replaceAll('"', '\\"')}"\n`);
    chmodSync(path.join(bin, 'xdg-open'), 0o755);
    const opened = run('open-extension.mjs', { root: openRoot, env: { PM_CODEX_LAUNCHER_PLATFORM: 'linux', PATH: `${bin}${path.delimiter}${process.env.PATH}` } });
    check('the extension is handed to the system opener, whole path intact', opened.status === 0 && existsSync(marker) && readFileSync(marker, 'utf8') === path.join(openRoot, 'pm-codex-bridge.mcpb'), opened.out);
    check('it says what to do next, and the manual way in', /install window/.test(opened.out) && /Install Extension/.test(opened.out), opened.out);
    const failing = path.join(TMP, 'bin-fail');
    mkdirSync(failing, { recursive: true });
    writeFileSync(path.join(failing, 'xdg-open'), '#!/bin/sh\nexit 3\n');
    chmodSync(path.join(failing, 'xdg-open'), 0o755);
    const refused = run('open-extension.mjs', { root: openRoot, env: { PM_CODEX_LAUNCHER_PLATFORM: 'linux', PATH: `${failing}${path.delimiter}${process.env.PATH}` } });
    check('when the system cannot open it, it says to install Claude desktop', refused.status === 0 && /could not open the extension/.test(refused.out) && /Install Extension/.test(refused.out), refused.out);
  }

  /* -------------------------------------------------------------- Update */
  console.log('Update');
  const origin = path.join(TMP, 'origin');
  mkdirSync(origin);
  git(origin, 'init', '-q', '-b', 'main');
  commit(origin, 'app.txt', 'one\n', 'first');
  git(origin, 'tag', 'v1.0-live');
  const copy = path.join(TMP, 'installed copy');
  git(TMP, 'clone', '-q', origin, copy);
  commit(origin, 'app.txt', 'two\n', 'second');

  let r = run('update.mjs', { root: copy });
  check('Update downloads the newest code', r.status === 0 && readFileSync(path.join(copy, 'app.txt'), 'utf8').trim() === 'two', r.out);

  git(copy, 'checkout', '-q', 'v1.0-live');
  commit(origin, 'app.txt', 'three\n', 'third');
  r = run('update.mjs', { root: copy });
  check('from a tag (after Go back), Update returns to main and downloads', r.status === 0 && git(copy, 'rev-parse', '--abbrev-ref', 'HEAD') === 'main' && readFileSync(path.join(copy, 'app.txt'), 'utf8').trim() === 'three', r.out);

  git(origin, 'checkout', '-q', '-b', 'dev-test');
  commit(origin, 'app.txt', 'dev\n', 'dev work');
  git(origin, 'checkout', '-q', 'main');
  git(copy, 'fetch', '-q');
  git(copy, 'checkout', '-q', 'dev-test');
  r = run('update.mjs', { root: copy });
  check('a branch chosen by the user is left as it is', r.status === 0 && git(copy, 'rev-parse', '--abbrev-ref', 'HEAD') === 'dev-test', r.out);
  git(copy, 'checkout', '-q', 'main');

  const lonely = path.join(TMP, 'no remote');
  git(TMP, 'clone', '-q', origin, lonely);
  git(lonely, 'remote', 'set-url', 'origin', path.join(TMP, 'gone-away'));
  r = run('update.mjs', { root: lonely });
  check('when the download fails it says so and still ends well, so the rebuild runs', r.status === 0 && /could not download updates/.test(r.out), r.out);

  r = run('update.mjs', { root: copy, args: ['done'] });
  check('the closing note says to start again and reopen Claude', r.status === 0 && /Start the app again/.test(r.out) && /reopen the Claude desktop app/.test(r.out));

  /* ------------------------------------------------------------- Go back */
  console.log('Go back to last good version');
  const fresh = path.join(TMP, 'fresh');
  mkdirSync(fresh);
  git(fresh, 'init', '-q', '-b', 'main');
  commit(fresh, 'app.txt', 'x\n', 'only');
  r = run('rollback.mjs', { root: fresh });
  check('with no verified version it changes nothing and says so', r.status === 0 && /no known-good version yet/.test(r.out) && git(fresh, 'rev-parse', '--abbrev-ref', 'HEAD') === 'main', r.out);

  // v1.2-live and v1.10-live are from before Windows support; v1.11-live and
  // v1.12-live hold the launcher. Sorted as text, 1.2 would beat 1.12.
  const hist = path.join(TMP, 'history');
  mkdirSync(hist);
  git(hist, 'init', '-q', '-b', 'main');
  commit(hist, 'app.txt', 'a\n', 'a'); git(hist, 'tag', 'v1.2-live');
  commit(hist, 'app.txt', 'b\n', 'b'); git(hist, 'tag', 'v1.10-live');
  commit(hist, 'app.txt', 'unverified\n', 'never checked live'); git(hist, 'tag', 'v1.10.1');
  r = run('rollback.mjs', { root: hist, env: { PM_CODEX_LAUNCHER_PLATFORM: 'win32' } });
  check('Windows: versions from before Windows support are not offered', r.status === 0 && /no known-good version that runs on Windows/.test(r.out) && git(hist, 'rev-parse', '--abbrev-ref', 'HEAD') === 'main', r.out);
  r = run('rollback.mjs', { root: hist, env: { PM_CODEX_LAUNCHER_PLATFORM: 'darwin' } });
  check('macOS: the newest verified version is checked out, by version number', r.status === 0 && /now on v1\.10-live/.test(r.out) && readFileSync(path.join(hist, 'app.txt'), 'utf8').trim() === 'b', r.out);
  git(hist, 'checkout', '-q', 'main');
  commit(hist, 'launcher/update.mjs', '// here\n', 'launcher'); git(hist, 'tag', 'v1.11-live');
  commit(hist, 'app.txt', 'd\n', 'd'); git(hist, 'tag', 'v1.12-live');
  commit(hist, 'app.txt', 'e\n', 'newest, not verified');
  r = run('rollback.mjs', { root: hist, env: { PM_CODEX_LAUNCHER_PLATFORM: 'win32' } });
  check('Windows: goes back to the newest verified version that has the launcher', r.status === 0 && /now on v1\.12-live/.test(r.out) && readFileSync(path.join(hist, 'app.txt'), 'utf8').trim() === 'd', r.out);
  r = run('update.mjs', { root: hist });
  check('Update after Go back lands on main again (no remote here, so it says the download failed)', git(hist, 'rev-parse', '--abbrev-ref', 'HEAD') === 'main' && readFileSync(path.join(hist, 'app.txt'), 'utf8').trim() === 'e', r.out);

  /* --------------------------------------------------------------- Reset */
  console.log('Reset');
  const inst = path.join(TMP, 'to reset');
  for (const d of ['source/node_modules/pkg/deep', 'source/dist/assets', 'bridge/node_modules/ws', 'secrets', 'source/src']) mkdirSync(path.join(inst, d), { recursive: true });
  writeFileSync(path.join(inst, 'source/node_modules/pkg/deep/index.js'), 'x');
  writeFileSync(path.join(inst, 'source/dist/assets/app.js'), 'x');
  writeFileSync(path.join(inst, 'secrets/gemini-api-key'), 'not-a-real-key');
  writeFileSync(path.join(inst, 'source/src/App.tsx'), 'x');
  r = run('reset.mjs', { root: inst });
  check('Reset removes the packages and the build', r.status === 0 && /reset done/.test(r.out) && !existsSync(path.join(inst, 'source/node_modules')) && !existsSync(path.join(inst, 'source/dist')) && !existsSync(path.join(inst, 'bridge/node_modules')), r.out);
  check('Reset leaves the Gemini key and the source alone', existsSync(path.join(inst, 'secrets/gemini-api-key')) && existsSync(path.join(inst, 'source/src/App.tsx')));
  r = run('reset.mjs', { root: inst });
  check('Reset twice is harmless', r.status === 0 && /reset done/.test(r.out), r.out);
  check('nothing else in the folder was touched', readdirSync(inst).sort().join(',') === 'bridge,secrets,source');
} catch (e) {
  fail++; console.log('  FAIL unexpected error:', e.stack || e.message);
} finally {
  try { rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* a scanner holding a file — the system clears temp */ }
}
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
