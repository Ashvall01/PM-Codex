/**
 * Is this the address of an Apps Script web app?
 *
 * The address the user pastes in the setup wizard (or Settings) is where the
 * app sends the whole project on every save. Before this check, any text was
 * accepted — FORCE CONNECT took it unverified — so a wrong paste (the Sheet's
 * own address, the script editor's, the /dev test address) left an app that
 * looked connected and never saved, and a non-Google address would have been
 * sent everything.
 *
 * Accepted: https://script.google.com/macros/s/<id>/exec, and the Google
 * Workspace forms with the organisation's domain in the path.
 */
export type WebAppUrlCheck = { ok: true; url: string } | { ok: false; message: string };

const WHERE = 'In Apps Script: Deploy → Manage deployments → Web app → copy the URL. It ends in /exec.';
const WEB_APP_PATH = /^\/(?:a\/macros\/[^/]+|a\/[^/]+\/macros|macros)\/s\/[A-Za-z0-9_-]+\/exec\/?$/;

export function checkWebAppUrl(raw: string): WebAppUrlCheck {
  const text = String(raw || '').trim();
  if (!text) return { ok: false, message: 'Paste the web app address first.' };

  let url: URL;
  try { url = new URL(text); } catch {
    return { ok: false, message: `That is not a web address. ${WHERE}` };
  }
  const host = url.hostname.toLowerCase();

  if (host === 'docs.google.com' || host === 'sheets.google.com' || host === 'drive.google.com') {
    return { ok: false, message: `That is the address of the Sheet itself. PM Codex needs the web app address of the script inside it. ${WHERE}` };
  }
  if (host !== 'script.google.com') {
    return { ok: false, message: `PM Codex saves only to your own Google Apps Script web app, at script.google.com. ${WHERE}` };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, message: 'The address must start with https://.' };
  }
  const path = url.pathname;
  if (/\/dev\/?$/.test(path)) {
    return { ok: false, message: 'That is the test address (it ends in /dev) and only works while you are signed in to Google. Use the one that ends in /exec: Deploy → Manage deployments → Web app.' };
  }
  if (!WEB_APP_PATH.test(path)) {
    return { ok: false, message: `That is an Apps Script address, but not the web app's (the editor's, perhaps). ${WHERE}` };
  }
  // Anything after /exec (?action=…, #…) is not part of the address.
  return { ok: true, url: `https://script.google.com${path.replace(/\/$/, '')}` };
}
