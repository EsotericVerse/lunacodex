import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('retirement-only LOC worker unregisters and clears every LOC static cache',async()=>{
  const src=readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
  const listeners=new Map(),deleted=[];
  let unregistered=false,claimed=false;
  const cacheNames=[
    'loc-static-preact-v1','loc-static-next-v0','loc-public-v3',
    'loc-static-next-v1','unrelated-private-cache'
  ];
  runInNewContext(src,{
    self:{
      addEventListener:(name,fn)=>listeners.set(name,fn),
      skipWaiting:async()=>{},
      registration:{unregister:async()=>{unregistered=true;return true;}},
      clients:{claim:async()=>{claimed=true;}}
    },
    caches:{
      keys:async()=>cacheNames,
      delete:async name=>{deleted.push(name);return true;}
    }
  });
  assert.equal(typeof listeners.get('activate'),'function');
  assert.equal(typeof listeners.get('install'),'function');
  // A retired worker must never intercept requests or take over clients.
  assert.equal(listeners.has('fetch'),false);
  assert.equal(claimed,false);
  let activation;
  listeners.get('activate')({waitUntil:promise=>{activation=promise;}});
  await activation;
  assert.equal(unregistered,true);
  assert.equal(claimed,false);
  assert.deepEqual(deleted.sort(),[
    'loc-static-preact-v1','loc-static-next-v0','loc-public-v3',
    'loc-static-next-v1'
  ].sort());
  assert.equal(deleted.includes('unrelated-private-cache'),false);
});

test('LOC Web no longer registers Service Workers in either build mode',()=>{
  const shell=readFileSync(new URL('../app/AppShell.jsx',import.meta.url),'utf8');
  assert.doesNotMatch(shell,/navigator\.serviceWorker\.register\s*\(/);
  assert.doesNotMatch(shell,/process\.env\.NODE_ENV==='development'/);
  assert.match(shell,/navigator\.serviceWorker\.getRegistrations\(\)/);
  assert.match(shell,/reg\.unregister\(\)/);
  assert.match(shell,/name\.startsWith\('loc-static-next-'\)/);
  assert.match(shell,/name\.startsWith\('loc-static-preact-'\)/);
  assert.match(shell,/name\.startsWith\('loc-public-'\)/);
});
