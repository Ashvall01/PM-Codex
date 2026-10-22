// PM Codex — local server. PLAN.md section 22.4.
//
// Three jobs:
//   1. Serve the built app (dist/) at http://localhost:<port>.
//   2. Forward Gemini calls from the app to Google, adding the API key.
//      The key never reaches the browser: the page only ever holds a placeholder.
//   3. Keep the Gemini key the user types into the app (setup wizard or
//      Settings → Gemini). The page sends it here once; it is checked with
//      Google, written to <app>/secrets/gemini-api-key (owner-only, ignored by
//      git) and used at once. It is never sent back — the page only learns
//      whether a key is set and its last four characters. A key in Pinokio's
//      ENVIRONMENT (older installs) still works; a key saved in the app wins.
//
// Guards, because this process adds a paid key to what it forwards:
//   - listens on the loopback address only (no other device can reach it);
//   - refuses any request whose Host is not this app's own address
//     (stops DNS-rebinding pages);
//   - refuses any request whose Origin or Sec-Fetch-Site says it came from
//     another web page (stops other sites spending the key);
//   - forwards only the Gemini paths the app uses;
//   - sends no CORS headers, so only the app itself can read an answer.
// The key settings (/api/settings/gemini-key) sit behind the same guards.

import express from 'express';
import { createServer } from 'node:http';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PM_CODEX_PORT || 7800);
// A key from Pinokio's ENVIRONMENT (older installs). A key saved in the app wins.
const ENV_KEY = (process.env.GEMINI_API_KEY || '').trim();
// Tests point this at a temporary folder. Never set it in normal use.
const SECRETS_DIR = path.resolve(process.env.PM_CODEX_SECRETS_DIR || path.join(HERE, '..', 'secrets'));
const KEY_FILE = path.join(SECRETS_DIR, 'gemini-api-key');
const GOOGLE = 'https://generativelanguage.googleapis.com';
// Tests point this at a fake Google. Never set it in normal use.
const UPSTREAM = (process.env.PM_CODEX_GEMINI_UPSTREAM || GOOGLE).replace(/\/+$/, '');
const DIST = path.join(HERE, 'dist');
const PREFIX = '/api/gemini';
const KEY_SETTINGS = '/api/settings/gemini-key';
const MAX_BODY_BYTES = 64 * 1024 * 1024;

const OWN_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]);
const OWN_ORIGINS = new Set([...OWN_HOSTS].map((h) => `http://${h}`));

// The Gemini API paths the app uses: models (generate, stream, count), the
// Files API (get, list, delete) and the resumable upload endpoint.
const ALLOWED_PATHS = [
  /^\/v1beta\/models\/[^/]+$/,
  /^\/v1beta\/files(\/[^/]+)?$/,
  /^\/upload\/v1beta\/files$/,
];

// Request headers passed on to Google. Everything else is dropped —
// cookies, the page's origin, and the placeholder key in particular.
const FORWARD_REQUEST = new Set(['content-type', 'accept', 'x-goog-api-client']);
// Response headers not passed back: hop-by-hop, encoding (fetch already
// decoded the body), cookies, and any CORS header from Google.
const DROP_RESPONSE = new Set([
  'content-encoding', 'content-length', 'transfer-encoding', 'connection',
  'keep-alive', 'set-cookie', 'alt-svc', 'x-goog-api-key',
]);

function crossSite(req) {
  const origin = req.headers.origin;
  if (origin && !OWN_ORIGINS.has(origin)) return 'origin';
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return 'sec-fetch-site';
  return null;
}

// ------------------------------------------------------------ the key itself

function readSavedKey() {
  try { return readFileSync(KEY_FILE, 'utf8').trim(); } catch { return ''; }
}
let savedKey = readSavedKey();
const currentKey = () => savedKey || ENV_KEY;

/** What the page may know about the key: never the key itself. */
function keyStatus() {
  const key = currentKey();
  return {
    configured: Boolean(key),
    source: savedKey ? 'app' : ENV_KEY ? 'pinokio' : null,
    last4: key ? key.slice(-4) : null,
  };
}

