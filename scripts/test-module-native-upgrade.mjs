import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const manifest=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const lock=JSON.parse(readFileSync(new URL('../package-lock.json',import.meta.url),'utf8'));
const root=lock.packages?.['']||{};
const upgraded=['next','three','maplibre-gl','@react-three/fiber','@react-three/drei',
  '@opennextjs/cloudflare','wrangler'];

test('upgraded dependency specs match npm lockfile root',()=>{
  for(const name of upgraded){
    const declared=manifest.dependencies?.[name]??manifest.devDependencies?.[name];
    const locked=root.dependencies?.[name]??root.devDependencies?.[name];
    assert.equal(locked,declared,name+' must be installed and lockfile regenerated');
    assert.ok(lock.packages['node_modules/'+name],name+' must have a resolved lockfile entry');
  }
});

test('ZenStack is not a runtime or development dependency',()=>{
  for(const section of ['dependencies','devDependencies']){
    assert.ok(!Object.keys(manifest[section]||{}).some(name=>/zenstack/i.test(name)));
  }
});

test('native Recharts responsive replaces redundant wrappers in Rune views',()=>{
  for(const path of [
    '../app/lrunes/RuneAppDayNightDashboard.jsx',
    '../app/lrunes/DailyRuneAnalytics.jsx',
    '../app/lrunes/game/GameBoard.jsx',
    '../app/lrunes/game/GameView.jsx'
  ]){
    const source=readFileSync(new URL(path,import.meta.url),'utf8');
    assert.match(source,/<(?:LineChart|BarChart|ComposedChart) responsive style=/);
    assert.doesNotMatch(source,/ResponsiveContainer/);
  }
});
