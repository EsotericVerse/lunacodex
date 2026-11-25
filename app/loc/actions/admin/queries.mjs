'use server';
import {sql} from 'kysely';
import {withAuthorizedLocRead} from '../read-context.mjs';
import {DATABASE_ACCESS_LIST} from '../../providers/access.js';
import {FIXED_MANAGE_ROWS} from '../../permissions/fixed-manage-registry.mjs';
import {ANCHOR_TYPE_GROUPS} from '../../../../packages/zenstack/anchor-hierarchy.mjs';
import {scopeConfigColumns} from '../../scope/scope-config-fields.mjs';
import {modelCacheStatus,setModelCacheEnabled} from '../../db/model-cache.mjs';

export async function readLocSourceHierarchy(){
  return withAuthorizedLocRead({global:true},async db=>{
    const columns=['uid','type','title','description','invisible','attr',
      'createtime','num'];
    const rows=await db.selectFrom('silver.loc_anchor').select(columns)
      .where('type','in',ANCHOR_TYPE_GROUPS.source).orderBy('uid','asc').execute();
    return {data:rows,count:rows.length};
  });
}

export async function readScopeRegistryAdmin(){
  return withAuthorizedLocRead({global:true},async db=>{
    const registry=FIXED_MANAGE_ROWS.filter(row=>row.manage_role!=='reserve');
    const summaries=await db.selectFrom('silver.loc')
      .select(['id','display_name','birthday','title_tw','desc_tw'])
      .where('id','in',registry.map(row=>row.id)).execute();
    const byId=new Map(summaries.map(row=>[row.id,row]));
    const rows=registry.map(row=>({...row,
      display_name:byId.get(row.id)?.display_name||row.id,
      birthday:byId.get(row.id)?.birthday||null,
      title_tw:byId.get(row.id)?.title_tw||null,
      desc_tw:byId.get(row.id)?.desc_tw||null
    })).sort((a,b)=>a.sort_order-b.sort_order||a.id.localeCompare(b.id));
    return {data:rows,count:null};
  });
}

export async function readAdminScopeConfig(scopeId){
  const scope=String(scopeId||'').trim().toLowerCase();
  const row=FIXED_MANAGE_ROWS.find(item=>item.id===scope&&
    item.manage_role==='scope'&&item.active===true);
  if(!row)throw Error('Invalid admin Scope configuration');
  return withAuthorizedLocRead({global:true},async db=>{
    const result=await db.selectFrom('silver.'+scope)
      .select(scopeConfigColumns(scope)).where('id','=',scope).executeTakeFirst();
    return result||null;
  });
}

export async function readLocAdminSettings(section){
  if(!['theme','keywords'].includes(section))throw Error('Invalid LOC settings section');
  return withAuthorizedLocRead({global:true},async db=>{
    const row=await db.selectFrom('silver.loc').select(['theme','keywords'])
      .where('id','=','loc').executeTakeFirst();
    if(!row)throw Error('LOC Group settings unavailable');
    const data=section==='theme'?row.theme:row.keywords;
    if(!Array.isArray(data))throw Error('LOC '+section+' settings unavailable');
    return {data,count:null};
  });
}

export async function readBackupReadiness(){
  const backup=DATABASE_ACCESS_LIST.find(row=>row.backup_selected===true);
  if(!backup)return {online:false,schema:false};
  return withAuthorizedLocRead({global:true,targetId:backup.target_id},async db=>{
    await sql`select 1 as online`.execute(db);
    try{
      await db.selectFrom('silver.loc').select('id').where('id','=','loc')
        .executeTakeFirst();
      return {online:true,schema:true};
    }catch{
      return {online:true,schema:false};
    }
  });
}

export async function readLocModelCache(){
  return withAuthorizedLocRead({global:true},()=>modelCacheStatus());
}
export async function updateLocModelCache(enabled){
  if(typeof enabled!=='boolean')throw Error('Invalid R2 Model Cache setting');
  return withAuthorizedLocRead({global:true},()=>setModelCacheEnabled(enabled));
}
