'use server';
import {withAuthorizedLocRead} from '../read-context.mjs';
import {block_list,hero_block} from '../../providers/kysely-public.mjs';
import {portableRelation} from '../../providers/sql-engine-ports.mjs';
import {scopeConfigColumns} from '../../scope/scope-config-fields.mjs';
import {publicScopeBlockPage} from '../../blocks/public-scope-pages.mjs';

const scopeId=value=>{
  const scope=String(value||'').trim().toLowerCase();
  if(!/^[a-z][a-z0-9]{0,14}$/.test(scope)||scope==='admin')
    throw Error('Invalid Blocks Scope');
  return scope;
};

export async function queryBlocks(name,args={}){
  if(!['block_list','hero_block'].includes(name)||!args||
    typeof args!=='object'||Array.isArray(args))
    throw Error('Invalid Blocks query');
  if(name==='block_list'){
    if(Object.keys(args).some(key=>!['p_scope_id','p_page_name'].includes(key)))
      throw Error('Invalid Block list request');
    const scope=scopeId(args.p_scope_id);
    const page=publicScopeBlockPage(args.p_page_name);
    if(!page||scope==='loc'&&page!=='index')throw Error('Invalid Block page');
    return withAuthorizedLocRead({scope},async(db,port)=>({
      data:await block_list(db,scope,{engine:port.engine,
        namespace:port.namespace,pageName:page}),count:null
    }));
  }
  if(Object.keys(args).some(key=>key!=='p_type'))throw Error('Invalid Hero request');
  const types=Array.isArray(args.p_type)?args.p_type:[args.p_type];
  if(!types.length||types.length>2||new Set(types).size!==types.length||
    types.some(type=>typeof type!=='string'||
      !/^[A-Za-z][A-Za-z0-9_-]{0,60}$/.test(type)))
    throw Error('Invalid Hero type');
  return withAuthorizedLocRead({scope:'loc'},async(db,port)=>({
    data:await hero_block(db,types,{engine:port.engine,namespace:port.namespace}),
    count:null
  }));
}

export async function queryBlockContent(searchParams){
  const params=new URLSearchParams(String(searchParams||''));
  const kind=String(params.get('kind')||''),scope=scopeId(params.get('scope'));
  const keys=[...params.keys()];
  if(!['config','block_list','hero_block'].includes(kind)||
    keys.some(key=>!['kind','scope','feature'].includes(key)))
    throw Error('Invalid Block content request');
  const feature=String(params.get('feature')||'');
  if(kind==='hero_block'){
    const types=feature?feature.split(','):[];
    if(scope!=='loc'||types.length<1||types.length>2||
      new Set(types).size!==types.length||types.some(type=>
        !/^[A-Za-z][A-Za-z0-9_-]{0,60}$/.test(type)))
      throw Error('Invalid Hero content request');
    return withAuthorizedLocRead({scope},async(db,port)=>({
      data:await hero_block(db,types,{engine:port.engine,namespace:port.namespace}),
      count:null
    }));
  }
  if(feature)throw Error('Unexpected Block feature');
  if(kind==='block_list')return withAuthorizedLocRead({scope},async(db,port)=>({
    data:await block_list(db,scope,{engine:port.engine,
      namespace:port.namespace,pageName:'index'}),count:null
  }));
  return withAuthorizedLocRead({scope},async(db,port)=>{
    const columns=scopeConfigColumns(scope).split(',').filter(Boolean);
    const table=portableRelation(scope,port.engine,
      port.namespace||(port.engine==='postgres'?'silver':'dbo'));
    const row=await db.selectFrom(table).select(columns)
      .where('id','=',scope).limit(1).executeTakeFirst();
    return {data:row||null,count:null};
  });
}
