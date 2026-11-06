import {sql} from 'npm:kysely@0.29.8';
import {portableRelation} from './sql-engine-ports.mjs';

// Fixed, delegated MCP search: no dynamic SQL, provider-specific operators,
// title scan, user-selected tables, or stored procedures.
export async function readMcpGalaxyWithKysely(trx,request,{engine='postgres',namespace='silver'}={}){
  const scope=String(request.scopeid||'');
  if(!['lo3rwang','lrunes'].includes(scope))
    throw Object.assign(new Error('Invalid MCP Scope'),{httpStatus:400});
  const table=portableRelation(scope+'_galaxy',engine,namespace);
  if(request.kind==='mcp-read'){
    let query=trx.selectFrom(table)
      .select(['uid','title','content','date','createtime','site','url'])
      .where('uid','=',request.uid);
    if(request.site!==undefined)query=query.where('site','=',request.site);
    return query.limit(1).execute();
  }
  if(request.kind!=='mcp-search')throw Object.assign(
    new Error('Unsupported MCP read'),{httpStatus:400});
  const term=String(request.query||'').trim().toLowerCase();
  // ESCAPE '!' is supported across PostgreSQL, MySQL and SQL Server.
  const pattern='%'+term.replace(/[!%_]/g,'!$&')+'%';
  const limit=Math.max(1,Math.min(20,Math.floor(Number(request.limit)||20)));
  return trx.selectFrom(table).select(['uid','title','createtime'])
    .where('site','=','mcp')
    .where(sql`lower(${sql.ref('content')}) like ${pattern} escape '!'`)
    .orderBy(sql`case when ${sql.ref('createtime')} is null then 1 else 0 end`,'asc')
    .orderBy('createtime','desc').limit(limit).execute();
}

/**
 * Atomic, idempotent MCP append for a LOC-owned article. Uses Kysely's
 * dialect-specific SQL compilation instead of a PostgreSQL function/RPC.
 * The caller has already verified its signed scope-specific LOC delegation.
 */
export async function appendMcpGalaxyWithKysely(trx,request,{engine='postgres',namespace='silver'}={}){
  const scope=String(request.scopeid||'');
  if(!['lo3rwang','lrunes'].includes(scope))
    throw Object.assign(new Error('Invalid MCP Scope'),{httpStatus:400});
  const table=portableRelation(scope+'_galaxy',engine,namespace);
  const marker='[[GalaxyLinkBatch:'+request.batch_id+']]';
  const absent=engine==='postgres'
    ?sql`position(${marker} in coalesce(content,''))=0`
    :engine==='mysql'
      ?sql`locate(${marker},coalesce(content,''))=0`
      :sql`charindex(${marker},coalesce(content,''))=0`;
  const present=engine==='postgres'
    ?sql`position(${marker} in coalesce(content,''))>0`
    :engine==='mysql'
      ?sql`locate(${marker},coalesce(content,''))>0`
      :sql`charindex(${marker},coalesce(content,''))>0`;
  const newline=engine==='postgres'?sql`chr(10)`:
    engine==='mysql'?sql`char(10)`:sql`nchar(10)`;
  const appended=sql`case when content is null or content='' then ${request.content}
    else concat(content,${newline},${request.content}) end`;
  const result=await trx.updateTable(table)
    .set({content:appended,UpdateTime:new Date(request.updated_at)})
    .where('uid','=',request.uid).where('site','=','mcp')
    .where(absent).executeTakeFirst();
  const affected=Number(result?.numUpdatedRows??result?.numAffectedRows??0);
  if(affected>1)throw new Error('Unexpected MCP append cardinality');
  let read=trx.selectFrom(table).select(['uid','title','createtime'])
    .where('uid','=',request.uid).where('site','=','mcp');
  if(affected===0)read=read.where(present);
  const row=await read.limit(1).executeTakeFirst();
  if(!row)throw Object.assign(new Error('MCP topic unavailable'),{httpStatus:404});
  return {data:{count:1,...(affected===0?{duplicate:true}:{}),
    title:row.title,createtime:row.createtime}};
}
