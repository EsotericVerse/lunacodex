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
    .orderBy('createtime','desc').limit(limit).execute();
}
