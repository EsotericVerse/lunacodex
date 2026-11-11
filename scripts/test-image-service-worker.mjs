import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const source=read('public/sw.js');

test('retired PWA Service Worker cannot intercept documents, auth or SQL fetches',()=>{
 const listeners=new Map();
 vm.runInNewContext(source,{
   self:{addEventListener:(name,fn)=>listeners.set(name,fn)},
   caches:{keys:async()=>[],delete:async()=>true}
 });
 assert.equal(listeners.has('fetch'),false);
 assert.equal(listeners.has('message'),false);
 assert.equal(listeners.has('install'),true);
 assert.equal(listeners.has('activate'),true);
});
test('old PWA worker removes LOC caches and unregisters',async()=>{
 const listeners=new Map(),deleted=[];
 let unregisterCount=0,skipCount=0;
 vm.runInNewContext(source,{
   self:{
     addEventListener:(name,fn)=>listeners.set(name,fn),
     skipWaiting:async()=>{skipCount++},
     registration:{unregister:async()=>{unregisterCount++;return true}}
   },
   caches:{
     keys:async()=>['loc-public-images-v1','loc-public-static-v1','other-site'],
     delete:async(name)=>{deleted.push(name);return true}
   }
 });
 const run=async name=>{
   const pending=[];
   listeners.get(name)({waitUntil:promise=>pending.push(promise)});
   await Promise.all(pending);
 };
 await run('install');
 await run('activate');
 assert.equal(skipCount,1);
 assert.equal(unregisterCount,1);
 assert.deepEqual(deleted.sort(),['loc-public-images-v1','loc-public-static-v1']);
});
test('LOC website does not re-register PWA and manifest no longer enables installation',()=>{
 const shell=read('app/AppShell.jsx');
 assert.doesNotMatch(shell,/serviceWorker\.register\s*\(/);
 assert.match(shell,/serviceWorker\.getRegistrations\s*\(/);
 assert.match(shell,/reg\.unregister\s*\(/);
 assert.equal(existsSync(new URL('../app/manifest.js',import.meta.url)),false);
});
