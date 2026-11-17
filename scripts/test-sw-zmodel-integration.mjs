import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const script=read('public/sw.js');

function worker(){
  const handlers=new Map(), responses=new Map();
  let network=0;
  const cache={
    match:async request=>responses.get(request.url),
    put:async (request,response)=>{responses.set(request.url,response);},
    keys:async()=>[...responses.keys()].map(url=>({url})),
    delete:async request=>responses.delete(request.url)
  };
  const self={
    location:{origin:'https://loc.example'},
    addEventListener:(name,handler)=>handlers.set(name,handler),
    skipWaiting:()=>Promise.resolve(),
    clients:{claim:()=>Promise.resolve()}
  };
  const ctx={self,URL,caches:{open:async()=>cache,keys:async()=>[]},
    fetch:async()=>{network++;return {
      ok:true,type:'basic',clone(){return this;}
    };}};
  runInNewContext(script+'\nself.__eligible=eligible;',ctx);
  return {self,handlers,getNetwork:()=>network};
}
const request=(path,{method='GET',mode='cors',destination='script',origin='https://loc.example'}={})=>({
  url:origin+path,method,mode,destination
});

test('SW caches only immutable same-origin Next JS/CSS/font assets',()=>{
  const {self}=worker();
  assert.equal(self.__eligible(request('/_next/static/chunks/example.js')),true);
  assert.equal(self.__eligible(request('/_next/static/css/example.css')),true);
  assert.equal(self.__eligible(request('/_next/static/media/example.woff2',{destination:'font'})),true);
  for(const path of ['/', '/index.html','/api/loc-public-query',
    '/api/loc-public-content?kind=config','/api/loc-permissions',
    '/api/loc-native','/api/las-native','/auth/callback',
    '/assets/pics/lo3rwang-hero.jpg','/_next/static/media/hero.png']){
    assert.equal(self.__eligible(request(path)),false,path);
  }
  assert.equal(self.__eligible(request('/_next/static/chunks/a.js',{method:'POST'})),false);
  assert.equal(self.__eligible(request('/_next/static/chunks/a.js',{mode:'navigate'})),false);
  assert.equal(self.__eligible(request('/_next/static/chunks/a.js',{origin:'https://other.example'})),false);
});
test('SW serves a second immutable asset request without another network fetch',async()=>{
  const {handlers,getNetwork}=worker();
  const send=async path=>{
    let response;
    handlers.get('fetch')({request:request(path),
      respondWith:promise=>{response=promise;}});
    return response?await response:null;
  };
  await send('/_next/static/chunks/versioned.js');
  await send('/_next/static/chunks/versioned.js');
  assert.equal(getNetwork(),1);
  await send('/api/loc-public-query');
  assert.equal(getNetwork(),1);
});
test('Zod remains on modeled SQL read and write boundaries, not in browser SW',()=>{
  const server=read('app/loc/server/native-public-query.mjs');
  const content=read('app/loc/server/native-public-content.mjs');
  const imports=read('packages/zenstack/import-validation.mjs');
  const writes=read('app/loc/providers/kysely-blocks.mjs');
  assert.match(server,/assertZModelSelectRows/);
  assert.match(content,/assertZModelSelectRows/);
  assert.match(imports,/createSchemaFactory/);
  assert.match(imports,/safeParse/);
  assert.match(writes,/modelWriteSchemaForSqlTable/);
  assert.doesNotMatch(script,/\/api\/|authorization|sessionStorage/);
});
test('Session and Grants stay independent of public bootstrap sharing',()=>{
  const q=read('packages/zenstack/client-queries.js');
  const bootstrap=read('app/loc/runtime/app-bootstrap.js');
  assert.match(q,/isPublicBootstrapKey=key=>/);
  assert.match(q,/shareResult===true&&isPublicBootstrapKey/);
  assert.match(q,/\['loc-account','session'\]/);
  assert.match(q,/\['loc-account','management'\]/);
  assert.match(bootstrap,/shareResult:true/);
});
