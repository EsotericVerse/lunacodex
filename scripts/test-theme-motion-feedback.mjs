import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from '@babel/parser';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('theme accent feedback is scoped to a user-selected palette, not the theme engine',()=>{
  const src=read('app/AppShell.jsx');
  assert.ok(parse(src,{sourceType:'module',plugins:['jsx']}).program.body.length>0);
  assert.match(src,/import \{motion,useReducedMotion\} from 'motion\/react'/);
  assert.match(src,/function ThemeSelect\(/);
  assert.match(src,/const \[accentPulse,setAccentPulse\]=useState\(0\)/);
  assert.match(src,/if\(next===selectedThemeId\)return/);
  assert.match(src,/setSelection\(\{scopeId,themeId:next\}\)/);
  assert.match(src,/setAccentPulse\(count=>count\+1\)/);
  assert.match(src,/accentPulse>0&&!reduceMotion\?<motion\.span/);
  assert.match(src,/initial=\{\{opacity:\.65,scale:\.65\}\} animate=\{\{opacity:0,scale:1\.7\}\}/);
  assert.match(src,/className="scope-theme-control__swatch" aria-hidden="true"/);
  assert.match(src,/className="scope-theme-control__accent"/);
  assert.match(src,/className="scope-theme-control__gold"/);
  assert.match(src,/root\.dataset\.themeSignature===themeSignature\(slot\)/);
  assert.match(src,/applyTheme\(slot\)/);
  assert.match(src,/window\.addEventListener\('loc-scope-theme-saved',onSaved\)/);
  assert.doesNotMatch(src,/setInterval\(/);
});

test('swatch colors come exclusively from active semantic Theme tokens',()=>{
  const css=read('app/styles/scope-system.css');
  assert.match(css,/\.scope-theme-control__swatch\{/);
  assert.match(css,/background-color:var\(--loc-accent\)/);
  assert.match(css,/background-color:var\(--loc-gold\)/);
  assert.match(css,/\.scope-theme-control__pulse\{/);
  assert.match(css,/pointer-events:none/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.doesNotMatch(css,/\.scope-theme-control__swatch[\s\S]*?--loc-accent:#/);
  const theme=read('app/modular/theme-registry.js');
  assert.match(theme,/THEME_TOKEN_KEYS\.forEach\(key=>root\.style\.removeProperty\(key\)\)/);
  assert.match(theme,/root\.dataset\.themeId=slot\.id/);
  assert.match(theme,/root\.style\.colorScheme=slot\.scheme/);
});

test('all eight published Theme foreground palettes meet readable panel contrast',()=>{
  const rows=JSON.parse(read('app/modular/published-theme-catalog.json'));
  assert.equal(rows.length,8);
  const luminance=hex=>{
    assert.match(hex,/^#[0-9a-f]{6}$/i);
    const channel=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255)
      .map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
    return channel[0]*.2126+channel[1]*.7152+channel[2]*.0722;
  };
  const contrast=(a,b)=>{
    const x=luminance(a),y=luminance(b);
    return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
  };
  for(const row of rows){
    const label='theme-'+row.theme_id;
    for(const color of ['loc_text','loc_muted','loc_accent','loc_gold']){
      assert.ok(contrast(row[color],row.loc_panel)>=4.5,label+' '+color+' on panel');
    }
  }
});

test('Theme colors reach native BlockNote overlays, Rune dashboard and Trace map',()=>{
  const editor=read('app/loc/BlockNoteEditorClient.jsx');
  const rune=read('app/styles/scope-system.css');
  const dashboard=read('app/lrunes/RuneAppDayNightDashboard.jsx');
  const trace=read('app/styles/loc-ui-refresh.css');
  const map=read('app/styles/features.css');
  const start=rune.indexOf('.scope-rune-app-overview{');
  const end=rune.indexOf('/* Reusable article actions',start);
  assert.ok(start>=0&&end>start);
  const runeStyles=rune.slice(start,end);
  assert.match(runeStyles,/--rune-app-ink:var\(--loc-text\)/);
  assert.match(runeStyles,/--rune-app-accent:var\(--loc-accent\)/);
  assert.match(runeStyles,/\.scope-rune-app-overview\.is-night\{[^}]*--rune-app-accent:var\(--loc-gold\)/s);
  assert.doesNotMatch(runeStyles,/#[0-9a-f]{3,8}\b|rgba?\(/i);
  assert.match(dashboard,/<Tooltip contentStyle=\{\{color:'var\(--loc-text\)',backgroundColor:'var\(--loc-panel\)'/);
  assert.match(dashboard,/<Line dataKey="count" name="抽取紀錄" type="monotone" stroke="var\(--rune-app-accent\)"/);
  assert.match(editor,/const LOC_BLOCKNOTE_THEME=\{/);
  for(const key of ['editor','menu','tooltip','hovered','selected','disabled']){
    assert.ok(editor.includes(key+':{text:'),'BlockNote Theme '+key);
  }
  assert.match(editor,/theme=\{LOC_BLOCKNOTE_THEME\}/);
  assert.match(trace,/\.loc-trace-territory-lane:nth-child\(5n\+3\)[^\n]*var\(--loc-accent\)[^\n]*var\(--loc-gold\)/);
  assert.doesNotMatch(trace,/#bb86ed|#e989a0|#80bd8b/);
  assert.match(map,/\.loc-trace-anchor-marker\{[^}]*var\(--loc-accent-border\)[^}]*var\(--loc-text\)/s);
  assert.match(map,/\.loc-trace-map-frame \.maplibregl-ctrl-group\{[^}]*background:var\(--loc-panel-strong\)/s);
  assert.match(map,/:root\[data-theme="dark"\] \.loc-trace-map-frame \.maplibregl-ctrl-icon\{/);
});

test('footer swatch samples all four coordinated Theme color roles',()=>{
  const css=read('app/styles/scope-system.css');
  const start=css.indexOf('.scope-theme-control__swatch{');
  const end=css.indexOf('@media(prefers-reduced-motion:reduce)',start);
  assert.ok(start>=0&&end>start);
  const snippet=css.slice(start,end);
  for(const role of ['--loc-panel','--loc-text','--loc-accent','--loc-gold']){
    assert.ok(snippet.includes('var('+role+')'),role+' is absent from the active theme preview');
  }
});
