import {isLocBlockPage} from './loc-block-lucus.mjs';
import {publicScopeBlockPage} from './public-scope-pages.mjs';

const PREFIX='loc/public-home/v1';
const LEGACY_LOC_BLOCKS_PREFIX=PREFIX+'/loc-anchor-blocks/';
export const PUBLIC_LOC_HOME_BLOCKS_PREFIX=PREFIX+'/loc-lucus-blocks/';
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const PAGE_COPY_FIELDS=new Set(['scope_id','display_name','title_tw','desc_tw']);
const BLOCK_FIELDS=new Set(['uid','page_name','block_eyebrow','block_title',
  'block_subtitle','block_text','block_order','block_entity','block_image']);
const MAX_OBJECT_BYTES=4*1024*1024;

export const PUBLIC_HOME_R2_PREFIX=PREFIX;
export const PUBLIC_HOME_PAGE_COPY_KEY=PREFIX+'/page-copy.json';
export const PUBLIC_LOC_HOME_BLOCKS_KEY=PUBLIC_LOC_HOME_BLOCKS_PREFIX+'home.json';

export function publicScopeBlocksKey(scopeValue,pageValue){
  const scope=String(scopeValue||'').trim().toLowerCase();
  const page=String(pageValue||'index').trim().toLowerCase();
  if(!SCOPE.test(scope)||scope==='admin')return null;
  if(scope==='loc'){
    if(page==='index'||page==='governance')return PUBLIC_LOC_HOME_BLOCKS_KEY;
    return isLocBlockPage(page)?PUBLIC_LOC_HOME_BLOCKS_PREFIX+page+'.json':null;
  }
  return publicScopeBlockPage(page)
    ?PREFIX+'/scope-blocks/'+scope+'/'+page+'.json':null;
}

export function validPublicHomePageCopy(value){
  return Array.isArray(value)&&value.length<=64&&value.every(row=>{
    if(!row||typeof row!=='object'||Array.isArray(row)||
      Object.keys(row).some(key=>!PAGE_COPY_FIELDS.has(key)))return false;
    return SCOPE.test(String(row.scope_id||''))&&
      ['display_name','title_tw','desc_tw'].every(key=>
        row[key]==null||typeof row[key]==='string');
  });
}

export function validPublicHomeBlockRows(value){
  return Array.isArray(value)&&value.length<=1024&&value.every(row=>{
    if(!row||typeof row!=='object'||Array.isArray(row)||
      Object.keys(row).some(key=>!BLOCK_FIELDS.has(key)))return false;
    return typeof row.uid==='string'&&typeof row.page_name==='string'&&
      Number.isSafeInteger(Number(row.block_order));
  });
}

// A fixed, private R2 binding is used only by server actions and Worker code.
// Local Node/VPS runs simply return null and use the canonical SQL reader.
export async function publicHomeBucket(env){
  if(env?.LOC_HERO_ASSETS)return env.LOC_HERO_ASSETS;
  try{
    const {getCloudflareContext}=await import('@opennextjs/cloudflare');
    return (await getCloudflareContext({async:true}))?.env?.LOC_HERO_ASSETS||null;
  }catch{return null;}
}

export async function readPublicHomeObject(bucket,key,validate){
  if(!bucket||typeof key!=='string')return {hit:false,value:null};
  try{
    const object=await bucket.get(key);
    if(!object)return {hit:false,value:null};
    if(Number(object.size)>MAX_OBJECT_BYTES){
      await object.body?.cancel().catch(()=>{});
      return {hit:false,value:null};
    }
    const value=JSON.parse(await object.text());
    return validate(value)?{hit:true,value}:{hit:false,value:null};
  }catch{return {hit:false,value:null};}
}

export async function writePublicHomeObject(bucket,key,value){
  if(!bucket||typeof key!=='string')return false;
  try{
    const body=JSON.stringify(value);
    if(new TextEncoder().encode(body).byteLength>MAX_OBJECT_BYTES)return false;
    await bucket.put(key,body,{
      httpMetadata:{contentType:'application/json; charset=utf-8',
        cacheControl:'no-store'}
    });
    return true;
  }catch{return false;}
}

export async function invalidatePublicHomeObjects(bucket,keys){
  if(!bucket)return true;
  try{
    for(const key of [...new Set((Array.isArray(keys)?keys:[]).filter(Boolean))])
      await bucket.delete(key);
    return true;
  }catch{return false;}
}

