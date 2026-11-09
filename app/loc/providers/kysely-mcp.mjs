// Scoped MCP SQL operations for PostgreSQL/MySQL/SQL Server.
// Called by the trusted LOC MCP application after native OAuth, Scope grant
// and selected-database authorization; never by a SQL Gateway.
// Galaxy/Anchor are the same fixed physical models; the SQL dialect and
// database credentials belong to Kysely, not a provider's Data API/RPC.
import {sql} from 'kysely';
import {isLocWriteOwner} from '../auth/delegation-contract.mjs';
import {schema as zmodel} from '../../../zenstack/schema.mjs';
import {portableRelation} from './sql-engine-ports.mjs';
import {portableContainsSpec} from './portable-search.mjs';

const SCOPE_MODELS=Object.freeze({lo3rwang:'Lo3rwangGalaxy',lrunes:'LrunesGalaxy'});
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const UID=/^[A-Za-z0-9]{8}$/;
const BATCH=/^[0-9a-f]{64}$/;

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
    (write&&!isLocWriteOwner(claims.email))||
    !Array.isArray(claims.grants)||!claims.grants.includes(permission))
    reject('MCP Scope grant denied',403);
  return scope;
}
function relation(scope,engine,namespace,tableName=''){ 
  if(!['postgres','mysql','mssql'].includes(engine))reject('Unsupported MCP SQL engine');
  // Cloned Scopes inherit the fixed Galaxy contract; only the physical name varies.
  const model=zmodel.models[SCOPE_MODELS[scope]||'Lo3rwangGalaxy'];
  const required=['uid','title','content','createtime','site','site_id','UpdateTime',...FLAGS];
  if(!model||required.some(field=>!Object.hasOwn(model.fields,field)))
    reject('Fixed LOC ZModel Galaxy contract mismatch',503);
  return portableRelation(tableName||scope+'_galaxy',engine,namespace||
    (engine==='postgres'?'silver':''));
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
  // A historic PR record can share site=mcp, sometimes with a different
  // GitHub repository. Exclude PR provenance *from the SQL rows themselves*.
  // NULL site_id is allowed for old genuine conversations. This filter is
  // shared by read, search, sync and append, independent of the SQL engine.
  return q.where('site','=','mcp').where(eb=>eb.or([
    eb('site_id','is',null),
    eb.and([
      eb('site_id','not like','%#%'),
      eb('site_id','not like','%/pull/%'),
      eb(sql`lower(${sql.ref('site_id')})`,'not like','%github%')
    ])
  ])).where(sql`lower(${sql.ref('title')}) not like ${'%pr #%'}`);
}
export async function executePortableMcp(trx,body,claims,{
 engine='postgres',namespace='',tableName='',fieldMap={}
}={}){
  const scope=verifyScope(body,claims);
  const table=relation(scope,engine,namespace,tableName);
  const external=Boolean(tableName);
  // An external existing article table is a read-only projection, never a
  // destination for MCP sync or append. Explicit management rights are needed.
  if(external&&(!claims.grants.includes(scope+':manage')||
    !['mcp-read','mcp-search'].includes(body.kind)))
    reject('Mapped external SQL data requires Scope manager read permission',403);
  const safe=/^[A-Za-z][A-Za-z0-9_]{0,119}$/;
  if(!fieldMap||typeof fieldMap!=='object'||Array.isArray(fieldMap)||
    Object.entries(fieldMap).some(([k,v])=>!safe.test(k)||!safe.test(v)))
    reject('Invalid trusted SQL field mapping',503);
  const physical=name=>fieldMap[name]||name;
  const columns=names=>names.map(name=>name===physical(name)?
    name:sql.ref(physical(name)).as(name));
  if(body.kind==='mcp-read'){
    if(external){
      if(typeof body.uid!=='string'||body.uid.length<1||body.uid.length>128||
        /[\u0000-\u001f\u007f]/.test(body.uid))reject('Invalid mapped article ID');
    }else validateUid(body.uid);
    if(body.site!==undefined&&body.site!=='mcp')
      reject('請至github頁面找尋PR相關資料！不開放搜尋PR!',403);
    const source=external?trx.selectFrom(table):
      conversationOnly(trx.selectFrom(table));
    const fields=external?
      ['uid','title','content','date','createtime','url']:
      ['uid','title','content','date','createtime','site','url'];
    return {data:await source.select(columns(fields))
      .where(physical('uid'),'=',body.uid).limit(1).execute()};
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
    const source=external?trx.selectFrom(table):
      conversationOnly(trx.selectFrom(table));
    const results=await source
      .select(columns(['uid','title','createtime']))
      .where(sql`lower(${sql.ref(physical('content'))}) like ${pattern} escape '!'`)
      .orderBy(physical('createtime'),'desc').limit(limit).execute();
    return {data:results};
  }
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
