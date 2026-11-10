// Exact UID-selected Anchor navigation only; never autocomplete identifiers.
// All SQL is fixed-purpose, Kysely-built and bounded. No user-supplied SQL,
// imported schema copying, Article body scans or duplicate search tables.
import {SCOPE_PATTERN_POSTING_KEY} from './keyword-anchor-index.mjs';
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const UID=/^[A-Za-z0-9]{8}$/;
const TYPES=['date','point','item','pattern'];
const anchorTable=s=>{
  if(!SCOPE.test(String(s||'')))throw Error('Invalid Scope');
  return 'silver.'+s+'_anchor';
};
const attrs=row=>{
  const raw=typeof row?.attr==='string'?JSON.parse(row.attr):row?.attr;
  return raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
};
const kids=row=>Array.isArray(attrs(row).uid)?attrs(row).uid.filter(uid=>UID.test(String(uid))):[];
const sourceTable=s=>'silver.'+s+'_galaxy';
function err(message,status=400){throw Object.assign(new Error(message),{httpStatus:status});}

// Exact navigation retains keyword publication checks.
export async function accessibleKeywordAnchors(db,scope,owner=false){
  const rows=await db.selectFrom(anchorTable(scope))
    .select(['uid','type','attr']).where('type','in',['class','group','item']).execute();
  const byUid=new Map(rows.map(row=>[row.uid,row]));
  const visible=new Set();
  const settings=await db.selectFrom('silver.'+scope).select(['keyword_meta','search'])
    .where('id','=',scope).executeTakeFirst();
  const meta=typeof settings?.keyword_meta==='string'
    ?JSON.parse(settings.keyword_meta):settings?.keyword_meta||{};
  if(owner){
    for(const row of rows)if(row.type==='item')visible.add(row.uid);
  }else{
    const shared=Object.entries(meta.class_shares||{})
      .filter(([,enabled])=>enabled===true).map(([id])=>id);
    for(const id of shared){
      const klass=byUid.get(id);if(klass?.type!=='class')continue;
      for(const groupId of kids(klass)){
        const group=byUid.get(groupId);if(group?.type!=='group')continue;
        for(const itemId of kids(group))
          if(byUid.get(itemId)?.type==='item')visible.add(itemId);
      }
    }
  }
  const patterns=new Set();
  for(const itemId of visible)
    for(const uid of kids(byUid.get(itemId)))patterns.add(uid);
  const indexed=meta.pattern_index_version==='scope_anchor_v1'
    ?new Set(Object.keys(meta.pattern_scans||{})):new Set();
  return {items:visible,patterns,indexed,published:settings?.search===true};
}

export async function queryAnchorArticles(db,{scopeId,uid,type,owner=false,
  offset=0,limit=20,sortDirection='desc',startDate='',endDate='',contentType='',sourceFilter=''
}={}){
  if(!SCOPE.test(String(scopeId||''))||!UID.test(String(uid||''))||
    !TYPES.includes(type)||!Number.isSafeInteger(offset)||offset<0||offset>200000||
    !Number.isSafeInteger(limit)||limit<1||limit>100||
    !['asc','desc'].includes(sortDirection)||
    (startDate&&!/^\d{4}-\d{2}-\d{2}$/.test(startDate))||
    (endDate&&!/^\d{4}-\d{2}-\d{2}$/.test(endDate))||
    !['','galaxy','lyrics_work','text_work'].includes(contentType)||
    String(sourceFilter).length>150)err('Invalid Anchor navigation request');
  const scope=scopeId,anchor=await db.selectFrom(anchorTable(scope))
    .select(['uid','type','title','attr','invisible'])
    .where('uid','=',uid).where('type','=',type).executeTakeFirst();
  if(!anchor||(!owner&&anchor.invisible))err('Anchor is unavailable',404);
  if(['item','pattern'].includes(type)){
    const visible=await accessibleKeywordAnchors(db,scope,owner);
    const allowed=type==='item'?visible.items:visible.patterns;
    if(!allowed.has(uid))err('Keyword Class is not published',403);
  }
  if(!owner){
    // The article's own search flag is not a substitute for its Scope's
    // publication setting. Never expose a disabled Scope via guessed UID.
    const settings=await db.selectFrom('silver.'+scope).select('search')
      .where('id','=',scope).executeTakeFirst();
    if(settings?.search!==true)err('This Scope does not publish Search',403);
  }
  const current=attrs(anchor),galaxy=sourceTable(scope);
  let ids=[];
  if(type==='pattern'||type==='item'){
    const patternIds=type==='pattern'?[uid]:kids(anchor);
    if(patternIds.length){
      const patterns=await db.selectFrom(anchorTable(scope))
        .select(['uid','attr']).where('type','=','pattern')
        .where('uid','in',patternIds).execute();
      for(const row of patterns){
        const list=attrs(row)[SCOPE_PATTERN_POSTING_KEY]||[];
        if(!Array.isArray(list)||list.some(id=>!UID.test(id)))
          err('Invalid Scope Pattern postings',503);
        ids.push(...list);
      }
    }
    ids=[...new Set(ids)];
  }
  if((['pattern','item'].includes(type)&&!ids.length)||
     (type==='date'&&!/^\d{4}-\d{2}-\d{2}$/.test(String(current.date||''))))
    return {rows:[],hasMore:false,nextOffset:null};
  if(type==='pattern'||type==='item'){
    if(ids.length>60000)err('Pattern posting list exceeds safe SQL parameter limit',413);
  }
  const cols=['uid','title','date','createtime','site','url','location','place_id',
    'search','statics','culture','trace','list','keyword','extract','others'];
  let q=db.selectFrom(galaxy).select(cols);
  if(!owner)q=q.where('search','=',true);
  if(type==='date')q=q.where('date','=',current.date);
  if(type==='point')q=q.where('place_id','=',uid);
  if(type==='pattern'||type==='item')q=q.where('uid','in',ids);
  if(startDate)q=q.where('date','>=',startDate);
  if(endDate)q=q.where('date','<=',endDate);
  if(contentType==='lyrics_work')q=q.where('site','=','suno');
  if(contentType==='text_work')q=q.where('site','!=','suno');
  if(sourceFilter.startsWith('source:')){
    q=q.where('site','=',sourceFilter.slice(7));
  }
  // UID is an identity only; publication and creation timestamps set order.
  const articleRows=await q.orderBy('createtime',sortDirection)
    .offset(offset).limit(limit+1).execute();
  const hasMore=articleRows.length>limit;
  return {rows:articleRows.slice(0,limit).map(row=>({
    row:{...row,scope_id:scope,__table:galaxy},source:String(row.site||scope)
  })),hasMore,nextOffset:hasMore?offset+limit:null};
}
