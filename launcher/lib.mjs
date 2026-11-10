// PM Codex — helpers shared by the launcher scripts.
//
// Pinokio's buttons (update.js, rollback.js, reset.js, connect.js) used to carry
// their logic as shell one-liners: `rm -rf`, `open`, `$(…)`, `>/dev/null`. Those
// are Unix shell, and Pinokio on Windows runs commands in cmd.exe, where none of
// them work. The logic now lives here as Node, which Pinokio brings with it on
// every system, so one copy of each step runs the same on macOS and Windows.
// A Pinokio line is now only ever `node …`, `npm …` — nothing a shell can read
// two ways.
//
// Checked by launcher/test/launcher-test.mjs.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The app folder. Tests point PM_CODEX_LAUNCHER_ROOT at a throwaway copy. */
export const ROOT = path.resolve(
  process.env.PM_CODEX_LAUNCHER_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'),
);

/** Tests set PM_CODEX_LAUNCHER_PLATFORM to walk the Windows paths on another system. */
export const PLATFORM = process.env.PM_CODEX_LAUNCHER_PLATFORM || process.platform;

export const say = (text) => console.log(`PM Codex: ${text}`);

/**
 * Run git in the app folder. Never asks for a password: a private copy that
 * needs a sign-in fails at once instead of hanging on a prompt nobody can see.
 * `show` lets git's own output through to the Pinokio terminal.
 */
export function git(args, { show = false, cwd = ROOT } = {}) {
  const r = spawnSync('git', args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    stdio: show ? ['ignore', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    windowsHide: true,
  });
  return { ok: r.status === 0, out: show ? '' : String(r.stdout || '').trim(), missing: Boolean(r.error) };
}

/**
 * The program that opens a file with whatever the system has registered for
 * it — for the extension, the Claude desktop app.
 *
 * Windows: PowerShell's Start-Process, with the script passed as an encoded
 * command. `start` in cmd.exe reads the first quoted word as a window title and
 * breaks on a folder with a space or an ampersand in its name (a Windows user
 * folder is often "C:\Users\First Last"); an encoded command has no quoting to
 * get wrong. When nothing is registered for the file type Start-Process either
 * fails or Windows asks the user what to open it with; open-extension.mjs
 * prints the manual way in on both paths, so neither leaves the user stuck.
 */
export function openCommand(file, platform = PLATFORM) {
  if (platform === 'win32') {
    const script = `$ErrorActionPreference = 'Stop'; Start-Process -FilePath '${String(file).replaceAll("'", "''")}'`;
    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    };
  }
  if (platform === 'darwin') return { command: 'open', args: [file] };
  return { command: 'xdg-open', args: [file] };
}

/** Open a file with its registered program. True when the system accepted it. */
export function openFile(file, platform = PLATFORM) {
  const { command, args } = openCommand(file, platform);
  const r = spawnSync(command, args, { stdio: 'ignore', windowsHide: true, timeout: 30000 });
  return !r.error && r.status === 0;
}
