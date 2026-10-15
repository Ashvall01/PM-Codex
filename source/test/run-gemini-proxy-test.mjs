// Tests source/server.mjs — the Gemini key proxy. PLAN.md sections 22.4 and 22.11.
//
// Runs the real server against a FAKE Google on this machine, and drives it
// with the same @google/genai web build the app bundles. Needs no real key
// and no network.
//
//   node test/run-gemini-proxy-test.mjs        (from source/)

import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', 'server.mjs');
const SDK = path.join(HERE, '..', 'node_modules', '@google', 'genai', 'dist', 'web', 'index.mjs');
const KEY = 'test-key-7f3a9c-never-leak';
const GOOGLE = 'https://generativelanguage.googleapis.com';

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

// ---------- fake Google ----------
const seen = [];
const uploads = {};
const fake = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const u = new URL(req.url, 'http://fake');
    seen.push({ method: req.method, path: u.pathname, query: u.search, headers: req.headers, body: body.toString() });
    const json = (status, obj, extra = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...extra }); res.end(JSON.stringify(obj)); };

    if (u.pathname.endsWith(':streamGenerateContent')) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' });
      const words = ['one ', 'two ', 'three'];
      let i = 0;
      const tick = () => {
        res.write(`data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: words[i] }] } }] })}\r\n\r\n`);
        if (++i < words.length) setTimeout(tick, 250); else res.end();
      };
      return tick();
    }
    if (u.pathname.endsWith(':generateContent')) {
      return json(200, { candidates: [{ content: { role: 'model', parts: [{ text: 'hello back' }] } }] });
    }
    if (u.pathname === '/upload/v1beta/files' && !u.searchParams.get('upload_id')) {
      return json(200, {}, { 'x-goog-upload-url': `${GOOGLE}/upload/v1beta/files?upload_id=UP1&upload_protocol=resumable`, 'x-goog-upload-status': 'active' });
    }
    if (u.pathname === '/upload/v1beta/files' && u.searchParams.get('upload_id') === 'UP1') {
      uploads.UP1 = (uploads.UP1 || '') + body.toString();
      return json(200, { file: { name: 'files/abc', state: 'ACTIVE', mimeType: 'text/plain', sizeBytes: '5' } }, { 'x-goog-upload-status': 'final' });
    }
    if (u.pathname === '/v1beta/files/abc' && req.method === 'GET') return json(200, { name: 'files/abc', state: 'ACTIVE' });
    if (u.pathname === '/v1beta/files/abc' && req.method === 'DELETE') return json(200, {});
    json(404, { error: { code: 404, message: 'fake: no such path' } });
  });
});

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
const fakePort = await listen(fake);

// ---------- start the real server ----------
function startServer(port, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], {
      env: { PATH: process.env.PATH, PM_CODEX_PORT: String(port), PM_CODEX_GEMINI_UPSTREAM: `http://127.0.0.1:${fakePort}`, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const onData = (d) => { out += d; if (/running at http:\/\/localhost:\d+/.test(out)) resolve({ child, out: () => out }); };
    child.stdout.on('data', onData); child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (c) => reject(new Error(`server exited ${c}: ${out}`)));
    setTimeout(() => reject(new Error(`server did not start: ${out}`)), 5000);
  });
}
const freePort = async () => { const s = http.createServer(); const p = await listen(s); s.close(); return p; };
const PORT = await freePort();
const server = await startServer(PORT, { GEMINI_API_KEY: KEY });
const BASE = `http://localhost:${PORT}`;

// Everything the client receives, to prove the key never comes back.
const received = [];
const rawRequest = (opts, body) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: PORT, ...opts }, (res) => {
    const c = []; res.on('data', (d) => c.push(d));
    res.on('end', () => { const r = { status: res.statusCode, headers: res.headers, body: Buffer.concat(c).toString() }; received.push(JSON.stringify(r)); resolve(r); });
  });
  req.on('error', reject); if (body) req.write(body); req.end();
});