// Written to a temporary file first, then moved into place, so a crash never
// leaves half a key. Owner-only: the folder 700, the file 600.
function saveKey(key) {
  mkdirSync(SECRETS_DIR, { recursive: true, mode: 0o700 });
  try { chmodSync(SECRETS_DIR, 0o700); } catch { /* not ours to change — the file is still 600 */ }
  const tmp = `${KEY_FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, key + '\n', { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, KEY_FILE);
  savedKey = key;
}

function removeSavedKey() {
  try { unlinkSync(KEY_FILE); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  savedKey = '';
}

// A Gemini key is printable ASCII with no spaces. Anything else is a paste
// accident (a whole line, a quote mark), refused before it goes to Google.
const KEY_SHAPE = /^[\x21-\x7e]{20,200}$/;

/** Ask Google whether the key works, with the smallest call there is. */
async function checkKeyWithGoogle(key) {
  let r;
  try {
    r = await fetch(`${UPSTREAM}/v1beta/models?pageSize=1`, {
      headers: { 'x-goog-api-key': key }, redirect: 'manual', signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    return { ok: false, status: 502, message: `Could not reach Google to check the key (${e.message}). Nothing was saved; try again.` };
  }
  if (r.ok) return { ok: true };
  if (r.status === 400 || r.status === 401 || r.status === 403) {
    return { ok: false, status: 400, message: 'Google did not accept this key. Check that you copied all of it, and that it comes from aistudio.google.com/apikey. Nothing was saved.' };
  }
  return { ok: false, status: 502, message: `Google could not check the key just now (answer ${r.status}). Nothing was saved; try again.` };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function findKeyInBuild(dir, key) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { const hit = findKeyInBuild(full, key); if (hit) return hit; }
    else if (/\.(js|mjs|html|css|json|map|txt)$/.test(entry.name) && readFileSync(full, 'utf8').includes(key)) return full;
  }
  return null;
}

function geminiError(res, status, message) {
  res.status(status).json({ error: { code: status, message, status: 'PM_CODEX_LOCAL' } });
}

const app = express();
app.disable('x-powered-by');
app.set('etag', false);

// Every request must be addressed to this app by its own name. A page from
// another site that points its own name at this machine (DNS rebinding)
// fails here.
app.use((req, res, next) => {
  const host = String(req.headers.host || '');
  if (!OWN_HOSTS.has(host)) {
    console.warn(`[refused] ${req.method} ${req.path} — host ${host || '(none)'}`);
    return res.status(403).type('text').send(`Open PM Codex at http://localhost:${PORT} — the address "${host}" is not allowed.`);
  }
  next();
});

// Gemini calls must come from the app's own page, never from another site.
// (Opening the page itself from a link is fine — the page holds no secret.)
app.use(PREFIX, (req, res, next) => {
  const why = crossSite(req);
  if (why) {
    console.warn(`[refused] ${req.method} ${PREFIX}${req.path} — ${why} (${req.headers.origin || req.headers['sec-fetch-site']})`);
    return geminiError(res, 403, `Refused: this Gemini call did not come from PM Codex itself (${why}).`);
  }
  next();
});

// ------------------------------------------------------- key settings
// Same guards as the Gemini calls: the app's own page only. The key goes in
// and never comes out; the answer is only keyStatus().
app.use(KEY_SETTINGS, (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  const why = crossSite(req);
  if (why) {
    console.warn(`[refused] ${req.method} ${KEY_SETTINGS} — ${why} (${req.headers.origin || req.headers['sec-fetch-site']})`);
    return geminiError(res, 403, `Refused: this did not come from PM Codex itself (${why}).`);
  }
  next();
});

app.get(KEY_SETTINGS, (req, res) => res.json(keyStatus()));

app.post(KEY_SETTINGS, express.json({ limit: '4kb', type: () => true }), async (req, res) => {
  // JSON only: a plain HTML form on another site cannot send this type.
  if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) {
    return geminiError(res, 415, 'Send the key as JSON.');
  }
  const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
  if (!KEY_SHAPE.test(key)) {
    return geminiError(res, 400, 'That does not look like a Gemini API key. Copy it again from aistudio.google.com/apikey. Nothing was saved.');
  }
  const checked = await checkKeyWithGoogle(key);
  if (!checked.ok) return geminiError(res, checked.status, checked.message);
  try {
    saveKey(key);
  } catch (e) {
    console.error(`Could not save the Gemini key: ${e.message}`);
    return geminiError(res, 500, 'The key works, but it could not be saved on this computer. See the PM Codex terminal in Pinokio.');
  }
  console.log('Gemini key saved in the app. Gemini features are on.');
  res.json(keyStatus());
});

app.delete(KEY_SETTINGS, (req, res) => {
  try {
    removeSavedKey();
  } catch (e) {
    console.error(`Could not remove the Gemini key: ${e.message}`);
    return geminiError(res, 500, 'The key could not be removed. See the PM Codex terminal in Pinokio.');
  }
  console.log('Gemini key removed from the app.');
  res.json(keyStatus());
});

