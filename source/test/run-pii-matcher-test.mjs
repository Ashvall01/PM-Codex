#!/usr/bin/env node
/**
 * PII suggestion matcher — same answers as the old check, much faster.
 *
 * The old check (kept below, word for word in its logic) ran on every key
 * press and took about a second on a long page. `src/utils/piiMatcher.ts`
 * must find exactly the same matches, and must be fast on a long page.
 *
 *   cd source && node test/run-pii-matcher-test.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(tmpdir(), 'pm-codex-pii-matcher-test');
mkdirSync(out, { recursive: true });
execFileSync('npx', [
  'tsc', 'src/utils/piiMatcher.ts', '--outDir', out,
  '--module', 'esnext', '--target', 'es2022', '--skipLibCheck',
], { cwd: root, stdio: 'inherit' });
writeFileSync(join(out, 'package.json'), '{"type":"module"}');
const { createPIIMatcher, boundedLevenshtein } = await import(pathToFileURL(join(out, 'piiMatcher.js')).href);

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? '  — ' + extra : '')); }
};

// ------------------------------------------------------------- the old check
function lev(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const m = [];
  for (let i = 0; i <= b.length; i++) m[i] = [i];
  for (let j = 0; j <= a.length; j++) m[0][j] = j;
  for (let i = 1; i <= b.length; i++) for (let j = 1; j <= a.length; j++) {
    m[i][j] = b.charAt(i - 1) === a.charAt(j - 1) ? m[i - 1][j - 1]
      : Math.min(m[i - 1][j - 1] + 1, Math.min(m[i][j - 1] + 1, m[i - 1][j] + 1));
  }
  return m[b.length][a.length];
}
function oldFind(val, projectEntries) {
  const res = [];
  const wordMatches = [];
  const regex = /[\p{L}\p{N}_'-]+/gu;
  let match;
  while ((match = regex.exec(val)) !== null) wordMatches.push({ word: match[0], index: match.index });
  const phrases = [];
  for (let i = 0; i < wordMatches.length; i++) {
    if (i < wordMatches.length - 2) { const s = wordMatches[i].index, e = wordMatches[i + 2].index + wordMatches[i + 2].word.length; phrases.push({ phrase: val.substring(s, e), index: s, length: e - s }); }
    if (i < wordMatches.length - 1) { const s = wordMatches[i].index, e = wordMatches[i + 1].index + wordMatches[i + 1].word.length; phrases.push({ phrase: val.substring(s, e), index: s, length: e - s }); }
    const s = wordMatches[i].index, e = s + wordMatches[i].word.length;
    phrases.push({ phrase: val.substring(s, e), index: s, length: e - s });
  }
  const ranges = [];
  const overl = (s, e) => ranges.some(([a, b]) => s < b && e > a);
  for (const { phrase, index, length } of phrases) {
    if (overl(index, index + length)) continue;
    let found = null;
    const lp = phrase.toLowerCase();
    for (const entry of projectEntries) {
      if (!entry.placeholder) continue;
      if (entry.originalTerm && lp === entry.originalTerm.toLowerCase()) { found = { t: entry.placeholder, exact: true }; break; }
      if (entry.variations && entry.variations.find(v => v && v.trim().toLowerCase() === lp)) { found = { t: entry.placeholder, exact: true }; break; }
    }
    if (!found) {
      for (const entry of projectEntries) {
        if (!entry.placeholder) continue;
        const terms = [entry.originalTerm, ...(entry.variations || [])].filter(v => typeof v === 'string' && v.trim().length > 0);
        for (const term of terms) {
          const lo = term.toLowerCase();
          const d = lev(lp, lo);
          const maxDist = term.length >= 8 ? 2 : term.length >= 5 ? 1 : 0;
          const isPrefix = term.length >= 5 && phrase.length >= 4 && phrase.length >= term.length - 2 && lo.startsWith(lp);
          if (term.length >= 3 && ((maxDist > 0 && d <= maxDist) || isPrefix)) { found = { t: entry.placeholder, exact: false }; break; }
        }
        if (found) break;
      }
    }
    if (found) { ranges.push([index, index + length]); res.push(`${index}:${length}:${found.t}:${found.exact}`); }
  }
  return res;
}

// ------------------------------------------------------------------ fixtures
const entries = [
  { originalTerm: 'Marten Kowalski', placeholder: '[Redacted_Name_1]', variations: ['Pak Marten', 'Marten'] },
  { originalTerm: 'Brandy', placeholder: '[Redacted_Name_2]', variations: ['Brandi'] },
  { originalTerm: 'Northwind Clinics', placeholder: '[Redacted_Organization_1]', variations: ['Northwind'] },
  { originalTerm: 'Datavault', placeholder: '[Redacted_Application_1]' },
  { originalTerm: 'Ari', placeholder: '[Redacted_Name_3]', variations: ['Dr. Ari'] },
  { originalTerm: 'Jakarta Barat', placeholder: '[Redacted_Location_1]' },
  { originalTerm: 'Nobody', placeholder: '' },
];
const vocab = ['the', 'meeting', 'with', 'Marten', 'Martin', 'Marton', 'Kowalski', 'Pak', 'brandy', 'Brandi', 'Brand',
  'Northwind', 'Northwend', 'Clinics', 'Clinic', 'Datavault', 'Datavalt', 'Datav', 'Ari', 'Dr.', 'data', 'domain',
  'Jakarta', 'Barat', 'Barat,', 'UAT', 'go-live', "team's", 'review', '12', 'Datavaul'];
let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const sentence = (n) => Array.from({ length: n }, () => vocab[Math.floor(rnd() * vocab.length)]).join(rnd() < 0.2 ? ', ' : ' ');

// ------------------------------------------------------------------- checks
ok('bounded edit distance agrees with the full one',
   [['marten', 'martin'], ['datavault', 'datavalt'], ['abc', 'xyz'], ['brandy', 'brandi'], ['', 'a']]
     .every(([a, b]) => Math.min(lev(a, b), 3) === Math.min(boundedLevenshtein(a, b, 2), 3)));

const matcher = createPIIMatcher(entries);
const fmt = (ms) => ms.map(m => `${m.index}:${m.length}:${m.suggestion.suggestedToken}:${m.suggestion.exact}`);
let same = true, firstDiff = '';
for (let k = 0; k < 400 && same; k++) {
  const text = sentence(5 + Math.floor(rnd() * 40));
  const a = oldFind(text, entries).join('|');
  const b = fmt(matcher.findMatches(text)).join('|');
  if (a !== b) { same = false; firstDiff = `${text}\n  old: ${a}\n  new: ${b}`; }
}
ok('same matches as the old check on 400 random texts', same, firstDiff);

const t1 = fmt(matcher.findMatches('Met Pak Marten and Brandi about Datavalt.'));
ok('finds a variation, a spelling slip and a near miss', t1.length === 3, t1.join(' '));

// long page: ~6000 words
const longText = Array.from({ length: 600 }, () => sentence(10)).join('. ');
const bigEntries = [...entries];
for (let i = 0; i < 60; i++) bigEntries.push({ originalTerm: `Person${i} Lastname${i}`, placeholder: `[Redacted_Name_${i + 10}]`, variations: [`Person${i}`, `P${i} Lastname`] });
const bigMatcher = createPIIMatcher(bigEntries);

let t = performance.now();
const cold = bigMatcher.findMatches(longText);
const coldMs = performance.now() - t;
t = performance.now();
bigMatcher.findMatches(longText + ' more text');
const warmMs = performance.now() - t;
t = performance.now();
const oldRes = oldFind(longText, bigEntries);
const oldMs = performance.now() - t;
ok('same matches as the old check on a long page', fmt(cold).join('|') === oldRes.join('|'));
console.log(`      long page (${longText.split(' ').length} words, ${bigEntries.length} glossary entries): old ${oldMs.toFixed(0)} ms, new first pass ${coldMs.toFixed(0)} ms, next pass ${warmMs.toFixed(1)} ms`);
ok('a check of a long page after the first takes under 30 ms', warmMs < 30, warmMs.toFixed(1));

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
