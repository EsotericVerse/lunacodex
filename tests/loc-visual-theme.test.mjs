import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {THEME_TOKEN_KEYS} from '../app/modular/theme-registry.js';
import {PUBLISHED_THEME_META} from '../app/modular/published-theme-meta.js';
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


const themeSource=relative=>readFile(new URL('../'+relative,import.meta.url),'utf8');
const canonicalThemeTokens=[
  '--loc-bg','--loc-panel','--loc-panel-2','--loc-line','--loc-text',
  '--loc-muted','--loc-heading','--loc-accent','--loc-gold','--loc-danger'
];

test('LOC keeps the original four Day and four Dark Theme identities',()=>{
  assert.deepEqual(PUBLISHED_THEME_META.map(([id,,scheme])=>[id,scheme]),[
    ['theme-1','dark'],['theme-2','light'],['theme-3','light'],['theme-4','dark'],
    ['theme-5','light'],['theme-6','dark'],['theme-7','light'],['theme-8','dark']
  ]);
});

test('published palettes store only the ten canonical color tokens',async()=>{
  assert.deepEqual(THEME_TOKEN_KEYS,canonicalThemeTokens);
  for(let id=1;id<=8;id++){
    const css=await themeSource('public/themes/theme-'+id+'.css');
    const tokens=[...css.matchAll(/^\s*(--loc-[\w-]+)\s*:/gm)].map(match=>match[1]);
    assert.deepEqual(tokens,canonicalThemeTokens,'theme-'+id+' should publish only canonical palette colors');
  }
});

test('each Theme defines all five visual dimensions for runtime and local preview',async()=>{
  const css=await themeSource('app/styles/theme-visual-system.css');
  for(let id=1;id<=8;id++){
    assert.ok(css.includes(':root[data-theme-id="theme-'+id+'"]'));
    assert.ok(css.includes('.admin-theme-local-preview[data-theme-id="theme-'+id+'"]'));
  }
  for(const token of [
    '--loc-material-radius','--loc-material-edge-style',
    '--loc-theme-divider-style','--loc-font-heading',
    '--loc-theme-atmosphere','--loc-theme-bubble-radius'
  ])assert.ok(css.includes(token),'missing visual dimension token '+token);
  assert.ok(css.includes('body.loc-app-shell :is('));
});

test('Theme Editor keeps Day/Dark fixed and previews the complete visual system',async()=>{
  const editor=await themeSource('app/loc/views/admin-panels/ThemeEditor.jsx');
  assert.doesNotMatch(editor,/function setScheme|setScheme\(/);
  assert.ok(editor.includes("scheme:THEME_SLOTS.find(slot=>slot.id===themeId)?.scheme||'light'"));
  assert.ok(editor.includes('data-theme-id={themeId}'));
  assert.ok(editor.includes('admin-theme-preview-dimensions'));
  assert.ok(editor.includes('明暗系列'));
});

test('public Theme publication rejects any change to the fixed Day/Dark grouping',async()=>{
  const publisher=await themeSource('scripts/generate-public-blocks.mjs');
  assert.ok(publisher.includes("const THEME_SCHEME_BY_ID=Object.freeze({1:'dark',2:'light',3:'light',4:'dark',5:'light',6:'dark',7:'light',8:'dark'});"));
  assert.ok(publisher.includes('must retain its fixed'));
  assert.ok(publisher.includes('const publishedTheme='));
});
