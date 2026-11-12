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
