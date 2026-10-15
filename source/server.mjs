// PM Codex — local server. PLAN.md section 22.4.
//
// Two jobs:
//   1. Serve the built app (dist/) at http://localhost:<port>.
//   2. Forward Gemini calls from the app to Google, adding the API key.
//      The key is read from the environment (Pinokio's ENVIRONMENT file) and
//      never reaches the browser: the page only ever holds a placeholder.
//
// Guards, because this process adds a paid key to what it forwards:
//   - listens on the loopback address only (no other device can reach it);
//   - refuses any request whose Host is not this app's own address
//     (stops DNS-rebinding pages);
//   - refuses any request whose Origin or Sec-Fetch-Site says it came from
//     another web page (stops other sites spending the key);
//   - forwards only the Gemini paths the app uses;
//   - sends no CORS headers, so only the app itself can read an answer.

import express from 'express';
import { createServer } from 'node:http';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PM_CODEX_PORT || 7800);
const KEY = (process.env.GEMINI_API_KEY || '').trim();
const GOOGLE = 'https://generativelanguage.googleapis.com';
// Tests point this at a fake Google. Never set it in normal use.
const UPSTREAM = (process.env.PM_CODEX_GEMINI_UPSTREAM || GOOGLE).replace(/\/+$/, '');
const DIST = path.join(HERE, 'dist');
const PREFIX = '/api/gemini';
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

app.use(PREFIX, async (req, res) => {
  const target = new URL(req.url, 'http://placeholder');
  if (!ALLOWED_PATHS.some((re) => re.test(target.pathname))) {
    return geminiError(res, 404, `Not forwarded: ${target.pathname} is not a Gemini path PM Codex uses.`);
  }
  if (!KEY) {
    return geminiError(res, 503, 'Gemini is not set up: no Gemini API key. To use Gemini features, add GEMINI_API_KEY in Pinokio → PM Codex → Configure, then restart the app. Everything else, Claude included, works without it.');
  }
  target.searchParams.delete('key');

  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (FORWARD_REQUEST.has(name) || name.startsWith('x-goog-upload-')) headers[name] = value;
  }
  headers['x-goog-api-key'] = KEY;

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
if (KEY && existsSync(DIST)) {
  const leaked = findKeyInBuild(DIST, KEY);
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
      if (!KEY) console.warn('Note: no GEMINI_API_KEY set. Gemini features are off; everything else, Claude included, works. Add the key in Pinokio → Configure to turn them on.');
      console.log(`PM Codex is running at http://localhost:${PORT}`);
    }
  });
}
