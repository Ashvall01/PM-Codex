/**
 * The timeline sheet's formula engine against answers taken from Excel.
 *
 *   cd source && npx tsx test/sheet-engine.test.ts
 */
import { recalcRows, evaluateFormulaAt } from '../src/features/Timeline/sheet/recalc';
import { shiftFormula, remapFormulaRows, followMovedBlock } from '../src/features/Timeline/sheet/refs';
import * as D from '../src/features/Timeline/sheet/dates';
import { planFill } from '../src/features/Timeline/sheet/fill';
import { parseInput, parseTSV, toTSV, editText } from '../src/features/Timeline/sheet/input';
import { COLUMNS } from '../src/features/Timeline/sheet/columns';
import { mergeRowUpdate, applySheetRules } from '../src/features/Timeline/sheet/rules';
import { applyStep } from '../src/features/Timeline/sheet/applyStep';

let pass = 0, failN = 0;
function eq(name: string, got: any, want: any) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { failN++; console.log(`FAIL ${name}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); }
}

const TODAY = D.ymdToSerial(2026, 9, 24);
const blank = (id: string, extra: any = {}) => ({
  id, phase: '', activity: '', subActivity: '', weight: 0, progress: 0, status: 'Planned', owner: '',
  targetStartDate: '', targetCompletionDate: '', actualStartDate: '', actualCompletionDate: '', remarks: '', ...extra,
});

/** One formula in REMARKS (text) or another column of row 1, with row 1 = start 2026-09-24. */
function f(formula: string, key = 'remarks', rows?: any[], holidays: string[] = []) {
  const base = rows ?? [blank('r1', { targetStartDate: '2026-09-24', weight: 3, progress: 0.5, status: 'Completed' })];
  const withF = base.map((r, i) => (i === 0 ? { ...r, formulas: { ...(r.formulas || {}), [key]: formula } } : r));
  return recalcRows(withF, holidays, TODAY).rows[0][key];
}

// ---- dates basics
eq('serial of 2026-09-24', D.ymdToSerial(2026, 9, 24), 46289);
eq('iso back', D.serialToIso(46289), '2026-09-24');
eq('parse dd/mm', D.serialToIso(D.parseDateText('05/06/2026')!), '2026-06-05');
eq('parse 12 Mei 2026', D.serialToIso(D.parseDateText('12 Mei 2026')!), '2026-05-12');
eq('parse May 12, 2026', D.serialToIso(D.parseDateText('May 12, 2026')!), '2026-05-12');
eq('parse 12-May-26', D.serialToIso(D.parseDateText('12-May-26')!), '2026-05-12');
eq('parse iso with time', D.serialToIso(D.parseDateText('2026-03-30T17:00:00.000Z')!), '2026-03-30');
eq('parse 31/02 is not a date', D.parseDateText('31/02/2026'), null);
eq('parse 5/6 this year', D.serialToIso(D.parseDateText('5/6', new Date(2026, 0, 1))!), '2026-06-05');
eq('parse words', D.parseDateText('hello'), null);

// ---- date functions (Excel answers)
eq('WEEKDAY thu', f('=WEEKDAY(H1)', 'weight'), 5);
eq('WEEKDAY type 2', f('=WEEKDAY(H1,2)', 'weight'), 4);
eq('WORKDAY +5', f('=WORKDAY(H1,5)', 'targetCompletionDate'), '2026-10-01');
eq('WORKDAY from Sat +1', f('=WORKDAY(DATE(2026,9,26),1)', 'targetCompletionDate'), '2026-09-28');
eq('WORKDAY 0 on Sat', f('=WORKDAY(DATE(2026,9,26),0)', 'targetCompletionDate'), '2026-09-26');
eq('WORKDAY -1 from Mon', f('=WORKDAY(DATE(2026,9,28),-1)', 'targetCompletionDate'), '2026-09-25');
eq('WORKDAY project holiday', f('=WORKDAY(DATE(2026,9,25),1)', 'targetCompletionDate', undefined, ['2026-09-28']), '2026-09-29');
eq('WORKDAY HOLIDAYS name', f('=WORKDAY(DATE(2026,9,25),1,HOLIDAYS)', 'targetCompletionDate', undefined, ['2026-09-28']), '2026-09-29');
eq('WORKDAY own list wins', f('=WORKDAY(DATE(2026,9,25),1,DATE(2026,9,29))', 'targetCompletionDate', undefined, ['2026-09-28']), '2026-09-28');
eq('WORKDAY.INTL sun only', f('=WORKDAY.INTL(H1,5,11)', 'targetCompletionDate'), '2026-09-30');
eq('WORKDAY.INTL string', f('=WORKDAY.INTL(H1,5,"0000011")', 'targetCompletionDate'), '2026-10-01');
eq('NETWORKDAYS Sep rollout', f('=NETWORKDAYS(DATE(2026,9,1),DATE(2026,9,28))', 'weight'), 20);
eq('NETWORKDAYS reversed', f('=NETWORKDAYS(DATE(2026,9,28),DATE(2026,9,1))', 'weight'), -20);
eq('NETWORKDAYS with holiday', f('=NETWORKDAYS(DATE(2026,9,1),DATE(2026,9,28))', 'weight', undefined, ['2026-09-15', '2026-09-19']), 19);
eq('EDATE end of month', f('=EDATE(DATE(2026,1,31),1)', 'targetCompletionDate'), '2026-02-28');
eq('EDATE back', f('=EDATE(DATE(2026,3,31),-1)', 'targetCompletionDate'), '2026-02-28');
eq('EOMONTH', f('=EOMONTH(DATE(2024,1,15),1)', 'targetCompletionDate'), '2024-02-29');
eq('EOMONTH 0', f('=EOMONTH(H1,0)', 'targetCompletionDate'), '2026-09-30');
eq('DATEDIF M', f('=DATEDIF(DATE(2026,1,15),H1,"M")', 'weight'), 8);
eq('DATEDIF D', f('=DATEDIF(DATE(2026,1,15),H1,"D")', 'weight'), 252);
eq('DATEDIF MD', f('=DATEDIF(DATE(2026,1,15),H1,"MD")', 'weight'), 9);
eq('DATEDIF Y', f('=DATEDIF(DATE(2020,10,1),H1,"Y")', 'weight'), 5);
eq('DATEDIF start after end', f('=DATEDIF(H1,DATE(2026,1,1),"D")', 'weight'), '#NUM!');
eq('DAYS', f('=DAYS(DATE(2026,10,1),H1)', 'weight'), 7);
eq('date + 5', f('=H1+5', 'targetCompletionDate'), '2026-09-29');
eq('date - date', f('=DATE(2026,10,1)-H1', 'weight'), 7);
eq('bare iso literal', f('=2026-05-12+5', 'targetCompletionDate'), '2026-05-17');
eq('date text coerced', f('="12/05/2026"+1', 'targetCompletionDate'), '2026-05-13');
eq('TODAY', f('=TODAY()', 'targetCompletionDate'), '2026-09-24');
eq('YEAR MONTH DAY', f('=YEAR(H1)*10000+MONTH(H1)*100+DAY(H1)', 'weight'), 20260924);
eq('WEEKNUM', f('=WEEKNUM(H1)', 'weight'), 39);
eq('ISOWEEKNUM', f('=ISOWEEKNUM(H1)', 'weight'), 39);
eq('ISOWEEKNUM jan 1 2027', f('=ISOWEEKNUM(DATE(2027,1,1))', 'weight'), 53);
eq('date in text column', f('=H1+1'), '25 Sep 2026');
eq('TEXT date', f('=TEXT(H1,"dd mmm yyyy")'), '24 Sep 2026');
eq('TEXT dddd', f('=TEXT(H1,"dddd, d mmmm")'), 'Thursday, 24 September');
eq('TEXT pct', f('=TEXT(0.756,"0%")'), '76%');
eq('TEXT thousands', f('=TEXT(1234.5,"#,##0.00")'), '1,234.50');

// ---- operators and errors
eq('-2^2', f('=-2^2', 'weight'), 4);
eq('2^3^2', f('=2^3^2', 'weight'), 64);
eq('precedence', f('=1+2*3', 'weight'), 7);
eq('percent', f('=50%*10', 'weight'), 5);
eq('div0', f('=1/0', 'weight'), '#DIV/0!');
eq('concat', f('="a"&1&TRUE'), 'a1TRUE');
eq('text + 1', f('=1+"x"', 'weight'), '#VALUE!');
eq('bad name', f('=FOO(1)', 'weight'), '#NAME?');
eq('bad syntax', f('=1+', 'weight'), '#ERROR!');
eq('semicolons', f('=WORKDAY(H1;5)', 'targetCompletionDate'), '2026-10-01');
eq('lowercase', f('=workday(h1,5)', 'targetCompletionDate'), '2026-10-01');
eq('IF text', f('=IF(H1>DATE(2026,1,1),"late","ok")'), 'late');
eq('IF missing false', f('=IF(1>2,"a")'), 'FALSE');
eq('IFERROR', f('=IFERROR(1/0,"none")'), 'none');
eq('AND OR', f('=AND(D1=3,OR(E1>1,F1="completed"))'), 'TRUE');
eq('comparisons text case', f('=F1="COMPLETED"'), 'TRUE');
eq('0.1+0.2', f('=0.1+0.2'), '0.3');
eq('ROUND half away', f('=ROUND(2.5,0)+ROUND(-2.5,0)*10', 'weight'), -27);
eq('ROUND 1.005', f('=ROUND(1.005,2)', 'weight'), 1.01);
eq('ROUNDUP', f('=ROUNDUP(1.21,1)', 'weight'), 1.3);
eq('MOD negative', f('=MOD(-3,2)', 'weight'), 1);

// ---- this-row refs
eq('[Target Start]', f('=WORKDAY([Target Start],5)', 'targetCompletionDate'), '2026-10-01');
eq('[@Target Start]', f('=[@Target Start]+1', 'targetCompletionDate'), '2026-09-25');
eq('[@[Target Start]]', f('=[@[Target Start]]+1', 'targetCompletionDate'), '2026-09-25');
eq('old TARGETSTART', f('=WORKDAY(TARGETSTART, 5)', 'targetCompletionDate'), '2026-10-01');
eq('bad column name', f('=[Nope]+1', 'weight'), '#REF!');
eq('ROW()', f('=ROW()', 'weight'), 1);

// ---- whole sheet
const sheet = [
  blank('a', { weight: 2, progress: 1, status: 'Completed', targetStartDate: '2026-09-01' }),
  blank('b', { weight: 3, progress: 0.5, status: 'Work In Progress', formulas: { targetStartDate: '=WORKDAY(I1,1)', targetCompletionDate: '=WORKDAY(H2,4)' } }),
  blank('c', { weight: 5, progress: 0, status: 'Planned', formulas: { targetStartDate: '=WORKDAY(I2,1)', targetCompletionDate: '=H3+9' } }),
];
sheet[0].formulas = { targetCompletionDate: '=WORKDAY(H1,9)' };
const out = recalcRows(sheet as any, [], TODAY).rows;
eq('chain a end', out[0].targetCompletionDate, '2026-09-14');
eq('chain b start', out[1].targetStartDate, '2026-09-15');
eq('chain b end', out[1].targetCompletionDate, '2026-09-21');
eq('chain c start', out[2].targetStartDate, '2026-09-22');
eq('chain c end', out[2].targetCompletionDate, '2026-10-01');
const sumSheet = [...out, blank('d', { formulas: { weight: '=SUM(D1:D3)', progress: '=SUMPRODUCT(D1:D3,E1:E3)/SUM(D1:D3)', remarks: '=COUNTIF(F1:F3,"Completed")&" done, last end "&TEXT(MAX(I1:I3),"d mmm")' } })];
const s2 = recalcRows(sumSheet as any, [], TODAY).rows;
eq('SUM', s2[3].weight, 10);
eq('weighted progress', s2[3].progress, 0.35);
eq('summary text', s2[3].remarks, '1 done, last end 1 Oct');
eq('whole column', recalcRows([...out, blank('e', { formulas: { remarks: '=COUNTA(F:F)' } })] as any, [], TODAY).rows[3].remarks, '4');
const loop = recalcRows([blank('x', { formulas: { targetStartDate: '=I1', targetCompletionDate: '=H1+1' } })] as any, [], TODAY).rows[0];
eq('loop', [loop.targetStartDate, loop.targetCompletionDate], ['#CIRCULAR!', '#CIRCULAR!']);
const unchanged = recalcRows(out as any, [], TODAY);
eq('no change keeps rows', unchanged.changed, false);
eq('ref past last row is blank', f('=ISBLANK(H99)'), 'TRUE');
eq('ref to column M', f('=M1', 'weight'), '#REF!');
eq('update chain on edit', recalcRows(out.map((r: any, i: number) => i === 0 ? { ...r, targetStartDate: '2026-09-08' } : r) as any, [], TODAY).rows[2].targetCompletionDate, '2026-10-08');

// ---- live answer while typing
eq('evaluateAt', evaluateFormulaAt('=WORKDAY(H1,5)', out as any, 1, 8).stored, '2026-09-08');
eq('evaluateAt virtual row', evaluateFormulaAt('=[Target Start]+2', out as any, null, 8, [], blank('v', { targetStartDate: '2026-01-01' })).stored, '2026-01-03');

// ---- moving refs
eq('shift relative', shiftFormula('=H1+$I$2+H$3+$H4', 2, 1), '=I3+$I$2+I$3+$H6');
eq('shift range', shiftFormula('=SUM(D1:D3)', 1, 0), '=SUM(D2:D4)');
eq('shift off the top', shiftFormula('=H1', -1, 0), '=#REF!');
eq('shift keeps strings', shiftFormula('=IF(H1>0,"A1","B2")', 1, 0), '=IF(H2>0,"A1","B2")');
eq('shift keeps this-row', shiftFormula('=[Target Start]+H1', 1, 0), '=[Target Start]+H2');
const ids = ['a', 'b', 'c'];
const idx = (arr: string[]) => new Map(arr.map((id, i) => [id, i]));
eq('delete row -> #REF!', remapFormulaRows('=H1+H2', ids, idx(['a', 'c']), 2), '=H1+#REF!');
eq('insert above', remapFormulaRows('=H1+H3', ids, idx(['x', 'a', 'b', 'c']), 4), '=H2+H4');
eq('move row', remapFormulaRows('=H1', ids, idx(['b', 'c', 'a']), 3), '=H3');
eq('range grows', remapFormulaRows('=SUM(D1:D3)', ids, idx(['a', 'x', 'b', 'c']), 4), '=SUM(D1:D4)');
eq('range shrinks', remapFormulaRows('=SUM(D1:D3)', ids, idx(['b', 'c']), 2), '=SUM(D1:D2)');
eq('range all gone', remapFormulaRows('=SUM(D2:D2)', ids, idx(['a', 'c']), 2), '=SUM(#REF!)');
eq('append rows keeps ref below data', remapFormulaRows('=H9', ids, idx(['a', 'b', 'c', 'n1', 'n2']), 5), '=H9');
eq('insert above moves ref below data', remapFormulaRows('=H9', ids, idx(['x', 'a', 'b', 'c']), 4), '=H10');
eq('absolute follows row too', remapFormulaRows('=$H$3', ids, idx(['x', 'a', 'b', 'c']), 4), '=$H$4');
eq('move block', followMovedBlock('=H2+I5', { r1: 1, c1: 7, r2: 1, c2: 7 }, 2, 0), '=H4+I5');
eq('move onto a ref', followMovedBlock('=H4', { r1: 1, c1: 7, r2: 1, c2: 7 }, 2, 0, { r1: 3, c1: 7, r2: 3, c2: 7 }), '=#REF!');


// ---- fill handle
const colOf = (k: string) => COLUMNS.find((c) => c.key === k)!;
const vals = (o: any[]) => o.map((x) => ('value' in x ? x.value : `copy${x.copyFrom}`));
eq('fill one number copies', vals(planFill([{ value: 5 }], 3, colOf('weight'), false)), ['copy0', 'copy0', 'copy0']);
eq('fill one number alt counts', vals(planFill([{ value: 5 }], 2, colOf('weight'), true)), [6, 7]);
eq('fill 1,2', vals(planFill([{ value: 1 }, { value: 2 }], 3, colOf('weight'), false)), [3, 4, 5]);
eq('fill 2,4,7 trend', vals(planFill([{ value: 2 }, { value: 4 }, { value: 7 }], 1, colOf('weight'), false)), [9.33333333333]);
eq('fill one date', vals(planFill([{ value: '2026-09-30' }], 2, colOf('targetStartDate'), false)), ['2026-10-01', '2026-10-02']);
eq('fill one date up', vals(planFill([{ value: '2026-09-01' }], 2, colOf('targetStartDate'), false, -1)), ['2026-08-31', '2026-08-30']);
eq('fill weekly', vals(planFill([{ value: '2026-09-01' }, { value: '2026-09-08' }], 2, colOf('targetStartDate'), false)), ['2026-09-15', '2026-09-22']);
eq('fill 31 Jan, 28 Feb steps by days', vals(planFill([{ value: '2026-01-31' }, { value: '2026-02-28' }], 1, colOf('targetStartDate'), false)), ['2026-03-28']);
eq('fill monthly same day', vals(planFill([{ value: '2026-01-15' }, { value: '2026-02-15' }], 2, colOf('targetStartDate'), false)), ['2026-03-15', '2026-04-15']);
eq('fill text number', vals(planFill([{ value: 'Item 09' }], 2, colOf('remarks'), false)), ['Item 10', 'Item 11']);
eq('fill text repeats', vals(planFill([{ value: 'a' }, { value: 'b' }], 3, colOf('remarks'), false)), ['copy0', 'copy1', 'copy0']);
eq('fill formula copies', vals(planFill([{ value: '2026-01-01', formula: '=H1+1' }], 2, colOf('targetStartDate'), false)), ['copy0', 'copy0']);
eq('fill percent series', vals(planFill([{ value: 0.1 }, { value: 0.2 }], 2, colOf('progress'), false)), [0.3, 0.4]);

// ---- typing
eq('type dd/mm', parseInput(colOf('targetStartDate'), '05/06/2026'), { value: '2026-06-05' });
eq('type bad date', !!parseInput(colOf('targetStartDate'), '31/31/2026').invalid, true);
eq('type pct', parseInput(colOf('progress'), '75%'), { value: 0.75 });
eq('type pct no sign', parseInput(colOf('progress'), '75'), { value: 0.75 });
eq('type comma decimal', parseInput(colOf('weight'), '1,5'), { value: 1.5 });
eq('type status loose', parseInput(colOf('status'), 'work in'), { value: 'Work In Progress' });
eq('type formula', parseInput(colOf('targetStartDate'), '=H1+1').formula, '=H1+1');
eq('edit text date', editText({ targetStartDate: '2026-06-05' }, colOf('targetStartDate')), '05/06/2026');
eq('edit text pct', editText({ progress: 0.755 }, colOf('progress')), '75.5%');
eq('tsv round trip', parseTSV(toTSV([['a', 'b\tc'], ['"q"', 'line\nbreak']])), [['a', 'b\tc'], ['"q"', 'line\nbreak']]);
eq('tsv from sheets', parseTSV('1\t2\n3\t4\n'), [['1', '2'], ['3', '4']]);

// ---- store rules
const r0: any = { id: 'a', targetStartDate: '2026-09-24', targetCompletionDate: '2026-10-01', formulas: { targetCompletionDate: '=WORKDAY(H1,5)' } };
eq('same value keeps formula', mergeRowUpdate(r0, { targetCompletionDate: '2026-10-01' }).formulas, { targetCompletionDate: '=WORKDAY(H1,5)' });
eq('new value drops formula', mergeRowUpdate(r0, { targetCompletionDate: '2026-10-09' }).formulas, undefined);
eq('value = formula', mergeRowUpdate(r0, { targetStartDate: '=DATE(2026,1,1)' } as any).formulas, { targetCompletionDate: '=WORKDAY(H1,5)', targetStartDate: '=DATE(2026,1,1)' });
const before = [blank('a', { targetStartDate: '2026-09-24' }), blank('b'), blank('c', { formulas: { targetStartDate: '=I1+1' } })];
const afterIns = applySheetRules(before as any, [blank('x'), ...before] as any, []);
eq('insert row keeps ref on row', afterIns[3].formulas.targetStartDate, '=I2+1');
const afterDel = applySheetRules(before as any, [before[1], before[2]] as any, []);
eq('delete referenced row', [afterDel[1].formulas.targetStartDate, afterDel[1].targetStartDate], ['=#REF!+1', '#REF!']);

// ---- undo keeps later changes
const s0: any[] = [{ id: 'a', v: 1 }, { id: 'b', v: 1 }];
const s1: any[] = [{ id: 'a', v: 2 }, { id: 'b', v: 1 }];         // the user's step
const t2: any[] = [{ id: 'a', v: 2 }, { id: 'b', v: 9 }];         // Claude changed b after
eq('undo only its own change', applyStep(t2 as any, s1 as any, s0 as any), [{ id: 'a', v: 1 }, { id: 'b', v: 9 }]);
const d1: any[] = [{ id: 'b', v: 1 }];
eq('undo a delete', applyStep(d1 as any, d1 as any, s0 as any), s0);
eq('undo an insert', applyStep(s0.concat([{ id: 'n', v: 0 }]) as any, s0.concat([{ id: 'n', v: 0 }]) as any, s0 as any), s0);

console.log(`\n${pass} passed, ${failN} failed`);
process.exit(failN ? 1 : 0);
