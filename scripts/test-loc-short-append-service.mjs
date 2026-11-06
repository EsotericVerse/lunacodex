import test from 'node:test';
import assert from 'node:assert/strict';
import {processShortImport,validateShortImportBatch,normalizeSourceUrl,newShortImportUid,
 sourceSiteId,siteForShortImportSource} from '../app/loc/import/short-append-service.mjs';
const actor={authorized:true,subject:'loc-user-verified-01',scopeid:'lo3rwang'};
const uuid=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const A='https://example.org/a',B='https://example.org/b';
const fakeCrypto={
 getRandomValues(bytes){bytes.fill(9);return bytes},
 subtle:{async digest(_alg,input){const out=new Uint8Array(32);new Uint8Array(input).forEach((v,i)=>out[i%32]=(out[i%32]*31+v)&255);return out.buffer;}}
};
const event=(n,url=A,more={})=>({id:uuid(n),group_id:uuid(100+n),
 url,source_key:url,title:'來源'+n,content:'原始文字'+n,
 captured_at:'2026-11-07T01:00:00Z',kind:'capture',write_mode:'append',
 part_index:0,part_count:1,...more});
const batch=(events,n=200)=>({id:uuid(n),write_mode:'append',records:events});
function store(){
 const rows=new Map(),actions=[];
 return {rows,actions,transaction:async(_scope,fn)=>{
  const old=new Map([...rows].map(([k,v])=>[k,{...v}]));
  try{return await fn({
   async lockSource(k){actions.push('lock:'+k);},
   async lookup(k){const r=rows.get(k);return r?[{uid:r.uid,content:r.content}]:[];},
   async lookupMany(ids){
    actions.push('lookupMany');
    return ids.flatMap(id=>rows.has(id)?
     [{site_id:id,uid:rows.get(id).uid,content:rows.get(id).content}]:[]);
   },
   async insertMany(input){actions.push('insertMany');
    for(const row of input)rows.set(row.site_id,{...row});
   },
   async insert(row){rows.set(row.site_id,{...row});actions.push('insert');},
   async append(uid,k,tail){const r=rows.get(k);if(r?.uid!==uid)throw Error('bad UID');r.content+=tail;actions.push('append');}
  });}catch(e){rows.clear();for(const [k,v] of old)rows.set(k,v);throw e;}
 }};
}
function ctx(db){let n=0;return {store:db,cryptoProvider:fakeCrypto,
 uidFactory:()=>['Ab12Cd34','Ef56Gh78','Gh78Jk90'][n++]};}
