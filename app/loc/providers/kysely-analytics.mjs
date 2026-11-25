import {canLocAccess} from './loc-authorization.mjs';
import {portableRelation} from './sql-engine-ports.mjs';
import {publishedManagedScope} from './published-managed-scope.mjs';
import {readItemKeywordProjection,itemKeywordStatistics,itemScope} from '../keywords/item-count-analysis.mjs';
import {mapBounded} from '../query/bounded-parallel.mjs';

// Fixed feature projections used by LOC-owned Server Actions.
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const UID=/^[A-Za-z0-9]{8}$/;
function reject(message,status=400){
  throw Object.assign(new Error(message),{httpStatus:status});
}
async function owns(trx,scope,role){
  return role==='authenticated'&&await canLocAccess(trx,'scope',scope);
}
export async function searchSummary(trx,options,{publishedScopeIds=null,
  engine='postgres',namespace='silver'}={}){
  const scopes=options.scopeIds;
  if(!Array.isArray(scopes)||scopes.length>100||
    scopes.some(x=>typeof x!=='string'||!SCOPE.test(x)))
    reject('Invalid Scope Search summary request');
  const requested=[...new Set(scopes)].sort();
  if(!requested.length)return {rows:[]};
  // Each Scope contributes only its published search summary. Read its own
  // fixed config relation in bounded parallel chunks; no cross-scope SQL route.
  const selected=new Set(publishedScopeIds===null?requested:publishedScopeIds);
  const scopeIds=requested.filter(scope=>{
    if(!selected.has(scope))return false;
    const published=publishedManagedScope(scope);
    return published?.manage_role==='scope'&&published.active===true;
  });
  const statusByScope=new Map();
  const rows=await mapBounded(scopeIds,async scope=>({scope,
      row:await trx.selectFrom(portableRelation(scope,engine,namespace))
        .select('status').where('id','=',scope).executeTakeFirst()
    }));
  for(const {scope,row} of rows){
    let status=row?.status;
    if(typeof status==='string'){
      try{status=JSON.parse(status)}catch{status=null}
    }
    statusByScope.set(scope,status);
  }
  const result=[];
  for(const scope of scopeIds){
    const item=statusByScope.get(scope)?.search;
    if(item&&typeof item==='object'&&!Array.isArray(item)){
      result.push({scope_id:scope,article_count:item.article_count??null,
        word_count:item.word_count??null,first_date:item.first_date??null,
        last_date:item.last_date??null,refreshed_at:item.refreshed_at??null});
    }
  }
  return {rows:result};
}
function uidList(node){
  return Array.isArray(node?.attr?.uid)?node.attr.uid.filter(id=>UID.test(id)):[];
}
function published(cfg,uid){
  return Boolean(cfg?.keyword_meta?.class_shares?.[uid]===true);
}
async function keywordClassInfo(trx,scope,anchor,requested,role,
  configTable='silver.'+scope){
  const configRow=await trx.selectFrom(configTable)
    .select(['current_keyword_class_uid','keyword_meta'])
    .where('id','=',scope).executeTakeFirst();
  let keywordMeta=configRow?.keyword_meta??{};
  if(typeof keywordMeta==='string'){
    try{keywordMeta=JSON.parse(keywordMeta)}catch{keywordMeta={}}
  }
  const config={...configRow,keyword_meta:keywordMeta};
  const uid=String(requested||config?.current_keyword_class_uid||'');
  if(!UID.test(uid))return null;
  const allowed=await owns(trx,scope,role)||published(config,uid);
  const meta=config?.keyword_meta??{};
  const done=meta.by_class?.[uid]?.completedAt;
  return {uid,allowed,ready:Boolean(done),config};
}
export async function sharedClasses(trx,scope,anchor,role,
  {configTable='silver.'+scope}={}){
  const owner=await owns(trx,scope,role);
  const cfgRow=await trx.selectFrom(configTable).select('keyword_meta')
    .where('id','=',scope).executeTakeFirst();
  let keywordMeta=cfgRow?.keyword_meta??{};
  if(typeof keywordMeta==='string'){
    try{keywordMeta=JSON.parse(keywordMeta)}catch{keywordMeta={}}
  }
  const cfg={keyword_meta:keywordMeta};
  // Kysely projects every public alias in the Class SELECT itself.
  // Previously each shared Class caused another PostgreSQL round trip.
  let query=trx.selectFrom(anchor).select(['uid','title'])
    .where('type','=','class').orderBy('title','asc');
  if(!owner){
    const sharedIds=Object.entries(cfg?.keyword_meta?.class_shares||{})
      .filter(([,flag])=>flag===true).map(([uid])=>uid);
    if(!sharedIds.length)return [];
    query=query.where('uid','in',sharedIds);
  }
  const classes=await query.execute();
  const sharedHashes=new Map();
  if(!owner){
    if(!globalThis.crypto?.subtle)throw Error('Web Crypto SHA-256 is unavailable');
    const hashes=await mapBounded(classes,async item=>{
      const bytes=await globalThis.crypto.subtle.digest('SHA-256',
        new TextEncoder().encode(scope+':'+String(item.uid)));
      return [item.uid,Array.from(new Uint8Array(bytes),value=>
        value.toString(16).padStart(2,'0')).join('')];
    });
    for(const [uid,hash] of hashes)sharedHashes.set(uid,hash);
  }
  const result=[];
  for(const item of classes){
    if(!owner&&!published(cfg,item.uid))continue;
    result.push({scopeId:scope,classUid:item.uid,name:item.title,
      category:owner?item.uid:String(sharedHashes.get(item.uid)||'')});
  }
  return result;
}
// READ PROJECTION for existing chart/tree consumers: uid_lists:[] is an
// output compatibility shape, not a stored Item/Group article index. Counts
// below are computed from Pattern postings. Do not persist the projection.
export async function keywordCatalog(trx,scope,anchor,requested,role,
  {withTotals=true,configTable='silver.'+scope}={}){
  const info=await keywordClassInfo(trx,scope,anchor,requested,role,configTable);
  if(!info?.allowed)return {};
  const root=await trx.selectFrom(anchor).select(['uid','type','title','description','attr'])
    .where('uid','=',info.uid).where('type','=','class').executeTakeFirst();
  if(!root)return {class_uid:info.uid,rows:[]};
  const attr=node=>typeof node?.attr==='string'?JSON.parse(node.attr):node?.attr||{};
  const children=(node,key)=>{
    const value=attr(node)[key]??attr(node).uid;
    return Array.isArray(value)?value.filter(uid=>UID.test(String(uid))):[];
  };
  const groupIds=children(root,'groups');
  const groups=groupIds.length?await trx.selectFrom(anchor)
    .select(['uid','type','title','description','attr'])
    .where('type','=','group').where('uid','in',groupIds).execute():[];
  const byGroup=new Map(groups.map(row=>[row.uid,row]));
  if(groupIds.some(uid=>!byGroup.has(uid)))reject('Broken Keyword Group relationship');
  const ordered=groupIds.map(uid=>byGroup.get(uid));
  const itemIds=[...new Set(ordered.flatMap(row=>children(row,'items')))];
  const items=itemIds.length?await trx.selectFrom(anchor)
    .select(['uid','type','title','description','attr'])
    .where('type','=','item').where('uid','in',itemIds).execute():[];
  const byItem=new Map(items.map(row=>[row.uid,row]));
  if(itemIds.some(uid=>!byItem.has(uid)))reject('Broken Keyword Item relationship');
  const descriptions=ordered.flatMap(group=>children(group,'items').map(uid=>{
    const item=byItem.get(uid);
    return {uid,item_name:String(item.title||''),
      group_uid:group.uid,keywords:Array.isArray(attr(item).keyword)?attr(item).keyword:[]};
  }));
  let totals=new Map(),groupTotals=new Map();
  if(withTotals){
    const stored=await trx.selectFrom(anchor)
      .select(['uid','attr']).where('uid','in',descriptions.map(i=>i.uid)
        .concat(ordered.map(g=>g.uid))).execute();
    const byUid=new Map(stored.map(row=>[row.uid,Number(attr(row).total)||0]));
    totals=new Map(descriptions.map(i=>[i.uid,byUid.get(i.uid)||0]));
    groupTotals=new Map(ordered.map(g=>[g.uid,byUid.get(g.uid)||0]));
  }
  const model=node=>({
    uid:node.uid,type:node.type,name:node.title,
    desc:node.type==='item'?'':node.description,
    lists:node.type==='class'?groupIds:node.type==='group'?children(node,'items'):
      node.type==='item'&&Array.isArray(attr(node).keyword)?attr(node).keyword:[],
    uid_lists:[],
    total:node.type==='group'?groupTotals.get(node.uid)||0:
      node.type==='item'?totals.get(node.uid)||0:0
  });
  return {class_uid:info.uid,rows:[model(root),...ordered.map(model),
    ...descriptions.map(item=>model(byItem.get(item.uid)))]};
}
export async function traceKeywordGroups(trx,scope,anchor,places,start,end,source,requested,role,
  {configTable='silver.'+scope,galaxyTable='silver.'+scope+'_galaxy'}={}){
  const info=await keywordClassInfo(trx,scope,anchor,requested,role,configTable);
  if(!info?.allowed||!info.ready)return [];
  const catalog=await keywordCatalog(trx,scope,anchor,requested,role,
    {withTotals:false,configTable});
  if(!catalog.class_uid||!Array.isArray(places)||!places.length)return [];
  const groups=(catalog.rows||[]).filter(row=>row.type==='group');
  const items=(catalog.rows||[]).filter(row=>row.type==='item')
    .flatMap(row=>groups.filter(g=>g.lists.includes(row.uid)).map(g=>({
      uid:row.uid,group_uid:g.uid,item_name:row.name,keywords:row.lists
    })));
  const res=await readItemKeywordProjection(trx,scope,{
    items,groups,places,start,end,source,owner:true,
    minChars:Math.max(0,Number(info.config?.keyword_min_chars)||0),galaxyTable
  });
  return groups.map(group=>({
    group_uid:group.uid,group_name:group.name,
    document_count:Number(res.totals.groupDocuments?.[group.uid])||0
  }));
}
export async function keywordSummary(trx,scope,anchor,start,end,source,requested,role,
  {configTable='silver.'+scope,galaxyTable='silver.'+scope+'_galaxy'}={}){
  const info=await keywordClassInfo(trx,scope,anchor,requested,role,configTable);
  if(!info?.allowed||!info.ready)return [];
  const catalog=await keywordCatalog(trx,scope,anchor,requested,role,
    {withTotals:false,configTable});
  if(!catalog.class_uid)return [];
  const groups=(catalog.rows||[]).filter(row=>row.type==='group');
  const items=(catalog.rows||[]).filter(row=>row.type==='item')
    .flatMap(row=>groups.filter(g=>g.lists.includes(row.uid)).map(g=>({
      uid:row.uid,group_uid:g.uid,item_name:row.name,keywords:row.lists
    })));
  const res=await readItemKeywordProjection(trx,scope,{
    items,groups,start,end,source,owner:true,
    minChars:Math.max(0,Number(info.config?.keyword_min_chars)||0),galaxyTable
  });
  return res.daily;
}
