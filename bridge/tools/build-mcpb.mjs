// Builds the Claude desktop extension (pm-codex-bridge.mcpb) for THIS copy of
// PM Codex. PLAN.md sections 22.5 and 22.15.
//
// The extension is a zip holding one manifest.json. The manifest points
// Claude at this copy's bridge/server.mjs by its absolute path, and passes the
// app's port (PM_CODEX_PORT, default 7800) so the bridge accepts the app's
// address. Each computer makes its own; nothing here is specific to one person.
//
//   node bridge/tools/build-mcpb.mjs [output path]
//
// Default output: pm-codex-bridge.mcpb in the repo root (git ignores it).
// No dependencies: the zip is written by hand (stored, not compressed).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE = path.resolve(HERE, '..');
const ROOT = path.resolve(BRIDGE, '..');
const SERVER = path.join(BRIDGE, 'server.mjs');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'pm-codex-bridge.mcpb'));
const PORT = String(Number(process.env.PM_CODEX_PORT) || 7800);

if (!existsSync(path.join(BRIDGE, 'node_modules'))) {
  console.error('PM Codex: the bridge is not installed yet. In Pinokio, run Install (or Update) first.');
  process.exit(1);
}

const version = JSON.parse(readFileSync(path.join(BRIDGE, 'package.json'), 'utf8')).version;
const template = readFileSync(path.join(BRIDGE, 'manifest.template.json'), 'utf8');
const fill = (value) => {
  if (typeof value === 'string') {
    return value.replaceAll('{{SERVER_PATH}}', SERVER).replaceAll('{{VERSION}}', version).replaceAll('{{APP_PORT}}', PORT);
  }
  if (Array.isArray(value)) return value.map(fill);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v)]));
  return value;
};
const manifest = fill(JSON.parse(template));
const json = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');

// ---- a one-file zip, stored (method 0) ----
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}
function zipOneFile(name, data) {
  const nameBuf = Buffer.from(name, 'utf8');
  const crc = crc32(data);
  const { time, date } = dosDateTime(new Date());
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(0, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(0, 10); central.writeUInt16LE(time, 12);
  central.writeUInt16LE(date, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36); central.writeUInt32LE(0, 38); central.writeUInt32LE(0, 42);
  const localPart = Buffer.concat([local, nameBuf, data]);
  const centralPart = Buffer.concat([central, nameBuf]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(centralPart.length, 12);
  end.writeUInt32LE(localPart.length, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([localPart, centralPart, end]);
}

writeFileSync(OUT, zipOneFile('manifest.json', json));
console.log(`PM Codex: made the Claude extension for this computer: ${OUT}`);
console.log(`  bridge: ${SERVER}`);
console.log(`  app address it accepts: http://localhost:${PORT}`);