test('source identity isolates actor and preserves SPA fragments',async()=>{
 assert.equal(normalizeSourceUrl(A+'#/post'),A+'#/post');
 assert.notEqual(await sourceSiteId('lo3rwang','user-one',A,fakeCrypto),
  await sourceSiteId('lo3rwang','user-two',A,fakeCrypto));
 assert.equal(newShortImportUid(fakeCrypto).length,8);
});
test('one batch creates two independent private source articles',async()=>{
 const db=store(),res=await processShortImport(batch([event(1),event(2,B)]),actor,ctx(db));
 assert.equal(res.articles.length,2);
 assert.notEqual(res.articles[0].uid,res.articles[1].uid);
 assert.equal(db.rows.size,2);
 assert.equal(db.actions.filter(x=>x==='lookupMany').length,1);
 assert.equal(db.actions.filter(x=>x==='insertMany').length,1);
 for(const row of db.rows.values()){
  assert.equal(row.site,'web');
  for(const flag of ['culture','trace','statics','list','keyword','search','extract','others'])
   assert.equal(row[flag],false);
 }
});
test('same event replayed in a new batch does not append again',async()=>{
 const db=store(),a=await processShortImport(batch([event(1)]),actor,ctx(db));
 const before=[...db.rows.values()][0].content;
 const b=await processShortImport(batch([event(1)],201),actor,ctx(db));
 assert.equal(b.articles[0].uid,a.articles[0].uid);
 assert.equal(b.articles[0].duplicate,true);
 assert.equal([...db.rows.values()][0].content,before);
 await assert.rejects(processShortImport(batch([event(1,A,{content:'altered text'})],202),
  actor,ctx(db)),/Conflicting content/);
});
test('subsequent capture only appends, preserves UID and original title',async()=>{
 const db=store(),a=await processShortImport(batch([event(1)]),actor,ctx(db));
 const row=[...db.rows.values()][0],before=row.content,title=row.title;
 const b=await processShortImport(batch([event(2)]),actor,ctx(db));
 assert.equal(b.articles[0].uid,a.articles[0].uid);
 assert.equal(row.title,title);
 assert.ok(row.content.startsWith(before));
 assert.ok(row.content.includes('原始文字2'));
 assert.equal(db.actions.filter(x=>x==='append').length,1);
});
test('revision note is append-only and must match article UID',async()=>{
 const db=store(),options=ctx(db);await processShortImport(batch([event(1)]),actor,options);
 const row=[...db.rows.values()][0],before=row.content;
 const note=event(3,A,{kind:'revision_note',target_uid:row.uid,revision_location:'第一段末尾',
  content:'建議將第一句改成另一種表達'});
 await processShortImport(batch([note]),actor,options);
 assert.ok(row.content.startsWith(before));
 assert.ok(row.content.includes('目標 UID：'+row.uid));
 assert.ok(row.content.includes('[待整併]'));
 await assert.rejects(processShortImport(batch([event(4,A,{
  kind:'revision_note',target_uid:'XY12za89',revision_location:'第一段'})]),actor,options),/UID/);
});
test('invalid second source rolls back all inserts in batch',async()=>{
 const db=store();
 await assert.rejects(processShortImport(batch([event(1),event(2,B,{
  kind:'revision_note',target_uid:'Ab12Cd34',revision_location:'尾端'})]),actor,ctx(db)),/unknown article/);
 assert.equal(db.rows.size,0);
});
test('unauthorized and update requests never reach database',async()=>{
 const db=store();
 await assert.rejects(processShortImport(batch([event(1)]),
  {...actor,authorized:false},ctx(db)),/authorization/);
 assert.throws(()=>validateShortImportBatch({...batch([event(1)]),write_mode:'update'}),/Invalid/);
 assert.throws(()=>validateShortImportBatch(batch([event(1),event(1)])),/Duplicate/);
 assert.throws(()=>validateShortImportBatch(batch([event(1,A,{url:B})])),/mismatch/);
});
test('UID generator uses unbiased rejection for bytes >=248',()=>{
 const crypto={calls:0,getRandomValues(arr){arr.fill(this.calls++===0?255:5);return arr;}};
 assert.equal(newShortImportUid(crypto),'55555555');
 assert.equal(crypto.calls,2);
});

test('historical AI conversations enter private MCP archive, general webpages stay web',async()=>{
 assert.equal(siteForShortImportSource('https://chatgpt.com/c/abc'),'mcp');
 assert.equal(siteForShortImportSource('https://chat.openai.com/c/abc'),'mcp');
 assert.equal(siteForShortImportSource('https://claude.ai/chat/abc'),'mcp');
 assert.equal(siteForShortImportSource('https://www.threads.net/@demo/post/1'),'web');
 assert.equal(siteForShortImportSource('https://example.org/a'),'web');
 const db=store(),url='https://chatgpt.com/c/abc';
 const response=await processShortImport(batch([event(44,url)]),actor,ctx(db));
 assert.equal(response.accepted,true);
 assert.equal(db.rows.size,1);
 const row=[...db.rows.values()][0];
 assert.equal(row.site,'mcp');
 for(const flag of ['statics','culture','search','trace','list','keyword','extract','others'])
  assert.equal(row[flag],false,'default historical conversation must remain private: '+flag);
 // Subsequent captures append to the same private UID with no new article.
 const next=await processShortImport(batch([event(45,url)],211),actor,ctx(db));
 assert.equal(next.articles[0].uid,response.articles[0].uid);
 assert.equal(db.rows.size,1);
});