// Bad JSON and the like: one plain sentence, never a stack trace.
app.use(KEY_SETTINGS, (err, req, res, next) => {
  if (!err) return next();
  geminiError(res, err.status || 400, err.type === 'entity.too.large' ? 'Too large to be a key.' : 'Could not read the request.');
});

// ------------------------------------------------------- Gemini calls
app.use(PREFIX, async (req, res) => {
  const target = new URL(req.url, 'http://placeholder');
  if (!ALLOWED_PATHS.some((re) => re.test(target.pathname))) {
    return geminiError(res, 404, `Not forwarded: ${target.pathname} is not a Gemini path PM Codex uses.`);
  }
  const key = currentKey();
  if (!key) {
    return geminiError(res, 503, 'Gemini is not set up: no Gemini API key. To use Gemini features, add your key in PM Codex → Settings → Gemini. Everything else, Claude included, works without it.');
  }
  target.searchParams.delete('key');

  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (FORWARD_REQUEST.has(name) || name.startsWith('x-goog-upload-')) headers[name] = value;
  }
  headers['x-goog-api-key'] = key;

  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try { body = await readBody(req); } catch (e) {
      return geminiError(res, e.status || 400, e.status === 413 ? 'Request too large.' : 'Could not read the request.');
    }
  }

  const abort = new AbortController();
  res.on('close', () => { if (!res.writableEnded) abort.abort(); });

  let upstream;
  try {
    upstream = await fetch(UPSTREAM + target.pathname + target.search, {
      method: req.method, headers, body, redirect: 'manual', signal: abort.signal,
    });
  } catch (e) {
    if (abort.signal.aborted) return;
    return geminiError(res, 502, `Could not reach Google: ${e.message}`);
  }

  res.status(upstream.status);
  const ownBase = `http://${req.headers.host}${PREFIX}`;
  upstream.headers.forEach((value, name) => {
    if (DROP_RESPONSE.has(name) || name.startsWith('access-control-')) return;
    if (name === 'x-goog-upload-url') {
      // The second half of an upload goes to this address. Point it back
      // through this server, or it would reach Google without the key.
      value = value.replace(GOOGLE, ownBase).replace(UPSTREAM, ownBase);
    }
    res.setHeader(name, value);
  });
  res.flushHeaders();

  if (!upstream.body) return res.end();
  try {
    // Pass each piece on as it arrives — the chat streams its answer.
    for await (const chunk of upstream.body) {
      if (!res.write(chunk)) await new Promise((r) => res.once('drain', r));
    }
    res.end();
  } catch {
    res.destroy();
  }
});

// Last line of defence: refuse to serve a build that contains the key.
if (currentKey() && existsSync(DIST)) {
  const leaked = findKeyInBuild(DIST, currentKey());
  if (leaked) {
    console.error(`PM Codex will not start: the Gemini key was found inside the built app (${path.relative(HERE, leaked)}). Run Update (or Install) to rebuild without it.`);
    process.exit(1);
  }
}

if (existsSync(DIST)) {
  app.use(express.static(DIST));
  // Single-page app: any other address loads the app, which routes itself.
  app.get('*', (req, res) => res.sendFile(path.join(DIST, 'index.html')));
} else {
  app.get('*', (req, res) => res.status(503).type('text').send('PM Codex is not built yet. In Pinokio, run Install (or Update).'));
}

// Loopback only, on both IPv4 and IPv6, because "localhost" can mean either.
let listening = 0;
for (const host of ['127.0.0.1', '::1']) {
  const server = createServer(app);
  server.on('error', (e) => {
    if (host === '::1') return; // no IPv6 loopback on this machine — fine
    if (e.code === 'EADDRINUSE') {
      console.error(`PM Codex cannot start: port ${PORT} is already in use. Close the other program, or set PM_CODEX_PORT in Pinokio → Configure.`);
    } else {
      console.error(`PM Codex cannot start: ${e.message}`);
    }
    process.exit(1);
  });
  server.listen(PORT, host, () => {
    listening += 1;
    if (host === '127.0.0.1') {
      if (!currentKey()) console.warn('Note: no Gemini API key set. Gemini features are off; everything else, Claude included, works. Add the key in PM Codex → Settings → Gemini to turn them on.');
      console.log(`PM Codex is running at http://localhost:${PORT}`);
    }
  });
}
