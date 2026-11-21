import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('Next service worker retires yesterday\'s Preact and older LOC caches without erasing current assets',async()=>{
  const src=readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
  const listeners=new Map(),deleted=[];
  let claimed=false;
  const cacheNames=[
    'loc-static-preact-v1','loc-static-next-v0','loc-public-v3',
    'loc-static-next-v1','unrelated-private-cache'
  ];
  runInNewContext(src,{
    URL,
    self:{
      location:{origin:'https://loc.lo3rwang.cc'},
      addEventListener:(name,fn)=>listeners.set(name,fn),
      skipWaiting:async()=>{},
      clients:{claim:async()=>{claimed=true;}}
    },
    caches:{
      keys:async()=>cacheNames,
      delete:async name=>{deleted.push(name);return true;}
    }
  });
  assert.equal(typeof listeners.get('activate'),'function');
  let activation;
  listeners.get('activate')({waitUntil:promise=>{activation=promise;}});
  await activation;
  assert.equal(claimed,true);
  assert.deepEqual(deleted.sort(),[
    'loc-static-preact-v1','loc-static-next-v0','loc-public-v3'
  ].sort());
  assert.equal(deleted.includes('loc-static-next-v1'),false);
  assert.equal(deleted.includes('unrelated-private-cache'),false);
});
