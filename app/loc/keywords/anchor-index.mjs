// CURRENT PHYSICAL KEYWORD INDEX (not an additional SQL table or legacy RPC):
// Keyword Tree uses Anchor UID edges; only Pattern.attr holds Galaxy article
// postings and Pattern.num stores their count. Older Item.keyword remains a
// label/compatibility input, never a second posting list.
// Scope-owned Pattern index. Article UID postings remain inside each Scope.
// Item.attr.uid contains Pattern ANCHOR UIDs; Pattern.attr[postingsKey] holds GALAXY article UIDs.
// Only Pattern.num is the article posting count; Class/Group/Item are navigation hierarchy.
// No database mapping registry is required for the current database.
import {allocateAnchorUid} from '../model/uid.js';
import {produce} from 'immer';
import {parseRuneKeywordRuleSentence} from '../model/rune-keyword-rules.mjs';
import {KEYWORD_PATTERN_POSTINGS_KEY,keywordPatternRecord} from '../../../packages/zenstack/anchor-hierarchy.mjs';

const UID=/^[A-Za-z0-9]{8}$/;
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
// Legacy scan clocks cannot certify newly backfilled empty Scope postings.
// The visible-text projection now includes titles and excludes markup/date headers.
// Old scan clocks cannot certify this changed matching contract.
export const SCOPE_PATTERN_INDEX_VERSION='scope_anchor_v3';
// Existing Pattern.attr key. No registry lookup or database identity query.
export const SCOPE_PATTERN_POSTING_KEY=KEYWORD_PATTERN_POSTINGS_KEY;
export function scopePatternScanClocks(metadata={}){
  const meta=typeof metadata==='string'?JSON.parse(metadata):metadata;
  if(!meta||typeof meta!=='object'||Array.isArray(meta)||
     meta.pattern_index_version!==SCOPE_PATTERN_INDEX_VERSION)return {};
  const scans=meta.pattern_scans;
  return scans&&typeof scans==='object'&&!Array.isArray(scans)?scans:{};
}
export const keywordIdentity=value=>String(value??'').normalize('NFKC').trim().toLocaleLowerCase('zh-Hant');
const visible=value=>String(value??'').normalize('NFKC').trim();
const scopeAnchor=scope=>{
  if(!SCOPE.test(String(scope||'')))throw Error('Invalid Scope Pattern lookup');
  return 'silver.'+scope+'_anchor';
};
const attrs=value=>{
  const raw=typeof value==='string'?JSON.parse(value):value;
  return raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
};
const rule=value=>Boolean(parseRuneKeywordRuleSentence(String(value||'')).rules.length);
export const literalItemWords=item=>{
  const a=attrs(item.attr),words=[item.title,...(Array.isArray(a.keyword)?a.keyword:[])],
    out=new Map();
  for(const raw of words){
    if(typeof raw!=='string'||rule(raw))continue;
    const name=visible(raw),key=keywordIdentity(raw);
    if(name&&name.length<=256&&!out.has(key))out.set(key,name);
  }
  return [...out.values()];
};

// Pattern is the canonical ZModel word index. Read its small UID/title
// directory before loading any potentially large article UID postings.
// This also preserves global normalized-word uniqueness for scoped reads.
export async function readScopePatternDirectory(db,scope){
  const rows=await db.selectFrom(scopeAnchor(scope))
    .select(['uid','title','num']).where('type','=','pattern').execute();
  return patternRowsToUidIndex(rows.map(row=>{
    const typed=keywordPatternRecord(row);
    return {uid:typed.uid,pattern:typed.literal,num:typed.count};
  }));
}

export async function readScopePatternRows(db,scope,{uids=null}={}){
  if(uids!==null&&(!Array.isArray(uids)||
     uids.some(uid=>typeof uid!=='string'||!UID.test(uid))))
    throw Error('Invalid scoped Pattern UID list');
  if(uids!==null&&!uids.length)return [];
  const table=scopeAnchor(scope),rows=[];
  const query=()=>db.selectFrom(table).select(['uid','title','attr','num','createtime'])
    .where('type','=','pattern');
  if(uids===null){
    rows.push(...await query().execute());
  }else{
    for(let i=0;i<uids.length;i+=500)
      rows.push(...await query().where('uid','in',uids.slice(i,i+500)).execute());
  }
  const projected=rows.map(row=>{
    // ZModel virtual Pattern record holds the physical UID and posting UIDs.
    // The source table is still the existing Scope Anchor, without any JOIN.
    const typed=keywordPatternRecord(row),postings=attrs(row.attr);
    return {uid:typed.uid,pattern:typed.literal,count:typed.articleUids.length,
      uid_list:typed.articleUids,num:typed.count,
      attr:postings,createtime:row.createtime};
  });
  // All readers (Statistics, Search, editor and post-import incremental
  // analysis) must share the same semantic uniqueness guard as the writer.
  // A Pattern has a physical UID PK but normalized literal is not UNIQUE.
  // Reuse the existing conflict detector rather than choosing the first UID.
  patternRowsToUidIndex(projected);
  return projected;
}

