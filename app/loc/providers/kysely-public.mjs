import {publicScopeBlockPage} from '../blocks/public-scope-pages.mjs';
import {portableRelation} from './sql-engine-ports.mjs';
import {LOC_BLOCK_ANCHOR_FIELDS,locAnchorToBlock,isLocBlockPage}
  from '../blocks/loc-block-anchor.mjs';

const scopePattern=/^[a-z][a-z0-9]{0,14}$/;
function id(value){
  const scope=String(value||'').trim().toLowerCase();
  if(!scopePattern.test(scope))
    throw Object.assign(new Error('Invalid Scope'),{httpStatus:400});
  return scope;
}
const BLOCK_COLUMNS=Object.freeze([
  'uid','page_name','block_eyebrow','block_title','block_subtitle',
  'block_text','block_order','block_entity','block_image'
]);
const LOC_LIST_TYPES=Object.freeze(['index','governance']);
const blockRelation=(name,engine,namespace)=>engine==='postgres'
  ?'silver.'+name:portableRelation(name,engine,namespace);

async function readLocBlockAnchors(db,types,{engine='postgres',namespace='silver'}={}){
  return db.selectFrom(blockRelation('loc_anchor',engine,namespace))
    .select(LOC_BLOCK_ANCHOR_FIELDS)
    .where('type','in',types).where('invisible','=',false)
    .orderBy('uid','asc').execute();
}

export async function block_list(db,scopeValue,options={}){
  const scope=id(scopeValue);
  const page=publicScopeBlockPage(options.pageName);
  if(!page)throw Object.assign(new Error('Invalid public Scope Block page'),{httpStatus:400});
  if(scope==='loc'){
    if(page!=='index')throw Object.assign(new Error('Invalid LOC public Block page'),{httpStatus:400});
    const rows=await readLocBlockAnchors(db,LOC_LIST_TYPES,options);
    return rows.map(locAnchorToBlock)
      .sort((a,b)=>a.page_name.localeCompare(b.page_name)||
        a.block_order-b.block_order);
  }
  return db.selectFrom(blockRelation(scope+'_blocks',options.engine||'postgres',
    options.namespace||'silver'))
    .select(BLOCK_COLUMNS).where('page_name','=',page)
    .orderBy('block_order','asc').execute();
}

export async function hero_block(db,specificValue,options={}){
  const types=Array.isArray(specificValue)?specificValue:[specificValue];
  if(!types.length||types.length>2||new Set(types).size!==types.length||
    types.some(type=>!isLocBlockPage(type)||LOC_LIST_TYPES.includes(type)))
    throw Object.assign(new Error('Invalid specific Hero type'),{httpStatus:400});
  const rows=await readLocBlockAnchors(db,types,options);
  return rows.map(locAnchorToBlock).sort((a,b)=>
    types.indexOf(a.page_name)-types.indexOf(b.page_name)||
    a.block_order-b.block_order);
}