try {
  const { GoogleGenAI } = await import(SDK);
  const ai = new GoogleGenAI({ apiKey: 'pm-codex-local', httpOptions: { baseUrl: `${BASE}/api/gemini` } });

  console.log('SDK through the proxy');
  const r1 = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: 'hi' });
  check('generateContent returns the answer', r1.text === 'hello back', JSON.stringify(r1.text));
  const g = seen.find((s) => s.path.endsWith(':generateContent'));
  check('Google receives the real key', g && g.headers['x-goog-api-key'] === KEY);
  check('Google never receives the placeholder key', !seen.some((s) => JSON.stringify(s).includes('pm-codex-local')));

  const times = []; let text = '';
  const stream = await ai.models.generateContentStream({ model: 'gemini-2.5-flash', contents: 'count' });
  for await (const chunk of stream) { times.push(Date.now()); text += chunk.text; }
  check('stream: all three pieces arrive', text === 'one two three', JSON.stringify(text));
  check('stream: pieces arrive over time, not all at once', times.length === 3 && times[2] - times[0] >= 400, `spread ${times[2] - times[0]}ms`);

  const up = await ai.files.upload({ file: new Blob(['hello'], { type: 'text/plain' }), config: { mimeType: 'text/plain' } });
  check('upload: SDK completes the two-step upload', up && up.name === 'files/abc', JSON.stringify(up));
  check('upload: the bytes reach Google', uploads.UP1 === 'hello', JSON.stringify(uploads.UP1));
  const upCalls = seen.filter((s) => s.path === '/upload/v1beta/files');
  check('upload: both steps went through the proxy with the key', upCalls.length === 2 && upCalls.every((s) => s.headers['x-goog-api-key'] === KEY));
  const got = await ai.files.get({ name: 'files/abc' });
  check('files.get works', got.state === 'ACTIVE');
  await ai.files.delete({ name: 'files/abc' });
  check('files.delete works', seen.some((s) => s.method === 'DELETE' && s.path === '/v1beta/files/abc'));

  console.log('Upload address');
  const start = await rawRequest({ method: 'POST', path: '/api/gemini/upload/v1beta/files', headers: { host: `localhost:${PORT}`, 'content-type': 'application/json', 'x-goog-upload-protocol': 'resumable', 'x-goog-upload-command': 'start' } }, '{}');
  check('x-goog-upload-url points back through the proxy', String(start.headers['x-goog-upload-url']).startsWith(`${BASE}/api/gemini/upload/v1beta/files?upload_id=UP1`), start.headers['x-goog-upload-url']);
  check('Google CORS headers are not passed on', !Object.keys(start.headers).some((h) => h.startsWith('access-control-')));

  console.log('Refusals');
  const n0 = seen.length;
  const post = (headers, p = '/api/gemini/v1beta/models/gemini-2.5-flash:generateContent') =>
    rawRequest({ method: 'POST', path: p, headers: { 'content-type': 'application/json', host: `localhost:${PORT}`, ...headers } }, '{"contents":[]}');
  check('another site (Origin) is refused', (await post({ origin: 'https://evil.example' })).status === 403);
  check('another site (Sec-Fetch-Site: cross-site) is refused', (await post({ 'sec-fetch-site': 'cross-site' })).status === 403);
  check('another local app (Sec-Fetch-Site: same-site) is refused', (await post({ 'sec-fetch-site': 'same-site' })).status === 403);
  check('a foreign Host (DNS rebinding) is refused', (await post({ host: `evil.example:${PORT}` })).status === 403);
  check('the Pinokio HTTPS alias is refused', (await post({ host: `${PORT}.localhost` })).status === 403);
  check('a non-Gemini path is refused', (await post({}, '/api/gemini/v1beta/tunedModels')).status === 404);
  check('a path outside v1beta is refused', (await post({}, '/api/gemini/v1/models/x:generateContent')).status === 404);
  check('refused calls never reach Google', seen.length === n0, `${seen.length - n0} reached`);

  console.log('What is and is not passed on');
  await post({ origin: BASE, 'sec-fetch-site': 'same-origin', cookie: 'secret=1', 'x-goog-api-key': 'pm-codex-local' }, '/api/gemini/v1beta/models/gemini-2.5-flash:generateContent?key=leaked');
  const last = seen[seen.length - 1];
  check('the app\'s own page is allowed', last && last.path.endsWith(':generateContent'));
  check('cookies are not passed on', last && !last.headers.cookie);
  check('a key in the address is dropped', last && !last.query.includes('key='));
  check('the page\'s Origin is not passed on', last && !last.headers.origin);

  console.log('Pages');
  const page = await rawRequest({ method: 'GET', path: '/', headers: { host: `localhost:${PORT}`, 'sec-fetch-site': 'cross-site' } });
  check('opening the page from a link is allowed', page.status !== 403, String(page.status));
  const foreign = await rawRequest({ method: 'GET', path: '/', headers: { host: 'evil.example' } });
  check('a page request with a foreign Host is refused', foreign.status === 403);

  check('the key is in no response sent back to the client', !received.some((r) => r.includes(KEY)));

  console.log('No key set');
  const P2 = await freePort();
  const s2 = await startServer(P2, { GEMINI_API_KEY: '' });
  const r = await new Promise((resolve) => http.request({ host: '127.0.0.1', port: P2, method: 'POST', path: '/api/gemini/v1beta/models/x:generateContent', headers: { host: `localhost:${P2}` } }, (res) => { let b = ''; res.on('data', (d) => b += d); res.on('end', () => resolve({ status: res.statusCode, body: b })); }).end());
  check('without a key the app gets a clear 503', r.status === 503 && r.body.includes('Configure'));
  check('without a key the server warns at start', /no GEMINI_API_KEY/.test(s2.out()));
  s2.child.kill();
} catch (e) {
  fail++; console.log('  FAIL unexpected error:', e.stack || e);
} finally {
  server.child.kill(); fake.close();
}
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