// R2 does not provide an atomic rename operation. This one-time migration
// streams each legacy cache object to its Lucus key, verifies size and ETag,
// and deletes the old key only after verification. Conflicting destinations
// stop the move without overwriting either object.
export async function moveLegacyLocHomeBlockObjects(bucket){
  if(!bucket?.list||!bucket?.get||!bucket?.put||!bucket?.head||!bucket?.delete)
    throw new TypeError('R2 bucket move operations are unavailable');
  const moved=[];
  let cursor;
  do{
    const page=await bucket.list({prefix:LEGACY_LOC_BLOCKS_PREFIX,limit:1000,...(cursor?{cursor}:{})});
    for(const entry of page.objects||[]){
      const oldKey=String(entry.key||'');
      if(!oldKey.startsWith(LEGACY_LOC_BLOCKS_PREFIX))continue;
      const newKey=PUBLIC_LOC_HOME_BLOCKS_PREFIX+oldKey.slice(LEGACY_LOC_BLOCKS_PREFIX.length);
      const listedSource=await bucket.head(oldKey);
      if(!listedSource||Number(listedSource.size)!==Number(entry.size)||
        String(listedSource.etag||'')!==String(entry.etag||''))
        throw new Error('R2 legacy object changed during Lucus move: '+oldKey);
      const destination=await bucket.head(newKey);
      if(destination){
        if(Number(destination.size)!==Number(entry.size)||
          String(destination.etag||'')!==String(entry.etag||''))
          throw new Error('R2 Lucus object already exists with different content: '+newKey);
        await bucket.delete(oldKey);
        moved.push({from:oldKey,to:newKey,alreadyPresent:true});
        continue;
      }
      const source=await bucket.get(oldKey);
      if(!source)continue;
      if(Number(source.size)!==Number(entry.size)||
        String(source.etag||'')!==String(entry.etag||''))
        throw new Error('R2 legacy object changed during Lucus move: '+oldKey);
      const created=await bucket.put(newKey,source.body,{
        onlyIf:{etagDoesNotMatch:'*'},
        ...(source.httpMetadata?{httpMetadata:source.httpMetadata}:{}),
        ...(source.customMetadata?{customMetadata:source.customMetadata}:{}),
        ...(source.storageClass?{storageClass:source.storageClass}:{})
      });
      const verified=created||await bucket.head(newKey);
      if(!verified||Number(verified.size)!==Number(source.size)||
        String(verified.etag||'')!==String(source.etag||''))
        throw new Error('R2 Lucus destination conflicts with source: '+newKey);
      const sourceStillMatches=await bucket.head(oldKey);
      if(!sourceStillMatches||Number(sourceStillMatches.size)!==Number(source.size)||
        String(sourceStillMatches.etag||'')!==String(source.etag||''))
        throw new Error('R2 legacy object changed before Lucus move completed: '+oldKey);
      await bucket.delete(oldKey);
      moved.push({from:oldKey,to:newKey,alreadyPresent:false});
    }
    cursor=page.truncated?page.cursor:undefined;
    if(page.truncated&&!cursor)throw new Error('R2 object list omitted its continuation cursor');
  }while(cursor);
  return moved;
}

// Mutations retire only the exact public-home projection they can affect.
// SQL remains canonical; removing an R2 object before COMMIT means a later
// reader falls back to SQL if the refreshed object cannot be written.
export function publicHomeKeysForWrite(body){
  const keys=[];
  if(body?.kind==='managed-action'){
    const args=body.args||{};
    const name=String(body.name||'');
    if(name==='save_blocks'){
      const key=publicScopeBlocksKey(args.p_scope_id,args.p_type);
      if(key)keys.push(key);
    }else if(name==='move_scope_block'){
      const key=publicScopeBlocksKey(args.p_scope_id,args.p_page_name);
      if(key)keys.push(key);
    }else if(name==='update_group_member_name'||
      ['provision_scope','manage_scope_registry','delete_scope'].includes(name)){
      keys.push(PUBLIC_HOME_PAGE_COPY_KEY);
    }
  }else if(body?.kind==='managed-transaction'){
    const changesPageCopy=(body.operations||[]).some(item=>
      item?.p_table==='silver.loc'&&['insert','update','delete','upsert']
        .includes(item?.p_operation));
    if(changesPageCopy)keys.push(PUBLIC_HOME_PAGE_COPY_KEY);
  }
  return [...new Set(keys)];
}
