import {PUBLISHED_SITE_BOOTSTRAP} from '../../modular/published-site-bootstrap.js';
import {portableRelation} from '../providers/sql-engine-ports.mjs';

const scopeIds=Object.freeze([...new Set((PUBLISHED_SITE_BOOTSTRAP.registry||[])
  .filter(row=>row?.active!==false&&['group','scope'].includes(row?.scope_kind))
  .map(row=>String(row?.scope_id||'').trim().toLowerCase())
  .filter(id=>/^[a-z][a-z0-9]{0,14}$/.test(id)))].sort());

// Deliberately select only public page labels and copy. Never serialize the
// Loc model, authorization fields, runtime settings, or SiteLucus records.
export async function readPublicHomePageCopySql(db,{engine='postgres',
  namespace='silver'}={}){
  if(!scopeIds.length)return [];
  const table=portableRelation('loc',engine,
    namespace||(engine==='postgres'?'silver':'dbo'));
  const rows=await db.selectFrom(table)
    .select(['id','display_name','title_tw','desc_tw'])
    .where('id','in',scopeIds).execute();
  const byId=new Map(rows.map(row=>[String(row.id),row]));
  return scopeIds.map(id=>{
    const row=byId.get(id)||{};
    return {scope_id:id,
      display_name:String(row.display_name||''),
      title_tw:String(row.title_tw||''),
      desc_tw:String(row.desc_tw||'')};
  });
}
