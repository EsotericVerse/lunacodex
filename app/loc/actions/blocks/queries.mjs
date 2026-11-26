'use server';
import {withPublicLocRead} from '../read-context.mjs';
import {block_list,hero_block} from '../../providers/kysely-public.mjs';
import {portableRelation} from '../../providers/sql-engine-ports.mjs';
import {scopeConfigColumnList} from '../../scope/scope-config-fields.mjs';
import {publicScopeBlockPage} from '../../blocks/public-scope-pages.mjs';
import {FEATURE_HERO_IDS,MANAGEMENT_HERO_SLOTS} from '../../blocks/home-block-model.js';
import {readPublicHomePageCopySql} from '../../blocks/public-home-sql.mjs';
import {PUBLIC_HOME_PAGE_COPY_KEY,publicHomeBucket,
  publicScopeBlocksKey,readPublicHomeObject,validPublicHomeBlockRows,
  validPublicHomePageCopy,writePublicHomeObject}
  from '../../blocks/public-home-r2.mjs';

const heroPages=new Set([
  'search',
  ...FEATURE_HERO_IDS.flatMap(id=>['group_'+id,'scope_'+id]),
  ...MANAGEMENT_HERO_SLOTS.map(slot=>slot.page)
]);
const validHeroTypes=types=>types.length>0&&types.length<=2&&
  new Set(types).size===types.length&&types.every(type=>heroPages.has(type));
const scopeId=value=>{
  const scope=String(value||'').trim().toLowerCase();
  if(!/^[a-z][a-z0-9]{0,14}$/.test(scope)||scope==='admin')
    throw Error('Invalid Blocks Scope');
  return scope;
};

async function publicBlockList(scope,page){
  const key=publicScopeBlocksKey(scope,page);
  const bucket=await publicHomeBucket();
  if(bucket&&key){
    const allowedPages=scope==='loc'?new Set(['index','governance']):new Set([page]);
    const cached=await readPublicHomeObject(bucket,key,value=>
      validPublicHomeBlockRows(value)&&value.every(row=>allowedPages.has(row.page_name)));
    if(cached.hit)return cached.value;
  }
  const result=await withPublicLocRead({scope},async(db,port)=>
    block_list(db,scope,{engine:port.engine,namespace:port.namespace,pageName:page}));
  if(bucket&&key)await writePublicHomeObject(bucket,key,result);
  return result;
}

function sortHeroRows(rows,types){
  return rows.sort((a,b)=>types.indexOf(a.page_name)-types.indexOf(b.page_name)||
    (Number(a.block_order)||0)-(Number(b.block_order)||0));
}

async function publicHeroBlocks(types,{scope='loc'}={}){
  const bucket=await publicHomeBucket();
  const cachedByType=new Map();
  const readCache=async()=>{
    if(!bucket)return;
    for(const type of types){
      const key=publicScopeBlocksKey('loc',type);
      if(!key)continue;
      const cached=await readPublicHomeObject(bucket,key,value=>
        validPublicHomeBlockRows(value)&&value.every(row=>row.page_name===type));
      if(cached.hit)cachedByType.set(type,cached.value);
    }
  };
  const read=async(db,port,missing)=>{
    const rows=await hero_block(db,missing,{engine:port.engine,
      namespace:port.namespace});
    for(const type of missing){
      const pageRows=rows.filter(row=>row.page_name===type);
      cachedByType.set(type,pageRows);
      const key=publicScopeBlocksKey('loc',type);
      if(bucket&&key)await writePublicHomeObject(bucket,key,pageRows);
    }
    return sortHeroRows(types.flatMap(type=>cachedByType.get(type)||[]),types);
  };
  await readCache();
  const missing=types.filter(type=>!cachedByType.has(type));
  if(!missing.length)
    return sortHeroRows(types.flatMap(type=>cachedByType.get(type)||[]),types);
  return withPublicLocRead({scope},(db,port)=>read(db,port,missing));
}

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
    return {data:await publicBlockList(scope,page),count:null};
  }
  if(Object.keys(args).some(key=>key!=='p_type'))throw Error('Invalid Hero request');
  const types=Array.isArray(args.p_type)?args.p_type:[args.p_type];
  if(!validHeroTypes(types))
    throw Error('Invalid Hero type');
  return {data:await publicHeroBlocks(types,{scope:'loc'}),count:null};
}

// Editors and post-save verification must read the authoritative SQL rows.
// Public rendering continues to use queryBlocks() and its R2 projection, but
// an edit snapshot must never be assembled from a stale or empty R2 object.
export async function queryLiveBlocks(scopeValue,pageValue='index'){
  const scope=scopeId(scopeValue);
  const requested=String(pageValue??'index').trim();
  if(!/^[A-Za-z0-9_-]{1,80}$/.test(requested))
    throw Error('Invalid live Block page');
  if(scope==='loc'&&!['index','governance'].includes(requested)){
    if(!validHeroTypes([requested]))throw Error('Invalid live Hero page');
    const rows=await withPublicLocRead({scope},async(db,port)=>
      hero_block(db,[requested],{engine:port.engine,namespace:port.namespace}));
    return {data:rows,count:null};
  }
  const page=publicScopeBlockPage(requested==='governance'?'index':requested);
  if(!page||scope==='loc'&&page!=='index')
    throw Error('Invalid live Scope Block page');
  const rows=await withPublicLocRead({scope},async(db,port)=>
    block_list(db,scope,{engine:port.engine,namespace:port.namespace,
      pageName:page}));
  return {data:rows.filter(row=>row.page_name===requested),count:null};
}

// Mutable homepage copy is a private R2-backed server projection with a
// fixed, public SQL fallback. It is never embedded in deployed browser JS.
export async function readPublicHomePageCopy(){
  const bucket=await publicHomeBucket();
  if(bucket){
    const cached=await readPublicHomeObject(bucket,PUBLIC_HOME_PAGE_COPY_KEY,
      validPublicHomePageCopy);
    if(cached.hit)return {data:cached.value,count:null};
  }
  return withPublicLocRead({scope:'loc'},async(db,port)=>{
    const rows=await readPublicHomePageCopySql(db,{engine:port.engine,
      namespace:port.namespace});
    if(bucket)await writePublicHomeObject(bucket,PUBLIC_HOME_PAGE_COPY_KEY,rows);
    return {data:rows,count:null};
  });
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
    if(scope!=='loc'||!validHeroTypes(types))
      throw Error('Invalid Hero content request');
    return {data:await publicHeroBlocks(types,{scope}),count:null};
  }
  if(feature)throw Error('Unexpected Block feature');
  if(kind==='block_list')return {data:await publicBlockList(scope,'index'),count:null};
  return withPublicLocRead({scope},async(db,port)=>{
    const columns=scopeConfigColumnList(scope);
    const table=portableRelation(scope,port.engine,
      port.namespace||(port.engine==='postgres'?'silver':'dbo'));
    const row=await db.selectFrom(table).select(columns)
      .where('id','=',scope).limit(1).executeTakeFirst();
    return {data:row||null,count:null};
  });
}
