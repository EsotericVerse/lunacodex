import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';

const manifest=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const lock=JSON.parse(readFileSync(new URL('../package-lock.json',import.meta.url),'utf8'));
const root=lock.packages?.['']||{};
const upgraded=['next','three','maplibre-gl','wrangler'];

test('upgraded dependency specs match npm lockfile root',()=>{
  for(const name of upgraded){
    const declared=manifest.dependencies?.[name]??manifest.devDependencies?.[name];
    const locked=root.dependencies?.[name]??root.devDependencies?.[name];
    assert.equal(locked,declared,name+' must be installed and lockfile regenerated');
    assert.ok(lock.packages['node_modules/'+name],name+' must have a resolved lockfile entry');
  }
});

test('Unused React Three stack is absent while core Three.js remains',()=>{
  for(const name of ['@react-three/drei','@react-three/fiber','@react-three/postprocessing','postprocessing']){
    assert.equal(manifest.dependencies?.[name],undefined,name);
    assert.equal(lock.packages?.['node_modules/'+name],undefined,name);
  }
  assert.ok(manifest.dependencies?.three);
  assert.ok(lock.packages['node_modules/three']);
});

test('GitHub Pages has no retired Cloudflare Next adapter',()=>{
  assert.equal(manifest.scripts?.['build:cloudflare'],undefined);
  assert.equal(manifest.devDependencies?.['@opennextjs/cloudflare'],undefined);
  assert.equal(lock.packages['node_modules/@opennextjs/cloudflare'],undefined);
  for(const file of ['../open-next.config.ts','../wrangler.jsonc']){
    assert.equal(existsSync(new URL(file,import.meta.url)),false,file);
  }
});

test('ZenStack V3 dependencies are lockfile-consistent when installed',()=>{
  const packages=['@zenstackhq/orm','@zenstackhq/schema'];
  const declared=packages.map(name=>manifest.dependencies?.[name]??manifest.devDependencies?.[name]);
  assert.ok(declared.every(Boolean)||declared.every(version=>!version),
    'ZenStack ORM and schema must be installed together');
  for(let i=0;i<packages.length;i++){
    if(!declared[i])continue;
    const name=packages[i];
    assert.match(declared[i],/^[~^]?3\./,name+' must use ZenStack V3');
    assert.equal(root.dependencies?.[name]??root.devDependencies?.[name],declared[i],
      name+' must match the npm lockfile root');
    assert.ok(lock.packages['node_modules/'+name],name+' must have a resolved lockfile entry');
  }
  for(const section of ['dependencies','devDependencies']){
    assert.ok(!manifest[section]?.['@zenstackhq/cli'],
      'ZenStack CLI is intentionally excluded from the dependency set');
  }
});

test('Windows static export launches npm.cmd via cmd shell, never direct spawn',()=>{
  const builder=readFileSync(new URL('./build-static-export.mjs',import.meta.url),'utf8');
  assert.match(builder,/shell:process\.platform==='win32'/);
  assert.match(builder,/run\(npm,\['run','prebuild'\]\)/);
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
