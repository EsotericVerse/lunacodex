'use server';
import {sql} from 'kysely';
import {headers} from 'next/headers.js';
import {verifiedLocWebsiteSession} from '../../auth/verified-session.mjs';
import {publishedLocAccess} from '../../permissions/loc-business-grants.mjs';
import {runtimeBucket,readRuntimeControl,patchRuntimeControl} from '../../runtime/r2-runtime.mjs';
import {directMcpKysely,closeLocDatabase} from '../../db/native-kysely.mjs';
import {bindLocAuthorization} from '../../providers/loc-authorization.mjs';
import {readLocHyperdriveMode,writeLocHyperdriveMode}
  from '../../db/hyperdrive-mode.mjs';
import {withAuthorizedLocRead} from '../read-context.mjs';
import {DATABASE_ACCESS_LIST} from '../../providers/access.js';
import {FIXED_MANAGE_ROWS} from '../../permissions/fixed-manage-registry.mjs';
import {ANCHOR_TYPE_GROUPS} from '../../../../packages/zenstack/anchor-hierarchy.mjs';
import {scopeConfigColumns} from '../../scope/scope-config-fields.mjs';

async function requireRuntimeAdmin(){
  const incoming=await headers();
  const cookie=incoming.get('cookie')||'';
  const request=new Request('https://loc.lo3rwang.cc/_loc-internal-read',{headers:{cookie}});
  const session=await verifiedLocWebsiteSession(request);
  const {grants}=publishedLocAccess(session.email,{website:true});
  if(!grants.includes('global:manage'))throw Object.assign(Error('LOC 管理權限不足'),{httpStatus:403});
  return {session,grants};
}

export async function readRuntimeR2State(){
  await requireRuntimeAdmin();
  const bucket=await runtimeBucket(process.env);
  if(!bucket)return {available:false,enabled:false};
  const control=await readRuntimeControl(process.env);
  return {available:true,enabled:control?.r2Enabled!==false};
}
export async function setRuntimeR2Mode(enabled){
  await requireRuntimeAdmin();
  if(typeof enabled!=='boolean')throw Error('無效的 R2 模式');
  const result=await patchRuntimeControl({r2Enabled:enabled},{env:process.env});
  return {available:true,enabled:result.r2Enabled};
}
export async function readHyperdriveMode(){
  await requireRuntimeAdmin();
  const control=await readRuntimeControl(process.env);
  if(control)return {enabled:control.hyperdriveEnabled,
    connectionMode:control.hyperdriveEnabled?'hyperdrive':'direct',source:'r2'};
  return withAuthorizedLocRead({global:true},async(db,port)=>{
    return {enabled:await readLocHyperdriveMode(db),
      connectionMode:port.connectionMode||'direct'};
  });
}

export async function setHyperdriveMode(enabled){
  if(typeof enabled!=='boolean')throw Error('Invalid Hyperdrive mode');
  await requireRuntimeAdmin();
  if(await runtimeBucket(process.env)){
    // Probe only the target connection, never the failed source database or a Galaxy table.
    const primary=DATABASE_ACCESS_LIST.find(item=>item.selected===true);
    const expected=enabled?'hyperdrive':'direct';
    let probe=null;
    try{
      probe=await directMcpKysely(process.env,primary?.target_id,{
        forceDirect:!enabled,forceHyperdrive:enabled
      });
      if(probe.connectionMode!==expected)throw Error('Connection mode mismatch');
      await sql`select 1 as connection_ready`.execute(probe.db);
    }catch{
      throw Error(enabled?'Hyperdrive 連線預檢失敗，設定未變更。':
        'LOC_DATABASE_URI 直連預檢失敗，設定未變更。');
    }finally{if(probe)try{await closeLocDatabase(probe);}catch{}}
    const control=await patchRuntimeControl({hyperdriveEnabled:enabled},{env:process.env});
    return {enabled:control.hyperdriveEnabled,connectionMode:expected,source:'r2'};
  }
  return withAuthorizedLocRead({global:true},async(db,port,{session,grants})=>{
    const primary=DATABASE_ACCESS_LIST.find(item=>item.selected===true);
    if(!primary)throw Error('LOC primary database unavailable');
    const expected=enabled?'hyperdrive':'direct';
    let probe=port,ownsProbe=false;
    try{
      if(probe.connectionMode!==expected){
        probe=await directMcpKysely(process.env,primary.target_id,{
          forceDirect:!enabled,forceHyperdrive:enabled
        });
        ownsProbe=true;
      }
      if(probe.connectionMode!==expected)throw Error('Connection mode mismatch');
      bindLocAuthorization(probe.db,{role:'authenticated',engine:probe.engine,
        claims:{provider:'loc',role:'authenticated',sub:session.userId,
          email:session.email,me:true,grants}});
      await sql`select 1 as connection_ready`.execute(probe.db);
      const row=await probe.db.selectFrom('silver.loc').select('id')
        .where('id','=','loc').executeTakeFirst();
      if(!row)throw Error('LOC settings row unavailable');
    }catch{
      throw Error(enabled
        ?'Hyperdrive 連線預檢失敗，設定未變更。'
        :'LOC_DATABASE_URI 直連預檢失敗，設定未變更。');
    }finally{
      if(ownsProbe&&probe){
        try{await closeLocDatabase(probe);}catch{}
      }
    }
    await writeLocHyperdriveMode(db,enabled);
    return {enabled,connectionMode:expected};
  });
}

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
