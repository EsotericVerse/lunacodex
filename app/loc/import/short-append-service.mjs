// LOC 彩虹橋 short-import service. Trusted LOC Auth supplies actor and Scope.
// One HTTP batch can append into several independent source articles; no UPDATE
// of existing content, extra tables, RLS changes, or PR-specific Galaxy writes.
import {galaxyReadColumns} from '../../../zenstack/galaxy-read-models.mjs';
import {portableGalaxyImportMapping} from '../../../zenstack/portable-import-mapping.mjs';
const UID=/^[0-9A-Za-z]{8}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCOPE=/^[a-z][a-z0-9_]{0,63}$/;
const BASE62='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const FLAGS=galaxyReadColumns('GalaxyAttr');
const BATCH_BYTES=601024; // allow for the transport envelope around 600 KB of records
function failure(message,httpStatus=400){return Object.assign(new Error(message),{httpStatus});}
export function newShortImportUid(cryptoProvider=globalThis.crypto){
 if(typeof cryptoProvider?.getRandomValues!=='function')throw failure('Secure random UID unavailable',503);
 let id='';
 while(id.length<8){const bytes=new Uint8Array(16);cryptoProvider.getRandomValues(bytes);
  for(const b of bytes)if(b<248&&id.length<8)id+=BASE62[b%62];}
 return id;
}
export function normalizeSourceUrl(value){
 if(typeof value!=='string'||value.length>2048||value.length<9)
  throw failure('Invalid source URL');
 let u;try{u=new URL(value);}catch{throw failure('Invalid source URL');}
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password)
  throw failure('Source URL must be HTTP(S) without credentials');
 return u.href;
}
// Browser-captured past conversations belong to the private MCP archive.
// This is derived from the normalized, trusted source URL, never a user-provided
// site string. Every new article still starts with all eight public flags false.
export function siteForShortImportSource(sourceKey){
 const hostname=new URL(normalizeSourceUrl(sourceKey)).hostname.toLowerCase();
 return hostname==='chatgpt.com'||hostname.endsWith('.chatgpt.com')||
  hostname==='chat.openai.com'||hostname==='claude.ai'||
  hostname.endsWith('.claude.ai')?'mcp':'web';
}
export function validateShortImportBatch(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||
  Object.keys(input).some(key=>!['id','write_mode','records'].includes(key))||
  !UUID.test(String(input.id||''))||input.write_mode!=='append'||
  !Array.isArray(input.records)||input.records.length<1||input.records.length>50)
  throw failure('Invalid short-import batch');
 if(new TextEncoder().encode(JSON.stringify(input)).byteLength>BATCH_BYTES)
  throw failure('Short-import batch exceeds 600 KB',413);
 const ids=new Set(),segments=new Map(),records=[];
 for(const raw of input.records){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||
   !UUID.test(String(raw.id||''))||!UUID.test(String(raw.group_id||''))||
   raw.write_mode!=='append'||!['capture','revision_note'].includes(raw.kind))
   throw failure('Invalid append event');
  const source_key=normalizeSourceUrl(raw.source_key);
  if(normalizeSourceUrl(raw.url)!==source_key)throw failure('Source URL mismatch');
  if(typeof raw.content!=='string'||!raw.content.trim()||raw.content.length>140000||
   typeof raw.title!=='string'||raw.title.length>350||
   typeof raw.captured_at!=='string'||!Number.isFinite(Date.parse(raw.captured_at))||
   !Number.isInteger(raw.part_index)||!Number.isInteger(raw.part_count)||
   raw.part_count<1||raw.part_count>10000||raw.part_index<0||
   raw.part_index>=raw.part_count)throw failure('Invalid source capture');
  if(ids.has(raw.id))throw failure('Duplicate event in batch');
  ids.add(raw.id);
  const segment=raw.group_id+':'+raw.part_index;
  if(segments.has(segment))throw failure('Duplicate capture part in batch');
  segments.set(segment,source_key);
  if(raw.kind==='revision_note'&&(!UID.test(String(raw.target_uid||''))||
   typeof raw.revision_location!=='string'||!raw.revision_location.trim()||
   raw.revision_location.length>1000))throw failure('Revision requires target UID and location');
  records.push({id:raw.id,group_id:raw.group_id,source_key,
   title:raw.title,content:raw.content,captured_at:raw.captured_at,
   kind:raw.kind,part_index:raw.part_index,part_count:raw.part_count,
   ...(raw.kind==='revision_note'?{target_uid:raw.target_uid,
    revision_location:raw.revision_location}:{})});
 }
 return {id:input.id,records};
}
async function sha256Hex(input,cryptoProvider){
 if(!cryptoProvider?.subtle)throw failure('Secure hashing unavailable',503);
 const payload=new TextEncoder().encode(input);
 const hash=await cryptoProvider.subtle.digest('SHA-256',payload);
 return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function sourceSiteId(scopeid,subject,sourceKey,cryptoProvider=globalThis.crypto){
 if(!SCOPE.test(scopeid)||typeof subject!=='string'||subject.length<3||
  subject.length>180)throw failure('Verified LOC user and Scope required',403);
 return 'gl:'+await sha256Hex(scopeid+'\u0000'+subject+'\u0000'+normalizeSourceUrl(sourceKey),cryptoProvider);
}
function markerPrefix(e){return '[[LOC-Append-Event:'+e.id+':';}
function marker(e){return markerPrefix(e)+e.fingerprint+']]';}
function segmentText(e,uid){
 if(e.kind==='revision_note'){
  if(e.target_uid!==uid)throw failure('Revision UID does not match article UID',409);
  return marker(e)+'\n[待整併]\n目標 UID：'+uid+'\n原文位置：'+e.revision_location+
   '\n建議修訂：\n'+e.content+'\n狀態：待確認整併\n[/待整併]\n';
 }
 return marker(e)+'\n[來源：'+e.source_key+'；段落 '+(e.part_index+1)+'/'+e.part_count+
  ']\n'+e.content+'\n';
}
/** @param {unknown} batch @param {any} actor
 * @param {{store?:any, cryptoProvider?:Crypto, uidFactory?:()=>string}} [options] */
export async function processShortImport(batch,actor,{store,cryptoProvider=globalThis.crypto,
 uidFactory=()=>newShortImportUid(cryptoProvider)}={}){
 if(actor?.authorized!==true||!SCOPE.test(String(actor.scopeid||''))||
  typeof actor.subject!=='string'||actor.subject.length<3)
  throw failure('LOC short import requires verified authorization',403);
 if(!store||typeof store.transaction!=='function')
  throw failure('Short-import writer is unavailable',503);
 const parsed=validateShortImportBatch(batch),groups=new Map();
 // Bind every event ID to its immutable payload. If a retry reuses an ID with
 // different text or metadata, fail rather than incorrectly skip the change.
 const events=await Promise.all(parsed.records.map(async e=>({...e,
  fingerprint:await sha256Hex(JSON.stringify(e),cryptoProvider)})));
 for(const e of events){
  if(!groups.has(e.source_key))groups.set(e.source_key,[]);
  groups.get(e.source_key).push(e);
 }
 const sources=await Promise.all([...groups].map(async([url,events])=>({
  url,events,siteId:await sourceSiteId(actor.scopeid,actor.subject,url,cryptoProvider)
 })));
 // Lock order is deterministic across simultaneous multi-source queue batches.
 sources.sort((a,b)=>a.siteId.localeCompare(b.siteId));
 const receipt=await store.transaction(actor.scopeid,async tx=>{
  const answer=new Map();
  // Acquire all source locks in a stable order; one WHERE site_id IN (...)
  // query follows so a queue does not cause one table scan per source.
  for(const group of sources){
   if(typeof tx.lockSource!=='function')throw failure('Source lock unavailable',503);
   await tx.lockSource(group.siteId);
  }
  const existingById=new Map();
  if(typeof tx.lookupMany==='function'){
   const rows=await tx.lookupMany(sources.map(group=>group.siteId));
   if(!Array.isArray(rows))throw failure('Invalid Galaxy source lookup',503);
   for(const row of rows){
    const list=existingById.get(row.site_id)||[];
    list.push(row);existingById.set(row.site_id,list);
   }
  }
  const pendingInserts=[];
  for(const {url,events,siteId} of sources){
   const found=typeof tx.lookupMany==='function'?
    (existingById.get(siteId)||[]):await tx.lookup(siteId);
   if(!Array.isArray(found)||found.length>1)
    throw failure('Ambiguous existing source; manual reconciliation required',409);
   const prior=found[0];
   if(prior&&(!UID.test(String(prior.uid||''))||typeof prior.content!=='string'))
    throw failure('Invalid existing Galaxy article',409);
   if(!prior&&events.some(e=>e.kind==='revision_note'))
    throw failure('Cannot revise an unknown article',409);
   const uid=prior?.uid||uidFactory();
   if(!UID.test(uid))throw failure('Invalid Galaxy UID',503);
   const content=prior?.content||'';
   const fresh=[];
   for(const e of events){
    if(content.includes(markerPrefix(e))){
     if(!content.includes(marker(e)))
      throw failure('Conflicting content for an already imported event ID',409);
    }else fresh.push(e);
   }
   const next=fresh.map(e=>segmentText(e,uid)).join('\n');
   if(!prior){
    const first=events[0];
    pendingInserts.push({uid,title:first.title,content:next,site:siteForShortImportSource(url),site_id:siteId,
     url,createtime:first.captured_at,UpdateTime:new Date().toISOString(),
     ...Object.fromEntries(FLAGS.map(k=>[k,false]))});
   }else if(next){await tx.append(uid,siteId,'\n'+next);}
   answer.set(url,{source_key:url,uid,appended:fresh.length,duplicate:fresh.length===0});
  }
  if(pendingInserts.length){
   if(typeof tx.insertMany==='function')await tx.insertMany(pendingInserts);
   else for(const row of pendingInserts)await tx.insert(row);
  }
  return answer;
 });
 return {accepted:true,id:parsed.id,articles:[...groups.keys()].map(k=>receipt.get(k))};
}
// Unified portable Kysely short-import transaction backend; the existing
// processShortImport remains the only batching, UID and append algorithm.
/** @param {any} db @param {any} sql
 * @param {{engine?:string, namespace?:string}} [options] */
export function portableShortImportStore(db,sql,{engine='postgres',namespace}={}){
 if(typeof db?.transaction!=='function'||typeof sql!=='function'||!sql.ref||
   !['postgres','mysql','mssql'].includes(engine))
  throw failure('Portable Kysely short-import adapter unavailable',503);
 const schema=namespace===undefined?(engine==='postgres'?'silver':engine==='mssql'?'dbo':''):namespace;
 if(schema&&!/^[a-z][a-z0-9_]*$/i.test(schema))throw failure('Invalid SQL namespace',503);
 return {transaction:(scope,run)=>{
  if(!/^[a-z][a-z0-9]{0,14}$/.test(scope))throw failure('Invalid Galaxy Scope',403);
  // Existing ZenStack query + Zod validation remains the authority.
  // This adapter only resolves physical SQL dialect names/DateTime values.
  const mapping=portableGalaxyImportMapping({scopeId:scope,engine,namespace:schema});
  const name=mapping.table;
  const operations=(trx,lockSource)=>({
   lockSource,
   async lookupMany(ids){
    const plan=mapping.lookupPlan(ids);
    let q=trx.selectFrom(name).select(plan.columns)
     .where(mapping.site,'in',plan.sites).where(mapping.siteId,'in',plan.sourceIds)
     .limit(plan.limit);
    if(engine==='postgres')q=q.forUpdate();
    return q.execute();
   },
   async lookup(id){
    const plan=mapping.lookupPlan([id]);
    let q=trx.selectFrom(name).select(plan.columns)
     .where(mapping.site,'in',plan.sites).where(mapping.siteId,'in',plan.sourceIds)
     .limit(plan.limit);
    if(engine==='postgres')q=q.forUpdate();
    return q.execute();
   },
   async insertMany(rows){
    await trx.insertInto(name).values(mapping.mapInserts(rows)).execute();
   },
   async insert(row){
    const [verified]=mapping.mapInserts([row]);
    await trx.insertInto(name).values(verified).executeTakeFirstOrThrow();
   },
   async append(uid,id,tail){
    const update=await trx.updateTable(name)
     .set({
      [mapping.content]:sql`concat(coalesce(${sql.ref(mapping.content)},''),${tail})`,
      [mapping.updatedAt]:new Date()
     })
     .where(mapping.uid,'=',uid).where(mapping.site,'in',['web','mcp'])
     .where(mapping.siteId,'=',id).executeTakeFirstOrThrow();
    if(Number(update.numUpdatedRows??update.numAffectedRows??0)!==1)
     throw failure('Galaxy append did not affect one article',409);
   }
  });
  if(engine==='mysql'){
   // GET_LOCK is connection-scoped, so the same connection must retain it
   // until after the transaction commits, then release every source lock.
   return db.connection().execute(async conn=>{
    const held=[];
    try{
     return await conn.transaction().execute(trx=>run(operations(trx,async id=>{
      // MySQL named lock keys are limited to 64 characters. SourceSiteId is
      // "gl:" + a 64-character SHA-256, so use the collision-resistant hex.
      const lockName=String(id).startsWith('gl:')?String(id).slice(3):String(id);
      if(lockName.length>64||!lockName)
       throw failure('Invalid portable source lock key',400);
      const result=await sql`select get_lock(${lockName},10) as acquired`.execute(trx);
      if(Number(result.rows?.[0]?.acquired)!==1)
       throw failure('Galaxy source is busy; Queue stays intact',409);
      held.push(lockName);
     })));
    }finally{
     for(const id of held.reverse())
      await sql`select release_lock(${id})`.execute(conn);
    }
   });
  }
  return db.transaction().execute(trx=>{
   let tableLocked=false;
   return run(operations(trx,async id=>{
    if(engine==='postgres'){
     await sql`select pg_advisory_xact_lock(hashtextextended(${id},0))`.execute(trx);
    }else if(!tableLocked){
     // SQL Server: lock the whole table even if it is still empty, so
     // two new sources cannot race a first import without a unique index.
     await sql`select top 1 1 as locked from ${sql.ref(name)} with (tablockx,holdlock)`.execute(trx);
     tableLocked=true;
    }
   }));
  });
 }};
}

// Compatibility entry point, same implementation rather than a second store.
export function postgresShortImportStore(db,sql){
 return portableShortImportStore(db,sql,{engine:'postgres',namespace:'silver'});
}
