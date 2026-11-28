// Scoped MCP SQL operations for PostgreSQL.
// Called by the trusted LOC MCP application after native OAuth, Scope grant
// and selected-database authorization; never by a SQL Gateway.
// Galaxy/Lucus are the same fixed physical models; the SQL dialect and
// database credentials belong to Kysely, not a provider's Data API/RPC.
import {sql} from 'kysely';
import {schema as zmodel} from '../../../packages/zenstack/schema.mjs';
import {portableRelation} from './sql-engine-ports.mjs';
import {galaxyReadColumns} from '../../../packages/zenstack/galaxy-read-models.mjs';
import {CAPTURE_FROM_SITES,CAPTURE_LOOKUP_SITES} from '../source/site-from-url.mjs';
import {scopeTableName} from '../../../packages/zenstack/scope-table-names.mjs';

const SCOPE_MODELS=Object.freeze({lo3rwang:'Lo3rwangGalaxy',lrunes:'LrunesGalaxy'});
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const UID=/^[A-Za-z0-9]{8}$/;
const BATCH=/^[0-9a-f]{64}$/;

const FLAGS=galaxyReadColumns('GalaxyReadLucus');
function reject(message,status=400){throw Object.assign(new Error(message),{httpStatus:status});}
function affected(result){
  const item=Array.isArray(result)?result[0]:result;
  return Number(item?.numUpdatedRows??item?.numAffectedRows??
    item?.numInsertedOrUpdatedRows??item?.numDeletedRows??0);
}
function verifyScope(body,claims){
  const scope=String(body?.scopeid||'');
  if(!SCOPE.test(scope))reject('Invalid delegated MCP Scope',403);
  if(!['mcp-sync','mcp-append'].includes(body.kind))
    reject('Unsupported MCP operation',400);
  const permission=scope+':write';
  if(claims?.provider!=='loc'||claims?.me!==true||
    !Array.isArray(claims.grants)||!claims.grants.includes(permission))
    reject('MCP Scope grant denied',403);
  return scope;
}
function relation(scope,engine,namespace){
  if(engine!=='postgres')reject('Unsupported MCP SQL engine');
  // Cloned Scopes inherit the fixed Galaxy contract; only the physical name varies.
  const model=zmodel.models[SCOPE_MODELS[scope]||'Lo3rwangGalaxy'];
  const required=['uid','title','content','createtime','site','site_id','UpdateTime',...FLAGS];
  if(!model||required.some(field=>!Object.hasOwn(model.fields,field)))
    reject('Fixed LOC ZModel Galaxy contract mismatch',503);
  return portableRelation(scopeTableName(scope,'galaxy'),engine,namespace||'silver');
}
function validateSync(body){
  const row=body.row;
  if(!row||typeof row!=='object'||Array.isArray(row)||
     !UID.test(String(row.uid||''))||!CAPTURE_FROM_SITES.includes(row.site)||
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
function conversationOnly(q,site=null){
  // The parent MCP Domain is never a stored source. Legacy mcp rows remain
  // readable until separately reconciled, never accepted as new writes.
  // Preserve the existing PR provenance guard on all paths.
  return q.where('site','in',site?[site]:CAPTURE_LOOKUP_SITES)
    .where(eb=>eb.or([
    eb('site_id','is',null),
    eb.and([
      eb('site_id','not like','%#%'),
      eb('site_id','not like','%/pull/%'),
      eb(sql`lower(${sql.ref('site_id')})`,'not like','%github%')
    ])
  ])).where(sql`lower(${sql.ref('title')}) not like ${'%pr #%'}`);
}
export async function executePortableMcp(trx,body,claims,{engine='postgres',namespace=''}={}){
  const scope=verifyScope(body,claims);
  const table=relation(scope,engine,namespace);
  if(body.kind==='mcp-sync'){
    const row=validateSync(body);
    if(body.update_existing){
      // The first acknowledgement may have been lost. Recheck the SAME UID
      // without overwriting text that may already have been appended.
      const previous=await conversationOnly(trx.selectFrom(table))
        .select(['uid','content']).where('uid','=',row.uid)
        .where('site_id','=',row.site_id).limit(1).executeTakeFirst();
      if(previous){
        if(previous.content===row.content)
          return {data:{count:1,duplicate:true},count:1};
        reject('MCP sync cannot overwrite a stored conversation; append the new batch',409);
      }
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
