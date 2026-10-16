// Builds docs/index.html — the GitHub Pages showcase — from index.src.html.
//
//   cd docs/_src && npm install && npm run build
//
// 1. Tailwind compiles input.css (the app's own theme) against the classes used
//    in index.src.html.
// 2. Every <i data-icon="name" class="..."></i> becomes the inline Lucide SVG
//    the app uses (lucide-static, same version as the app's lucide-react).
// 3. avatar.js — the app's animated assistant avatar — is bundled with three by
//    esbuild and inlined.
// 4. The app's captured screens (captures/) and the demo script (demo.js) are
//    inlined, and so is the CSS, so docs/index.html is one self-contained file.
//
// GitHub Pages skips folders that start with "_", so this folder is never
// published; only docs/index.html and docs/og.png are.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'pmc-showcase-'));
const cssOut = join(tmp, 'site.css');

execFileSync(join(HERE, 'node_modules', '.bin', 'tailwindcss'),
  ['-i', join(HERE, 'input.css'), '-o', cssOut, '--minify'],
  { stdio: 'inherit', cwd: HERE });

const css = readFileSync(cssOut, 'utf8');
let html = readFileSync(join(HERE, 'index.src.html'), 'utf8');

// The app's screens (captures/*.html) as <template>s, and the demo's script.
const captures = readdirSync(join(HERE, 'captures')).filter(f => f.endsWith('.html')).sort()
  .map(f => `<template id="tpl-${f.slice(0, -5)}">${readFileSync(join(HERE, 'captures', f), 'utf8')}</template>`).join('\n');
html = html.replace('<!-- @captures -->', () => captures);
const { buildSync } = await import('esbuild');
const avatar = buildSync({
  entryPoints: [join(HERE, 'avatar.js')], bundle: true, minify: true, format: 'iife',
  target: 'es2020', write: false, legalComments: 'none',
}).outputFiles[0].text;
html = html.replace('/* @avatar-js */', () => avatar);
html = html.replace('/* @chats-js */', () => readFileSync(join(HERE, 'chats.js'), 'utf8'));
html = html.replace('/* @demo-js */', () => readFileSync(join(HERE, 'demo.js'), 'utf8'));

// The app's own Gemini mark (source/src/components/icons/GeminiIcon.tsx).
const CUSTOM = {
  gemini: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12.015 23.9531C11.8906 17.3906 6.57031 12.0938 0 12.0156V11.9531C6.5625 11.8906 11.8906 6.5625 12.015 0H12.0775C12.1869 6.57813 17.4837 11.8906 24 11.9531V12.0156C17.4837 12.0938 12.1869 17.3906 12.0775 23.9531H12.015Z" fill="currentColor"/></svg>',
};

const missing = new Set();
html = html.replace(/<i data-icon="([a-z0-9-]+)"(?: class="([^"]*)")?><\/i>/g, (_, name, cls = '') => {
  let svg = CUSTOM[name];
  if (!svg) {
    try {
      svg = readFileSync(join(HERE, 'node_modules', 'lucide-static', 'icons', `${name}.svg`), 'utf8');
    } catch {
      missing.add(name);
      return '';
    }
  }
  svg = svg
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s*class="[^"]*"/, '')
    .replace(/\s+width="24"\s+height="24"/, '')
    .replace('<svg', `<svg class="${cls}" aria-hidden="true" focusable="false"`)
    .replace(/\n\s*/g, ' ')
    .trim();
  return svg;
});
if (missing.size) {
  console.error(`build: unknown icons: ${[...missing].join(', ')}`);
  process.exit(1);
}

html = html.replace('<!-- @css -->', `<style>${css}</style>`);
html = html.replace(/^<!doctype html>/i, m => `${m}\n<!-- Built by docs/_src/build.mjs from docs/_src/index.src.html. Edit the source, not this file. -->`);

writeFileSync(join(HERE, '..', 'index.html'), html);
console.log(`build: docs/index.html written (${Math.round(html.length / 1024)} KB)`);
