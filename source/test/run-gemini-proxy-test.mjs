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
import os from 'node:os';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', 'server.mjs');
const SDK = path.join(HERE, '..', 'node_modules', '@google', 'genai', 'dist', 'web', 'index.mjs');
const KEY = 'test-key-7f3a9c-never-leak';
const GOOGLE = 'https://generativelanguage.googleapis.com';
// Keys for the in-app key settings. The fake Google accepts only GOOD_KEY.
const GOOD_KEY = 'AppSaved-good-key-0123456789-wxyz';
const BAD_KEY = 'AppSaved-bad-key-0123456789-abcd';
const ENV_KEY2 = 'pinokio-env-key-0123456789-envk';
// Every server gets its own empty secrets folder, so a key saved on this
// computer never leaks into the test.
const tmpSecrets = () => path.join(mkdtempSync(path.join(os.tmpdir(), 'pmc-secrets-')), 'secrets');

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

    if (u.pathname === '/v1beta/models' && req.method === 'GET') {
      return req.headers['x-goog-api-key'] === GOOD_KEY
        ? json(200, { models: [{ name: 'models/gemini-2.5-flash' }] })
        : json(400, { error: { code: 400, message: 'API key not valid.' } });
    }
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
      env: { PATH: process.env.PATH, PM_CODEX_PORT: String(port), PM_CODEX_GEMINI_UPSTREAM: `http://127.0.0.1:${fakePort}`, PM_CODEX_SECRETS_DIR: tmpSecrets(), ...env },
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
  check('without a key the app gets a clear 503', r.status === 503 && r.body.includes('Settings → Gemini'));
  check('without a key the server warns at start', /no Gemini API key/.test(s2.out()));
  s2.child.kill();

  console.log('Key saved in the app');
  const P3 = await freePort();
  const DIR3 = tmpSecrets();
  const FILE3 = path.join(DIR3, 'gemini-api-key');
  let s3 = await startServer(P3, { GEMINI_API_KEY: '', PM_CODEX_SECRETS_DIR: DIR3 });
  const keyCalls = [];
  const settings = (method, { headers = {}, body } = {}, port = P3) => new Promise((resolve, reject) => {
    const own = { host: `localhost:${port}`, origin: `http://localhost:${port}`, 'sec-fetch-site': 'same-origin' };
    const all = { ...own, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers };
    for (const k of Object.keys(all)) if (all[k] === undefined) delete all[k];
    const req = http.request({ host: '127.0.0.1', port, method, path: '/api/settings/gemini-key', headers: all }, (res) => {
      let b = ''; res.on('data', (d) => b += d);
      res.on('end', () => { const out = { status: res.statusCode, headers: res.headers, body: b }; keyCalls.push(JSON.stringify(out)); let json = null; try { json = JSON.parse(b); } catch {} resolve({ ...out, json }); });
    });
    req.on('error', reject); if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body)); req.end();
  });
  const g0 = await settings('GET');
  check('status: no key at first', g0.status === 200 && g0.json?.configured === false && g0.json?.source === null);
  check('status is never cached', /no-store/.test(String(g0.headers['cache-control'])));
  check('another site cannot save a key (Origin)', (await settings('POST', { headers: { origin: 'https://evil.example' }, body: { key: GOOD_KEY } })).status === 403);
  check('another site cannot save a key (Sec-Fetch-Site)', (await settings('POST', { headers: { origin: undefined, 'sec-fetch-site': 'cross-site' }, body: { key: GOOD_KEY } })).status === 403);
  check('a foreign Host cannot read the status', (await settings('GET', { headers: { host: `evil.example:${P3}` } })).status === 403);
  check('a non-JSON post is refused', (await settings('POST', { headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ key: GOOD_KEY }) })).status === 415);
  check('a key with spaces is refused', (await settings('POST', { body: { key: 'not a key at all, just words' } })).status === 400);
  const bad = await settings('POST', { body: { key: BAD_KEY } });
  check('a key Google rejects is refused with a plain sentence', bad.status === 400 && /did not accept/.test(bad.json?.error?.message || ''));
  check('nothing is saved after the refusals', !existsSync(FILE3));
  const before = (await settings('GET')).json;
  check('the status is unchanged after the refusals', before?.configured === false);

  const ok = await settings('POST', { body: { key: `  ${GOOD_KEY}\n` } });
  check('a good key is saved', ok.status === 200 && ok.json?.configured === true && ok.json?.source === 'app');
  check('the answer gives only the last four characters', ok.json?.last4 === GOOD_KEY.slice(-4) && !ok.body.includes(GOOD_KEY));
  check('the key file holds the key, trimmed', existsSync(FILE3) && readFileSync(FILE3, 'utf8').trim() === GOOD_KEY);
  check('the key file is owner-only (600)', existsSync(FILE3) && (statSync(FILE3).mode & 0o777) === 0o600, existsSync(FILE3) ? (statSync(FILE3).mode & 0o777).toString(8) : '');
  check('the secrets folder is owner-only (700)', (statSync(DIR3).mode & 0o777) === 0o700, (statSync(DIR3).mode & 0o777).toString(8));
  const nBefore = seen.length;
  const call = await new Promise((resolve) => http.request({ host: '127.0.0.1', port: P3, method: 'POST', path: '/api/gemini/v1beta/models/x:generateContent', headers: { host: `localhost:${P3}`, 'content-type': 'application/json' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).end('{"contents":[]}'));
  const used = seen.slice(nBefore).find((x) => x.path.endsWith(':generateContent'));
  check('the saved key is used at once, without a restart', call === 200 && used?.headers['x-goog-api-key'] === GOOD_KEY, String(call));
  s3.child.kill();

  s3 = await startServer(P3, { GEMINI_API_KEY: ENV_KEY2, PM_CODEX_SECRETS_DIR: DIR3 });
  const g1 = await settings('GET');
  check('after a restart the saved key wins over Pinokio\'s', g1.json?.source === 'app' && g1.json?.last4 === GOOD_KEY.slice(-4));
  check('another site cannot remove the key', (await settings('DELETE', { headers: { origin: 'https://evil.example' } })).status === 403 && existsSync(FILE3));
  const del = await settings('DELETE');
  check('Remove deletes the saved key', del.status === 200 && !existsSync(FILE3));
  check('after Remove, Pinokio\'s key is used again', del.json?.source === 'pinokio' && del.json?.last4 === ENV_KEY2.slice(-4));
  check('no key-settings answer ever holds a key', !keyCalls.some((c) => c.includes(GOOD_KEY) || c.includes(BAD_KEY) || c.includes(ENV_KEY2)));
  s3.child.kill();
} catch (e) {
  fail++; console.log('  FAIL unexpected error:', e.stack || e);
} finally {
  server.child.kill(); fake.close();
}
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
