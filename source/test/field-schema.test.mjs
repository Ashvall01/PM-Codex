/**
 * FIELD SCHEMA — checks that get_field_schema actually agrees with the stores
 * it describes.
 *
 * WHY THIS FILE EXISTS
 * ---------------------
 * fieldSchema.ts exists because PLAN.md section 17 item 1 (9 Sep): a proposal
 * that sent impactLevel: 'Medium' failed silently because 'Medium' is not a
 * member of risksStore's ImpactLevel union. The whole point of this tool is
 * that the values it reports are the values the store will actually accept —
 * so this file drives risksStore for real and checks the schema's risk matrix
 * against calculateRiskValue's real answers, not just that the shape looks
 * right.
 *
 * HOW TO RUN IT
 * -------------
 *   cd source
 *   node test/run-field-schema-test.mjs
 */

import assert from 'node:assert';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? '  — ' + extra : '')); }
};

const { getFieldSchema } = await import('./services/fieldSchema.js');
const { useRisksStore, calculateRiskValue } = await import('./store/risksStore.js');

// --------------------------------------------------------------- risks module

const risks = getFieldSchema('risks');
ok('risks schema names its module', risks.module === 'risks');

const impactField = risks.fields.find((f) => f.field === 'impactLevel');
ok('impactLevel is reported as an enum', impactField?.kind === 'enum', JSON.stringify(impactField));
ok('impactLevel uses "Moderate", never the generic "Medium"',
   impactField.values.includes('Moderate') && !impactField.values.includes('Medium'),
   JSON.stringify(impactField.values));

const probField = risks.fields.find((f) => f.field === 'probability');
ok('probability is reported as an enum', probField?.kind === 'enum');
ok('probability does not include "Medium" either',
   !probField.values.includes('Medium'), JSON.stringify(probField.values));

const riskValueField = risks.fields.find((f) => f.field === 'riskValue');
ok('riskValue is marked computed, not settable', riskValueField?.kind === 'computed');

const controlField = risks.fields.find((f) => f.field === 'controlAnnexA');
ok('controlAnnexA is reported as free text', controlField?.kind === 'text');

ok('risks schema lists the actions that write it',
   ['addProjectRisk', 'updateProjectRisk', 'deleteProjectRisk'].every((a) => risks.actions.includes(a)),
   JSON.stringify(risks.actions));

// The schema's matrix must be THE SAME OBJECT the store actually uses, not a
// stale copy — so every impact/probability pair in the schema is checked
// against calculateRiskValue itself, live.
ok('the schema carries the live matrix, not the shipped default',
   risks.riskMatrix.matrix === useRisksStore.getState().riskMatrixConfig);

let allMatch = true;
const mismatches = [];
for (const impact of risks.riskMatrix.impactLevels) {
  for (const probability of risks.riskMatrix.probabilityLevels) {
    const schemaValue = risks.riskMatrix.matrix[impact]?.[probability];
    const storeValue = calculateRiskValue(impact, probability, useRisksStore.getState().riskMatrixConfig);
    if (schemaValue !== storeValue) { allMatch = false; mismatches.push(`${impact}/${probability}: schema=${schemaValue} store=${storeValue}`); }
  }
}
ok('every cell the schema reports matches what calculateRiskValue actually returns',
   allMatch, mismatches.join('; '));

// Prove the schema would have caught the original bug: a proposal using the
// generic 'Medium' is simply not one of the values get_field_schema hands back,
// so a caller that reads this before proposing has no way to repeat it.
ok('"Medium" is not a valid impactLevel or probability per the schema — the original bug is unreachable if this is read first',
   !impactField.values.includes('Medium') && !probField.values.includes('Medium'));

// A custom matrix (the user edits this in Risk Matrix Settings) must be
// reflected immediately — the schema does not cache a snapshot from import time.
const before = useRisksStore.getState().riskMatrixConfig;
const customMatrix = { ...before, Low: { ...before.Low, Rare: 'CUSTOM-TEST-VALUE' } };
useRisksStore.getState().updateRiskMatrix(customMatrix);
const afterSchema = getFieldSchema('risks');
ok('a live matrix edit is reflected on the next call, not cached from import time',
   afterSchema.riskMatrix.matrix.Low.Rare === 'CUSTOM-TEST-VALUE',
   afterSchema.riskMatrix.matrix.Low.Rare);
useRisksStore.getState().updateRiskMatrix(before); // restore

// ---------------------------------------------------------- other modules

const tasks = getFieldSchema('tasks');
ok('tasks priority uses the generic Low/Medium/High scale (unlike risks)',
   tasks.fields.find((f) => f.field === 'priority')?.values?.includes('Medium'));
ok('tasks status is a closed enum', Array.isArray(tasks.fields.find((f) => f.field === 'status')?.values));

const deliverables = getFieldSchema('deliverables');
ok('deliverables status includes "Signed Off"',
   deliverables.fields.find((f) => f.field === 'status')?.values?.includes('Signed Off'));

const moms = getFieldSchema('moms');
ok('moms schema reports action-item fields, not top-level MoM fields',
   moms.fields.every((f) => f.field.startsWith('actionItems[]')));
ok('moms schema points a bridge session at tasks for a linked action item',
   /updateTask/.test(moms.note || ''));

const codex = getFieldSchema('codex');
// Since 24 Sep a page must sit in a folder, and a folder has no content.
ok('codex names the folder a new page goes into', codex.fields.some((f) => f.field === 'parentId'));
ok('codex says folders hold pages and have no content', /folder/i.test(codex.note || '') && /no content/i.test(codex.note || ''));
ok('codex lists the folder action', codex.actions.includes('createCodexFolder'));

const timeline = getFieldSchema('timeline');
ok('timeline describes the holiday list and says to send it whole', timeline.fields.some((f) => f.field === 'holidays' && /WHOLE list/.test(f.note || '')));
ok('timeline explains formulas', timeline.fields.some((f) => f.field === 'formulas' && /=WORKDAY/.test(f.note || '')));
ok('timeline lists setTimelineHolidays', timeline.actions.includes('setTimelineHolidays'));

const project = getFieldSchema('project');
ok('project has no constrained fields', project.fields.length === 0);

const unknown = getFieldSchema('not-a-real-module');
ok('an unrecognized module gets an explicit note, not a throw or a silent empty object',
   unknown.fields.length === 0 && /not-a-real-module/.test(unknown.note || ''), JSON.stringify(unknown));

console.log('\n' + pass + '/' + (pass + fail) + ' checks passed');
process.exit(fail ? 1 : 0);
