import test from 'node:test';
import assert from 'node:assert/strict';
import {visualColor,visualKeyColor,territoryColors,TERRITORY_STOPS,territoryLegendColor,territoryColorExpression} from '../app/modular/visual-palette.mjs';
import {cultureEraVisuals,paintCultureRows,eraVisualGradient} from '../app/modular/modules/culture-timeline/era-visuals.mjs';

test('theme-derived palette preserves distinct hues and stable lane identity',()=>{
  assert.equal(new Set(Array.from({length:8},(_,i)=>visualColor(i))).size,8);
  assert.match(visualColor(0),/var\(--loc-accent\)/);
  assert.equal(visualKeyColor('source:abc'),visualKeyColor('source:abc'));
  const light=territoryColors('#124987','#986c23'),dark=territoryColors('#80c5ff','#f6d980');
  assert.equal(new Set(light).size,5);assert.notDeepEqual(light,dark);
  assert.ok([...light,...dark].every(c=>/^#[a-f0-9]{6}$/.test(c)));
});
test('Era backgrounds keep real segments, stable colors, gaps and read-only semantics',()=>{
  const a={uid:'era00001',scope_id:'scope',entry_type:'era',group_order:0};
  const b={uid:'era00002',scope_id:'scope',entry_type:'era',group_order:10000};
  const records=[{...a,start_date:'2025-01-01',end_date:'2025-02-01'},
    {...a,start_date:'2025-03-01',end_date:'2025-04-01'},
    {...b,start_date:'2025-04-01',end_date:'2025-06-01'},
    {...b,start_date:'2025-07-01'}, {...a,start_date:'2025-09-01',end_date:'2025-08-01'}];
  const visuals=cultureEraVisuals(records);
  assert.equal(visuals.backgrounds.length,3);
  assert.equal(visuals.backgrounds[0].style,visuals.backgrounds[1].style);
  assert.notEqual(visuals.backgrounds[1].style,visuals.backgrounds[2].style);
  assert.ok(visuals.backgrounds.every(row=>row.type==='background'&&row.selectable===false&&row.editable===false&&!row.group));
  assert.deepEqual(cultureEraVisuals([...records].reverse()).backgrounds,visuals.backgrounds);
  const period={id:'period',raw:{entry_type:'period',scope_id:'scope',era_uid:a.uid}};
  const lucus={id:'lucus',raw:{entry_type:'lucus'}};
  const painted=paintCultureRows([period,lucus],visuals);
  assert.match(painted[0].className,/scope-era-period/);
  assert.strictEqual(painted[1],lucus);
  assert.equal(painted.length,5);
});

test('collapsed Era gradient clips intervals and leaves gaps unpainted',()=>{
  const a={uid:'era00001',scope_id:'scope',entry_type:'era',group_order:0};
  const records=[{...a,start_date:'2025-01-01',end_date:'2025-01-11'},
    {...a,start_date:'2025-01-21',end_date:'2025-02-01'}];
  const css=eraVisualGradient(records,'2025-01-06','2025-01-26');
  assert.equal((css.match(/linear-gradient/g)||[]).length,2);
  assert.match(css,/transparent 0\.00000%/);
  assert.match(css,/transparent 25\.00000%/);
  assert.match(css,/transparent 75\.00000%/);
  assert.match(css,/transparent 100\.00000%/);
  assert.equal(eraVisualGradient(records,'2026-01-01','2026-02-01'),undefined);
  assert.equal(eraVisualGradient(records,'2025-01-06','2025-01-06'),undefined);
});
test('territory legend and map use the same fixed article-count stops',()=>{
  const stops=territoryColorExpression('#124987','#986c23');
  assert.deepEqual(stops.slice(3).filter((_,i)=>i%2===0),TERRITORY_STOPS.map(([count])=>count));
  assert.deepEqual(stops.slice(3).filter((_,i)=>i%2===1),territoryColors('#124987','#986c23'));
  assert.match(territoryLegendColor(0),/var\(--loc-accent\)/);
  assert.match(territoryLegendColor(4),/var\(--loc-gold\)/);
});