// Physical Pattern identity is the eight-character UID. The word itself is
// a searchable value, never a primary key or a substitute for an Item link.
function patternRowsToUidIndex(rows){
  const byUid=new Map(),literals=new Map();
  for(const row of rows){
    const uid=String(row?.uid||''),key=keywordIdentity(row?.pattern);
    if(!UID.test(uid)||byUid.has(uid))throw Error('Invalid or duplicate Pattern UID');
    if(!key)throw Error('Invalid Scope Pattern literal UID: '+uid);
    if(literals.has(key)&&literals.get(key)!==uid)
      throw Error('Duplicate Scope Pattern literal '+key+'；候選 UID '+
        literals.get(key)+','+uid);
    byUid.set(uid,row);literals.set(key,uid);
  }
  return byUid;
}
// Literal matching is only for discovering/reconciling NEW words in the
// editor. Existing Pattern reads and analysis writes must resolve by UID.
function patternRowsToIndex(rows){
  const out=new Map();
  for(const row of rows){
    const key=keywordIdentity(row.pattern);
    if(!key)throw Error('Invalid Scope Pattern literal UID: '+String(row.uid));
    if(out.has(key))throw Error('Duplicate Scope Pattern literal '+key+
      '；候選 UID '+String(out.get(key).uid)+','+String(row.uid));
    out.set(key,row);
  }
  return out;
}

// Reconcile the Item -> Pattern graph once, under the same signed transaction
// as a Keyword editor write or completed analysis. Existing literals remain in
// Item.keyword during compatibility cutover for older chart/import readers.
// They are NOT the index; the canonical article UID list lives on Pattern.
export async function ensureScopePatternLibrary(trx,scope){
  const table=scopeAnchor(scope),rows=await readScopePatternRows(trx,scope);
  const old=patternRowsToIndex(rows),oldByUid=patternRowsToUidIndex(rows);
  const items=await trx.selectFrom(table)
    .select(['uid','title','attr']).where('type','=','item').execute();
  const assigned=new Set([...rows.map(row=>row.uid),...items.map(row=>row.uid)]);
  const created=[],updates=[],active=new Set();
  for(const item of items){
    const a=attrs(item.attr),uids=[];
    const previous=Array.isArray(a.uid)?a.uid:[];
    const linked=new Map(previous.map(uid=>oldByUid.get(uid)).filter(Boolean)
      .map(pattern=>[keywordIdentity(pattern.pattern),pattern]));
    for(const name of literalItemWords(item)){
      const key=keywordIdentity(name);
      // Preserve the authoritative physical UID when a linked word is unchanged.
      // Only a genuinely new literal may be located by normalized word value.
      let pattern=linked.get(key)||old.get(key);
      if(!pattern){
        const uid=allocateAnchorUid(assigned);
        assigned.add(uid);
        pattern={uid,pattern:name,count:0,num:0,uid_list:[],
          attr:{[SCOPE_PATTERN_POSTING_KEY]:[]},createtime:null};
        old.set(key,pattern);
        created.push({uid,type:'pattern',title:name,attr:JSON.stringify(pattern.attr),num:0});
      }
      uids.push(pattern.uid);
      active.add(pattern.uid);
    }
    if(JSON.stringify(previous)!==JSON.stringify(uids)){
      updates.push({uid:item.uid,attr:JSON.stringify({...a,uid:uids})});
    }
  }
  const orphan=rows.filter(row=>!active.has(row.uid)).map(row=>row.uid);
  for(let i=0;i<orphan.length;i+=100)
    await trx.deleteFrom(table).where('uid','in',orphan.slice(i,i+100))
      .where('type','=','pattern').execute();
  for(let i=0;i<created.length;i+=100)
    await trx.insertInto(table).values(created.slice(i,i+100)).execute();
  for(let i=0;i<updates.length;i+=100)
    await trx.insertInto(table).values(updates.slice(i,i+100).map(row=>
      ({uid:row.uid,type:'item',attr:row.attr})))
      .onConflict(oc=>oc.column('uid').doUpdateSet(eb=>({attr:eb.ref('excluded.attr')})))
      .execute();
  return {patterns:[...old.values()].filter(row=>active.has(row.uid)),
    created:created.length,linked:updates.length,removed:orphan.length};
}

export async function storeScopePatternMatches(trx,scope,incoming=[]){
  if(!Array.isArray(incoming))throw Error('Invalid Pattern results');
  const table=scopeAnchor(scope);
  // The editor reconciles Item links. Index publication never re-walks the
  // Class/Group/Item graph or removes unlinked Pattern rows.
  const patterns=await readScopePatternRows(trx,scope);
  const byUid=patternRowsToUidIndex(patterns),updates=[],seen=new Set();
  for(const row of incoming){
    const uid=String(row?.uid||''),old=byUid.get(uid),list=row?.uid_list;
    // Never update a Pattern row based on title: a renamed word must be
    // reconciled via its Item UID edges before its postings are committed.
    if(!old||seen.has(uid)||
      keywordIdentity(row.pattern)!==keywordIdentity(old.pattern)||
      !Array.isArray(list)||list.some(id=>!UID.test(String(id)))||
      new Set(list).size!==list.length||list.length!==Number(row.count))
      throw Error('Pattern UID analysis is not consistent with the Keyword library');
    seen.add(uid);
    const next=[...list].sort();
    const before=[...old.uid_list].sort();
    if(JSON.stringify(next)===JSON.stringify(before))continue;
    const posting=produce(old.attr,draft=>{
      draft[SCOPE_PATTERN_POSTING_KEY]=next;
    });
    const count=next.length;
    updates.push({uid:old.uid,type:'pattern',title:old.pattern,
      attr:JSON.stringify(posting),num:count});
  }
  if(seen.size!==patterns.length)
    throw Error('Incomplete full-scope Pattern posting batch');
  for(let i=0;i<updates.length;i+=100)
    await trx.insertInto(table).values(updates.slice(i,i+100))
      .onConflict(oc=>oc.column('uid').doUpdateSet(eb=>({
        attr:eb.ref('excluded.attr'),num:eb.ref('excluded.num')
      }))).execute();
  return {changed:updates.length,indexed:incoming.length};
}
