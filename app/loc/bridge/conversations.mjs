// Galaxy conversation persistence belongs to the LOC business database.
// This module never issues/verifies OAuth tokens or stores Auth sessions.
// The caller has already resolved Better Auth identity and published JS grants.
import {galaxyReadColumns} from '../../../packages/zenstack/galaxy-read-models.mjs';
import {mergeOrdered} from './ordered-conversation.mjs';
import {siteForCapturedUrl} from '../source/site-from-url.mjs';
import {scopeTableName} from '../../../packages/zenstack/scope-table-names.mjs';

const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const UID=/^[A-Za-z0-9]{8}$/;
const FLAGS=galaxyReadColumns('GalaxyAttr');
const ALPHABET='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const MAX_CONTENT=2_000_000;
function fail(message,httpStatus=400){
  return Object.assign(new Error(message),{httpStatus});
}
function target(scope){
  if(!SCOPE.test(String(scope||'')))throw fail('Invalid conversation Scope');
  return 'silver.'+scopeTableName(scope,'galaxy');
}
function uid(){
  const bytes=crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes,n=>ALPHABET[n%ALPHABET.length]).join('');
}
function validConversation(id){
  const value=String(id||'');
  if(value.length<3||value.length>256||/[\u0000-\u001f\u007f]/.test(value)||
    /(?:\/pull\/|github\.com\/|#\d+$)/i.test(value))
    throw fail('Invalid non-GitHub conversation id');
  return value;
}
function normalizedTimestamp(value){
  if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))
    throw fail('Valid conversation updated_at is required');
  return new Date(value).toISOString();
}
function validatedBatch(body){
  const rows=body.records;
  if(!Array.isArray(rows)||!rows.length||rows.length>100)
    throw fail('Conversation batch requires 1–100 records');
  for(const row of rows){
    if(!row||typeof row!=='object'||Array.isArray(row)||
      !['user','assistant'].includes(row.role)||
      (row.role==='user'&&row.kind!=='original')||
      (row.role==='assistant'&&row.kind!=='advice')||
      typeof row.text!=='string'||!row.text.trim()||
      typeof row.message_id!=='string'||!row.message_id||
      row.message_id.length>256||
      typeof row.sent_at!=='string'||!Number.isFinite(Date.parse(row.sent_at)))
      throw fail('Only timestamped user originals and assistant advice can be recorded');
  }
  return rows;
}
async function batchContent(conversationId,rows){
  const text=new TextEncoder().encode(JSON.stringify([conversationId,...rows]));
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',text));
  const batchId=Array.from(digest,x=>x.toString(16).padStart(2,'0')).join('');
  const marker='[[GalaxyLinkBatch:'+batchId+']]';
  const body=marker+'\n'+rows.map(row=>
    '['+new Date(row.sent_at).toISOString()+'] '+
    (row.role==='user'?'user':'assistant:advice')+' #'+row.message_id+
    '\n'+row.text).join('\n\n');
  if(body.length>125000)throw fail('Conversation batch content too large',413);
  return {batchId,marker,content:body};
}
async function existingConversation(db,table,id,site){
  // Old site=mcp rows must continue by the same exact source conversation ID.
  // Do not silently combine two pre-existing records from different origins.
  const rows=await db.selectFrom(table)
    .select([...galaxyReadColumns('GalaxyUidRead'),'UpdateTime'])
    .where('site','in',[site,'mcp']).where('site_id','=',id)
    .orderBy('createtime','asc').limit(2).execute();
  if(rows.length>1)throw fail('Ambiguous legacy conversation source',409);
  return rows[0]||null;
}
function ensurePermission(body,claims){
  const scope=String(body.scopeid||'');
  const action=String(body.action||'');
  if(!['record','record_ordered'].includes(action))throw fail('Unsupported conversation action');
  if(claims?.provider!=='loc'||claims?.me!==true||
     !Array.isArray(claims.grants)||
     !(claims.grants.includes('global:manage')||claims.grants.includes(scope+':write')))
    throw fail('Verified LOC business permission required',403);
  return scope;
}
export async function executeLocConversation(db,body,claims){
  if(!body||typeof body!=='object'||Array.isArray(body))
    throw fail('Invalid conversation request');
  const scope=ensurePermission(body,claims);
  const table=target(scope);
  const conversationId=validConversation(body.conversation_id);
  const site=siteForCapturedUrl(conversationId);
  const timestamp=normalizedTimestamp(body.updated_at);
  if(body.action==='record_ordered'){
    // Source order is authoritative. DB write-time and capture-time are never
    // sortable message fields. Legacy text requires a separate recovery flow.
    const created=body.created_at&&Number.isFinite(Date.parse(body.created_at))
      ?new Date(body.created_at):new Date(timestamp);
    const updated=new Date(timestamp);
    const title=String(body.title||'LOC conversation').trim().slice(0,350);
    const date=created.toISOString().slice(0,10);
    for(let attempt=0;attempt<4;attempt++){
      const existing=await existingConversation(db,table,conversationId,site);
      const merged=mergeOrdered(existing?.content??null,body.records);
      if(merged.content.length>MAX_CONTENT)
        throw fail('Conversation exceeds bounded storage size',413);
      if(existing){
        if(merged.added===0&&existing.site===site)
          return {accepted:true,duplicate:true,
            uid:String(existing.uid).trim(),scopeid:scope,count:0,
            messages:merged.count};
        // A duplicate retry can fix its historic From classification
        // without rewriting the content or manufacturing a second UID.
        const update={
          ...(merged.added?{content:merged.content,UpdateTime:updated}:{}),
          ...(existing.site!==site?{site}:{})
        };
        const builder=db.updateTable(table).set(update)
          .where('uid','=',existing.uid)
          .where('site','=',existing.site).where('site_id','=',conversationId);
        const result=await (existing.content==null?builder.where('content','is',null):
          builder.where('content','=',existing.content)).executeTakeFirst();
        if(Number(result?.numUpdatedRows||0)===1)return {
          accepted:true,duplicate:merged.added===0,uid:String(existing.uid).trim(),
          scopeid:scope,count:merged.added,messages:merged.count};
        continue;
      }
      const newUid=uid();
      if(!UID.test(newUid))throw fail('Invalid generated Galaxy uid',500);
      const row={uid:newUid,title,content:merged.content,
        createtime:created,UpdateTime:updated,date,site,site_id:conversationId,
        ...Object.fromEntries(FLAGS.map(flag=>[flag,false]))};
      try{
        await db.insertInto(table).values(row).executeTakeFirst();
        return {accepted:true,duplicate:false,uid:newUid,scopeid:scope,
          count:merged.added,messages:merged.count};
      }catch(error){
        if(error?.code==='23505')continue;
        throw error;
      }
    }
    throw fail('Concurrent ordered conversation write conflict',409);
  }
  const rows=validatedBatch(body),{batchId,marker,content}=await batchContent(conversationId,rows);
  const created=body.created_at&&Number.isFinite(Date.parse(body.created_at))
    ?new Date(body.created_at):new Date(rows[0].sent_at);
  const updated=new Date(timestamp);
  const title=String(body.title||'LOC conversation').trim().slice(0,350);
  const date=created.toISOString().slice(0,10);
  for(let attempt=0;attempt<4;attempt++){
    const existing=await existingConversation(db,table,conversationId,site);
    if(existing){
      const before=String(existing.content||'');
      if(before.includes(marker))return {accepted:true,duplicate:true,
        uid:String(existing.uid).trim(),batch_id:batchId,scopeid:scope,count:1};
      const next=before+(before?'\n':'')+content;
      if(next.length>MAX_CONTENT)throw fail('Conversation exceeds bounded storage size',413);
      const builder=db.updateTable(table).set({
        content:next,UpdateTime:updated,
        ...(existing.site!==site?{site}:{})
      }).where('uid','=',existing.uid)
        .where('site','=',existing.site).where('site_id','=',conversationId);
      const result=await (existing.content==null?builder.where('content','is',null):
        builder.where('content','=',existing.content)).executeTakeFirst();
      if(Number(result?.numUpdatedRows||0)===1)return {
        accepted:true,duplicate:false,uid:String(existing.uid).trim(),
        batch_id:batchId,scopeid:scope,count:1};
      continue;
    }
    const newUid=uid();
    if(!UID.test(newUid))throw fail('Invalid generated Galaxy uid',500);
    const row={uid:newUid,title,content,
      createtime:created,UpdateTime:updated,date,site,
      site_id:conversationId,...Object.fromEntries(FLAGS.map(f=>[f,false]))};
    try{
      await db.insertInto(table).values(row).executeTakeFirst();
      return {accepted:true,duplicate:false,uid:newUid,
        batch_id:batchId,scopeid:scope,count:1};
    }catch(error){
      if(error?.code==='23505')continue;
      throw error;
    }
  }
  throw fail('Concurrent conversation write conflict',409);
}
