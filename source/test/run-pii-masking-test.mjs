#!/usr/bin/env node
/**
 * PII masking — whole words only.
 *
 * Names were masked inside other words: a stakeholder "Rose" broke "arose",
 * an app "Atlas" broke "atlases", a person "Ana" broke "analysis".
 *
 *   cd source && node test/run-pii-masking-test.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(tmpdir(), 'pm-codex-pii-masking-test');
mkdirSync(out, { recursive: true });
execFileSync('npx', [
  'tsc', 'src/utils/piiMasking.ts', '--outDir', out,
  '--module', 'esnext', '--target', 'es2022', '--skipLibCheck',
], { cwd: root, stdio: 'inherit' });
writeFileSync(join(out, 'package.json'), '{"type":"module"}');
const { replaceWholeWords } = await import(pathToFileURL(join(out, 'piiMasking.js')).href);

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  if (got === want) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + '\n      got:  ' + got + '\n      want: ' + want); }
};

// A glossary with names, an app, variations, and a name inside another name.
const entries = [
  { originalTerm: 'Rose', placeholder: '[stakeholder R]', variations: ['Bu Rose'] },
  { originalTerm: 'Atlas', placeholder: '[core app]', variations: ['ATLAS'] },
  { originalTerm: 'Ana', placeholder: '[lab SME]', variations: ['dr. Ana', 'Anah'] },
  { originalTerm: 'Mark', placeholder: '[SPOC]', variations: ['Pak Mark', 'Marc'] },
  { originalTerm: 'Dan', placeholder: '[person D]', variations: [] },
  { originalTerm: 'Jordan', placeholder: '[person J]', variations: [] },
  { originalTerm: 'Will', placeholder: '[person W]', variations: [] },
];
const pairs = [];
for (const e of entries) {
  pairs.push({ find: e.originalTerm, replace: e.placeholder });
  for (const v of e.variations) pairs.push({ find: v, replace: e.placeholder });
}
const mask = (t) => replaceWholeWords(t, pairs, true);
const unmask = (t) => replaceWholeWords(t, entries.map((e) => ({ find: e.placeholder, replace: e.originalTerm })), false);

// --- a name inside an ordinary word is left alone
eq('arose is not Rose', mask('the issue arose twice'), 'the issue arose twice');
eq('atlases is not Atlas', mask('two atlases'), 'two atlases');
eq('analysis is not Ana', mask('analysis by unit'), 'analysis by unit');
eq('other inner words', mask('Remarks on the banana and Dan'), 'Remarks on the banana and [person D]');
eq('Jordan is not Dan', mask('Jordan and Dan'), '[person J] and [person D]');
// Known limit: a name that is also a whole word still masks, as case is ignored.
eq('name that is a word', mask('it will work'), 'it [person W] work');

// --- names still mask
eq('plain name', mask('Rose approved it'), '[stakeholder R] approved it');
eq('any case', mask('rose, ROSE, Rose'), '[stakeholder R], [stakeholder R], [stakeholder R]');
eq('possessive', mask("Rose's sign-off"), "[stakeholder R]'s sign-off");
eq('punctuation around', mask('(Ana), Ana. "Ana"'), '([lab SME]), [lab SME]. "[lab SME]"');
eq('longer variation first', mask('Bu Rose and dr. Ana'), '[stakeholder R] and [lab SME]');
eq('variation', mask('Anah said'), '[lab SME] said');
eq('app name', mask('ATLAS data, Atlas env'), '[core app] data, [core app] env');
eq('Indonesian -nya with hyphen', mask('Ana-nya setuju'), '[lab SME]-nya setuju');
eq('line edges', mask('Mark\nMarc'), '[SPOC]\n[SPOC]');

// --- a placeholder is never masked again
const pairs2 = [{ find: 'Atlas', replace: '[core app]' }, { find: 'app', replace: '[X]' }];
eq('one pass', replaceWholeWords('Atlas app', pairs2, true), '[core app] [X]');

// --- reconstruct
eq('round trip', unmask(mask('Bu Rose asked dr. Ana about ATLAS; analysis arose.')),
  'Rose asked Ana about Atlas; analysis arose.');
eq('placeholder glued to text', unmask('[core app]es'), 'Atlases');

// --- accents and edge cases
eq('accented neighbour', replaceWholeWords('Renée Ren', [{ find: 'Ren', replace: '[N]' }], true), 'Renée [N]');
eq('empty list', replaceWholeWords('Rose', [], true), 'Rose');

// --- speed: a big context with a big glossary
const big = 'Rose and the analysis of Atlas, which arose for Ana. '.repeat(20000);
const many = [...pairs];
for (let i = 0; i < 300; i++) many.push({ find: 'Name' + i, replace: '[n' + i + ']' });
const t0 = Date.now();
const res = replaceWholeWords(big, many, true);
const ms = Date.now() - t0;
eq('big text correct', res.slice(0, 70), '[stakeholder R] and the analysis of [core app], which arose for [lab SME]. '.slice(0, 70));
if (ms < 2000) { pass++; console.log('PASS  big text fast (' + ms + ' ms)'); } else { fail++; console.log('FAIL  big text slow (' + ms + ' ms)'); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
