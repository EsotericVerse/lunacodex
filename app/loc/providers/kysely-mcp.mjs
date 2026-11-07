// One delegated MCP SQL execution boundary for PostgreSQL/MySQL/SQL Server.
// Called only by the trusted LOC Kysely Gateway after JWT verification.
// Galaxy/Anchor are the same fixed physical models; the SQL dialect and
// database credentials belong to Kysely, not a provider's Data API/RPC.
import {sql} from 'npm:kysely@0.29.8';
import {schema as zmodel} from '../../../zenstack/schema.mjs';
import {portableRelation} from './sql-engine-ports.mjs';
import {portableContainsSpec} from './portable-search.mjs';

const SCOPE_MODELS=Object.freeze({lo3rwang:'Lo3rwangGalaxy',lrunes:'LrunesGalaxy'});
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const UID=/^[A-Za-z0-9]{8}$/;
const BATCH=/^[0-9a-f]{64}$/;
const PR_SOURCE='EsotericVerse/moon-runes-pwa#%';
const FLAGS=['culture','trace','search','statics','list','extract','others','keyword'];
function reject(message,status=400){throw Object.assign(new Error(message),{httpStatus:status});}
function affected(result){
  const item=Array.isArray(result)?result[0]:result;
  return Number(item?.numUpdatedRows??item?.numAffectedRows??
    item?.numInsertedOrUpdatedRows??item?.numDeletedRows??0);
}
function verifyScope(body,claims){
  const scope=String(body?.scopeid||'');
  if(!SCOPE.test(scope))reject('Invalid delegated MCP Scope',403);
  const write=['mcp-sync','mcp-append'].includes(body.kind);
  if(!write&&!['mcp-search','mcp-read'].includes(body.kind))
    reject('Unsupported MCP operation',400);
  const permission=scope+':'+(write?'write':'read');
  if(claims?.provider!=='loc'||claims?.me!==true||
    !Array.isArray(claims.grants)||!claims.grants.includes(permission))
    reject('MCP Scope grant denied',403);
  return scope;
}
function relation(scope,engine,namespace,provider){
  if(!['postgres','mysql','mssql'].includes(engine))reject('Unsupported MCP SQL engine');
  // Cloned Scopes inherit the fixed Galaxy contract; only the physical name varies.
  const model=zmodel.models[SCOPE_MODELS[scope]||'Lo3rwangGalaxy'];
  const required=['uid','title','content','createtime','site','site_id','UpdateTime',...FLAGS];
  if(!model||required.some(field=>!Object.hasOwn(model.fields,field)))
    reject('Fixed LOC ZModel Galaxy contract mismatch',503);
  return portableRelation(scope+'_galaxy',engine,namespace||
    (provider==='supabase'?'silver':''));
}
function validateSync(body){
  const row=body.row;
  if(!row||typeof row!=='object'||Array.isArray(row)||
     !UID.test(String(row.uid||''))||row.site!=='mcp'||
     typeof row.site_id!=='string'||row.site_id.length<3||
     typeof row.content!=='string'||!row.content.trim()||
     typeof row.title!=='string'||!row.title.trim()||
     !FLAGS.every(flag=>row[flag]===false)||
     typeof body.update_existing!=='boolean')
    reject('Invalid private MCP row');
  const model=zmodel.models[SCOPE_MODELS[body.scopeid]||'Lo3rwangGalaxy'];
  if(Object.keys(row).some(key=>!Object.hasOwn(model.fields,key)))
    reject('Unsupported MCP Galaxy field');
  return row;
}
function validateUid(uid){
  if(!UID.test(String(uid||'')))reject('Invalid case-sensitive Galaxy UID');
}
function conversationOnly(q){
  // PR articles can share site=mcp after the historical import; they must
  // never surface in MCP conversation search (even via an unrelated query).
  return q.where('site','=','mcp').where('site_id','not like',PR_SOURCE);
}
export async function executePortableMcp(trx,body,claims,{engine='postgres',namespace='',provider='custom'}={}){
  const scope=verifyScope(body,claims);
  const table=relation(scope,engine,namespace,provider);
  if(body.kind==='mcp-read'){
    validateUid(body.uid);
    if(body.site!==undefined&&body.site!=='mcp')
      reject('請至github頁面找尋PR相關資料！不開放搜尋PR!',403);
    return {data:await conversationOnly(trx.selectFrom(table))
      .select(['uid','title','content','date','createtime','site','url'])
      .where('uid','=',body.uid).limit(1).execute()};
  }
  if(body.kind==='mcp-search'){
    if(body.user_requested!==true)
      reject('只有使用者明確要求時，才允許搜尋對話；禁止代理自行搜尋。',403);
    const term=String(body.query||'').trim(),limit=Number(body.limit);
    if(term.length<2||term.length>100||/[\u0000-\u001f\u007f]/.test(term)||
       !Number.isInteger(limit)||limit<1||limit>5)
      reject('Invalid MCP search');
    if(/(?:\bPR(?:[\s#:\-]*\d+)?\b|\bpull[ -]?request\b|\bgithub\b|\bcommit\b|合併請求|拉取請求)/i.test(term))
      reject('請至github頁面找尋PR相關資料！不開放搜尋PR!',403);
    const pattern=portableContainsSpec(term).pattern;
    const results=await conversationOnly(trx.selectFrom(table))
      .select(['uid','title','createtime'])
      .where(sql`lower(${sql.ref('content')}) like ${pattern} escape '!'`)
      .orderBy('createtime','desc').limit(limit).execute();
    return {data:results};
  }
  if(body.kind==='mcp-sync'){
    const row=validateSync(body);
    if(body.update_existing){
      const patch={...row};delete patch.uid;
      const update=await conversationOnly(trx.updateTable(table)).set(patch)
        .where('uid','=',row.uid).where('site_id','=',row.site_id).execute();
      const count=affected(update);
      if(count===1)return {data:{count:1},count:1};
      if(count!==0)reject('Unexpected MCP update count',409);
    }
    await trx.insertInto(table).values(row).execute();
    return {data:{count:1},count:1};
  }
  const uid=String(body.uid||''),content=String(body.content||'');
  const batch=String(body.batch_id||''),stamp=String(body.updated_at||'');
  const marker='[[GalaxyLinkBatch:'+batch+']]';
  if(!UID.test(uid)||!BATCH.test(batch)||!content.startsWith(marker+'\n')||
    !content.trim()||content.length>125000||!Number.isFinite(Date.parse(stamp)))
    reject('Invalid MCP append');
  const original=await conversationOnly(trx.selectFrom(table))
    .select(['uid','title','createtime','content'])
    .where('uid','=',uid).limit(1).executeTakeFirst();
  if(!original)reject('MCP conversation not found',404);
  if(String(original.content||'').includes(marker))
    return {data:{count:1,duplicate:true,title:original.title,createtime:original.createtime}};
  // Atomic conditional append: no read-then-overwrite lost updates, and the
  // same batch marker cannot be appended twice. CONCAT/CASE are portable.
  const updated=await conversationOnly(trx.updateTable(table))
    .set({content:sql`concat(coalesce(${sql.ref('content')},''),case when
       ${sql.ref('content')} is null or ${sql.ref('content')} = ''
       then ${''} else ${'\n'} end,${content})`,UpdateTime:stamp})
    .where('uid','=',uid)
    .where('content',original.content==null?'is':'=',original.content??null).execute();
  if(affected(updated)===1)
    return {data:{count:1,title:original.title,createtime:original.createtime}};
  const current=await conversationOnly(trx.selectFrom(table))
    .select('content').where('uid','=',uid).limit(1).executeTakeFirst();
  if(String(current?.content||'').includes(marker))
    return {data:{count:1,duplicate:true,title:original.title,createtime:original.createtime}};
  reject('MCP append conflict',409);
}
