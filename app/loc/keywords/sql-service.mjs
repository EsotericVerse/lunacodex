import {KEYWORD_SCAN_START_ROWS,KEYWORD_SCAN_CHECKPOINT_ROWS}
  from './item-count-analysis.mjs';
import {sql} from 'kysely';
import {computeClient,keywordComputeAbsorber} from '../compute/runtime.mjs';
// LOC Keyword patterns are the only literal match source. Item.attr.uid links
// Pattern Anchors; Pattern.num stores occurrences while Item/Group.attr.total
// retains class-level aggregate totals. Class completion remains in keyword_meta.
import {parseRuneKeywordRuleSentence} from '../model/rune-keyword-rules.mjs';
import {analyzeItemKeywordCounts,readItemKeywordProjection,
  itemKeywordStatistics,itemScope} from './item-count-analysis.mjs';
import {createIndexedDateKeywordReader} from './article-reader.mjs';
import {completeKeywordClass,invalidateKeywordClass,
  readKeywordScanProgress,writeKeywordScanProgress,
  keywordClassEpoch,bumpKeywordClassEpoch} from './class-state.mjs';
import {galaxyReadColumns} from '../../../packages/zenstack/galaxy-read-models.mjs';
import {allocateAnchorUid} from '../model/uid.js';

const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const UID=/^[0-9A-Za-z]{8}$/;
const DATE=/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const norm=x=>String(x??'').normalize('NFKC').trim().toLocaleLowerCase('zh-Hant');
const fail=(message,status=400)=>{
  const err=new Error(message);err.httpStatus=status;throw err;
};
const checkScope=id=>{
  if(!SCOPE.test(String(id||'')))fail('Invalid Keyword Scope');
  return id;
};
const checkClass=uid=>{
  if(!UID.test(String(uid||'')))fail('Invalid Keyword Class');
  return uid;
};
const attr=node=>{
  const raw=node?.attr||{};
  return typeof raw==='string'?JSON.parse(raw):raw;
};
const children=node=>{
  const raw=attr(node).uid;
  return Array.isArray(raw)?raw.filter(uid=>UID.test(String(uid))):[];
};
const anchorName=scope=>'silver.'+checkScope(scope)+'_anchor';
const galaxyName=scope=>'silver.'+checkScope(scope)+'_galaxy';
const configName=scope=>'silver.'+checkScope(scope);
// Item-rule aggregate analysis reads Gallery metadata by date/UID only;
// no Pattern-to-Galaxy article UID postings or full-text index are created.
const galaxyListMetadataColumns=Object.freeze([
  ...galaxyReadColumns('GalaxyList')
    .filter(name=>['uid','date','keyword'].includes(name))
]);
// Native SQL scan returns the same ordered UID metadata and only the text
// eligible for keyword analysis. Excluded rows still count toward progress,
// but their full bodies never cross the SQL transport.
const galaxyKeywordScanProjection=Object.freeze([
  ...galaxyListMetadataColumns,
  sql`case when ${sql.ref('keyword')} is false then null
    else ${sql.ref('title')} end`.as('title'),
  sql`case when ${sql.ref('keyword')} is false then null
    else ${sql.ref('content')} end`.as('content')
]);
// Keyword analysis is paged across requests, not capped to a fixed number
// of Scope articles. Each short request commits a resumable SQL checkpoint
// BEFORE returning so Cloudflare request limits never erase the whole scan.
// One request analyzes 4096–8192 articles, based on measured throughput.
// The 4096-row decision either saves and returns (slow) or continues to 8192
// before saving (fast). This is not a full-Scope row limit.
const KEYWORD_ROWS_PER_REQUEST=8192;
const KEYWORD_MIN_ROWS_PER_REQUEST=4096;
const KEYWORD_CHECKPOINT_ROWS=KEYWORD_SCAN_CHECKPOINT_ROWS;
const KEYWORD_REQUEST_BUDGET_MS=15000;

const removeLegacyKeywordHitCache=value=>{
  const {uidlists,articles,hits,total,...links}=value||{};
  // Keep Item.attr.uid: these are Pattern Anchor IDs, not article postings.
  return links;
};
const cleanItemAttr=(value,patternUids)=>{
  const {keyword,total,uidlists,articles,hits,...rest}=attr({attr:value});
  return {...rest,uid:[...patternUids]};
};

async function configuration(db,scope){
  return await db.selectFrom(configName(scope))
    .select(['current_keyword_class_uid','keyword_meta','keyword_min_chars','keyword_min_documents'])
    .where('id','=',scope).executeTakeFirst()||fail('Keyword Scope not configured',404);
}
function shared(config,classUid){
  return attr({attr:config.keyword_meta}).class_shares?.[classUid]===true;
}

async function classTree(db,scope,classUid){
  const anchor=anchorName(scope);
  const root=await db.selectFrom(anchor).select(['uid','type','title','description','attr'])
    .where('uid','=',checkClass(classUid)).where('type','=','class').executeTakeFirst();
  if(!root)fail('Unknown Keyword Class',404);
  const groupUids=children(root);
  const groups=groupUids.length?await db.selectFrom(anchor)
    .select(['uid','type','title','description','attr']).where('type','=','group')
    .where('uid','in',groupUids).execute():[];
  const groupMap=new Map(groups.map(group=>[group.uid,group]));
  if(groupUids.some(uid=>!groupMap.has(uid)))fail('Keyword Group relationship incomplete');
  const ordered=groupUids.map(uid=>groupMap.get(uid));
  const itemUids=[...new Set(ordered.flatMap(children))];
  const items=itemUids.length?await db.selectFrom(anchor)
    .select(['uid','type','title','description','attr']).where('type','=','item')
    .where('uid','in',itemUids).execute():[];
  const byItem=new Map(items.map(item=>[item.uid,item]));
  if(itemUids.some(uid=>!byItem.has(uid)))fail('Keyword Item relationship incomplete');
  const patternIds=[...new Set(items.flatMap(children))].sort();
  const matches=patternIds.length?await db.selectFrom(anchor)
    .select(['uid','title','num']).where('type','=','pattern')
    .where('uid','in',patternIds).execute():[];
  const byPattern=new Map(matches.map(row=>[row.uid,row]));
  if(patternIds.some(uid=>!byPattern.has(uid)))
    fail('Keyword Pattern relationship incomplete',409);
  const patterns=patternIds.map(uid=>({uid,title:String(byPattern.get(uid).title||''),
    num:Math.max(0,Number(byPattern.get(uid).num)||0)}));
  const patternByUid=new Map(patterns.map(row=>[row.uid,row]));
  const words=ordered.flatMap(group=>children(group).map(uid=>{
    const item=byItem.get(uid),patternUids=children(item);
    const linkedPatterns=patternUids.map(id=>patternByUid.get(id));
    return {uid,item_name:String(item.title||''),group_uid:group.uid,
      patternUids,patterns:linkedPatterns,
      keywords:linkedPatterns.map(pattern=>pattern.title)};
  }));
  return {root,groups:ordered,items:words,itemRows:items,patterns};
}

const validateKeywordFilters=({start='',end='',source=''})=>{
  if([start,end].some(v=>v&&!DATE.test(v))||start&&end&&start>end||
    typeof source!=='string'||source.length>120)fail('Invalid Keyword filters');
};

// Fixed, owner-only Keyword editor snapshot. No browser-selected SQL relation,
// projection, filter or unrestricted SELECT. Each page uses bounded direct
// SELECTs; the physical Anchor model is unchanged.
export async function readKeywordWorkspace(db,scope,{cursor='',limit=250}={}){
  checkScope(scope);
  if(cursor&&!UID.test(cursor))fail('Invalid Keyword editor cursor',400);
  if(!Number.isInteger(limit)||limit<1||limit>250)
    fail('Invalid Keyword editor page size',400);
  let q=db.selectFrom(anchorName(scope))
    .select(['uid','type','title','description','attr'])
    .where('type','in',['category','class','group','item']);
  if(cursor)q=q.where('uid','>',cursor);
  const rows=await q.orderBy('uid','asc').limit(limit+1).execute();
  const page=rows.slice(0,limit);
  const patternIds=[...new Set(page.filter(row=>row.type==='item').flatMap(children))].sort();
  const patternRows=patternIds.length?await db.selectFrom(anchorName(scope))
    .select(['uid','title','num']).where('type','=','pattern')
    .where('uid','in',patternIds).execute():[];
  const patternByUid=new Map(patternRows.map(row=>[row.uid,{uid:row.uid,
    title:String(row.title||''),num:Math.max(0,Number(row.num)||0)}]));
  if(patternIds.some(uid=>!patternByUid.has(uid)))
    fail('Keyword Pattern relationship incomplete',409);
  const enriched=page.map(row=>{
    if(row.type!=='item')return row;
    const linked=children(row).map(uid=>patternByUid.get(uid));
    const legacy=attr(row);
    // Before the Pattern model, Item.title matched implicitly and
    // attr.keyword held the Item's rule/phrase list. Project both as virtual
    // Patterns until the owner runs the next reset-and-analysis transaction.
    const titles=Object.hasOwn(legacy,'keyword')
      ?[String(row.title||''),...(Array.isArray(legacy.keyword)?legacy.keyword:[]),
        ...linked.map(pattern=>pattern.title)]
      :linked.map(pattern=>pattern.title);
    const seen=new Set(),patterns=[];
    for(const title of titles){
      const text=String(title||'').normalize('NFKC').trim(),key=norm(text);
      if(!text||!key||seen.has(key))continue;
      seen.add(key);
      patterns.push(linked.find(pattern=>norm(pattern.title)===key)||{uid:'',title:text,num:0});
    }
    return {...row,patterns};
  });
  const config=await db.selectFrom(configName(scope))
    .select(['current_keyword_class_uid','keyword_min_chars',
      'keyword_min_documents','keyword_class_share_enabled',
      'keyword_meta','staticstime'])
    .where('id','=',scope).executeTakeFirst();
  if(!config)fail('Keyword Scope not configured',404);
  return {rows:enriched,config,nextCursor:rows.length>limit
    ?String(page.at(-1).uid):null};
}

export async function readKeywordClasses(db,scope,{owner=false}={}){
  checkScope(scope);
  const cfg=await configuration(db,scope);
  const classes=await db.selectFrom(anchorName(scope)).select(['uid','title'])
    .where('type','=','class').execute();
  const visible=classes.filter(row=>owner||shared(cfg,row.uid));
  if(!visible.length)return {classes:[],currentClassUid:''};
  const categories=await db.selectFrom(anchorName(scope))
    .select(['uid','title','attr']).where('type','=','category').execute();
  const categoryByClass=new Map();
  for(const category of categories)
    for(const id of children(category))categoryByClass.set(id,String(category.title||''));
  return {classes:visible.map(row=>({
    classUid:row.uid,name:String(row.title||''),categoryName:categoryByClass.get(row.uid)||''
  })),currentClassUid:visible.some(row=>row.uid===cfg.current_keyword_class_uid)
    ?cfg.current_keyword_class_uid:visible[0].uid};
}

export async function readKeywordStatistics(db,scope,classUid,{
  owner=false,start='',end='',source='',_returnTree=false
}={}){
  checkScope(scope);checkClass(classUid);validateKeywordFilters({start,end,source});
  const cfg=await configuration(db,scope);
  if(!owner&&!shared(cfg,classUid))fail('Keyword Class not published',403);
  const tree=await classTree(db,scope,classUid);
  const meta=attr({attr:cfg.keyword_meta});
  const receipt=meta.by_class?.[classUid]||{};
  const ready=Boolean(receipt.completedAt)&&receipt.stale!==true;
  let counts={},daily=[];
  if(!ready){
    // Reset removes the Class completion receipt. A date/source-filtered
    // statistics read must NOT silently scan Galaxy again and display hits
    // from the original articles. Keep all totals zero until an explicit
    // successful analysis commits a fresh Class receipt. The Keyword Tree
    // structure and its UIDs remain intact.
  }else if(start||end||source){
    const result=await readItemKeywordProjection(db,scope,{
      ...itemScope(tree),start,end,source,owner:true,
      minChars:Math.max(0,Number(cfg.keyword_min_chars)||0)
    });
    counts=result.totals;daily=result.daily;
  }else{
    const rows=await db.selectFrom(anchorName(scope))
      .select(['uid','attr']).where('uid','in',[
        tree.root.uid,...tree.groups.map(row=>row.uid),
        ...tree.items.map(row=>row.uid)
      ]).execute();
    const byUid=new Map(rows.map(row=>[row.uid,Number(attr(row).total)||0]));
    counts={
      ...receipt,
      itemCounts:Object.fromEntries(tree.items.map(item=>[item.uid,byUid.get(item.uid)||0])),
      groupCounts:Object.fromEntries(tree.groups.map(row=>[row.uid,byUid.get(row.uid)||0])),
      patternCounts:Object.fromEntries(tree.patterns.map(pattern=>[pattern.uid,pattern.num]))
    };
  }
  const stats=itemKeywordStatistics(tree.items,itemScope(tree).groups,counts);
  return {
    ...(_returnTree?{_tree:tree}:{}),
    class_uid:classUid,class_name:String(tree.root.title||''),
    completedAt:ready?String(receipt.completedAt):'',indexPending:!ready,
    keywordMinChars:Math.max(0,Number(cfg.keyword_min_chars??32)),
    keywordMinDocuments:Math.max(0,Number(cfg.keyword_min_documents??100)),
    ...stats,daily
  };
}

export async function readKeywordCatalog(db,scope,classUid,{owner=false}={}){
  // Reuse the same Item/Group tree; hit counts come from existing attr.total.
  const {_tree:tree,...stats}=await readKeywordStatistics(db,scope,classUid,{
    owner,_returnTree:true
  });
  const indexed=new Map(stats.items.map(item=>[item.uid,item]));
  const groups=new Map(stats.groups.map(group=>[group.uid,group]));
  const model=node=>({
    uid:node.uid,type:node.type,name:String(node.title||''),
    desc:node.type==='item'?'':String(node.description||''),
    lists:node.type==='class'?children(node):node.type==='group'?children(node):
      tree.items.find(item=>item.uid===node.uid)?.keywords||[],
    uid_lists:[],total:node.type==='item'?indexed.get(node.uid)?.hit_count||0:
      node.type==='group'?groups.get(node.uid)?.hit_count||0:0
  });
  const anchor=anchorName(scope);
  const itemByUid=new Map(tree.itemRows.map(row=>[row.uid,row]));
  return {class_uid:classUid,rows:[
    model(tree.root),...tree.groups.map(model),
    ...tree.items.map(item=>model(itemByUid.get(item.uid))).filter(Boolean)
  ]};
}

export async function readKeywordDaily(db,scope,classUid,{
  owner=false,start='',end='',source='',places=null
}={}){
  checkScope(scope);checkClass(classUid);validateKeywordFilters({start,end,source});
  const cfg=await configuration(db,scope);
  if(!owner&&!shared(cfg,classUid))fail('Keyword Class not published',403);
  const meta=attr({attr:cfg.keyword_meta});
  const receipt=meta.by_class?.[classUid];
  // Daily statistics are an analysis projection too. After Reset, do not
  // repopulate the chart by silently scanning the original Galaxy content.
  // Only an explicitly completed new analysis re-enables this projection.
  if(!receipt?.completedAt||receipt.stale===true)return [];
  const tree=await classTree(db,scope,classUid);
  const result=await readItemKeywordProjection(db,scope,{
    ...itemScope(tree),start,end,source,places,owner:true,
    minChars:Math.max(0,Number(cfg.keyword_min_chars)||0)
  });
  return result.daily;
}

export async function suggestKeywordPatterns(db,scopeIds=[],query='',{
  ownerScopes=new Set()
}={}){
  if(!Array.isArray(scopeIds)||scopeIds.length<1||scopeIds.length>50||
     scopeIds.some(scope=>!SCOPE.test(String(scope||'')))||
     typeof query!=='string'||query.length>120)
    fail('Invalid Keyword suggestion');
  const prefix=norm(query);
  if(!prefix||UID.test(prefix))return [];
  const found=new Map();
  // Suggestions are a read stream over the selected dialect's Kysely query
  // interface. Keep each driver result bounded instead of materializing every
  // Item and Pattern row for every Scope in one request.
  const streamType=async function*(anchor,type,columns,pageSize){
    let cursor='';
    for(;;){
      let pageQuery=db.selectFrom(anchor).select(columns).where('type','=',type);
      if(cursor)pageQuery=pageQuery.where('uid','>',cursor);
      const page=await pageQuery.orderBy('uid','asc').limit(pageSize).execute();
      if(!Array.isArray(page)||page.length>pageSize)
        fail('Keyword suggestion page is incomplete',503);
      if(!page.length)return;
      let previous=cursor;
      for(const row of page){
        const uid=String(row?.uid||'');
        if(!UID.test(uid)||uid<=previous)
          fail('Keyword suggestion cursor did not advance',503);
        previous=uid;
        yield row;
      }
      cursor=previous;
    }
  };
  for(const scope of new Set(scopeIds)){
    if(!ownerScopes.has(scope))continue;
    const anchor=anchorName(scope);
    const linked=new Set();
    for await(const item of streamType(anchor,'item',['uid','attr'],512))
      for(const uid of children(item))linked.add(uid);
    if(!linked.size)continue;
    // Pattern remains the searchable vocabulary owner; Item only links to
    // Pattern UIDs. Scan Pattern pages in UID order and retain only literal
    // matches linked from an Item. No Item.title matching or article scan.
    for await(const row of streamType(anchor,'pattern',['uid','title'],1024)){
      if(!linked.has(String(row.uid)))continue;
      const literal=String(row.title||'').trim(),key=norm(literal);
      if(!key.includes(prefix)||!literal||parseRuneKeywordRuleSentence(literal).rules.length)continue;
      if(!found.has(key))found.set(key,{pattern:literal,count:0});
    }
  }
  return [...found.values()].sort((a,b)=>
    Number(norm(b.pattern).startsWith(prefix))-Number(norm(a.pattern).startsWith(prefix))||
    a.pattern.localeCompare(b.pattern)).slice(0,10);
}

// PostgreSQL row lock makes Reset, Checkpoint and Finalize linearizable.
// The lock is acquired BEFORE any per-Item writes; no stale background job
// may republish counters after a successful reset.
async function lockedKeywordMetadata(trx,scope,classUid,expectedEpoch){
  const row=await trx.selectFrom(configName(scope))
    .select('keyword_meta').where('id','=',scope).forUpdate().executeTakeFirst();
  if(!row)fail('Keyword Scope not configured',404);
  const meta=attr({attr:row.keyword_meta});
  if(keywordClassEpoch(meta,classUid)!==expectedEpoch)
    fail('Keyword analysis invalidated by reset; start a new analysis',409);
  return meta;
}

// Item and Group retain their small class-level aggregate counters in attr.
// Pattern occurrence counts live on the existing Pattern Anchor's num column.
// This is not a second keyword index or a public SQL request surface.
// Pure and testable: distinct physical Anchor PKs, not occurrences of the
// same Item under several Keyword Groups, determine UPDATE row cardinality.
export function planKeywordTotalWrites(updates){
  if(!Array.isArray(updates))fail('Invalid Keyword aggregate counts');
  const byUid=new Map();
  for(const row of updates){
    if(!UID.test(String(row?.uid||''))||
       row?.type!==undefined&&!['item','group','pattern'].includes(row.type)||
       !Number.isSafeInteger(row.total)||row.total<0)
      fail('Invalid Keyword aggregate counts');
    const value={...(row.type?{type:row.type}:{}),total:row.total};
    if(byUid.has(row.uid)&&(byUid.get(row.uid).type!==value.type||
       byUid.get(row.uid).total!==value.total))
      fail('Conflicting Keyword counts for one Anchor UID',409);
    byUid.set(row.uid,value);
  }
  return [...byUid].map(([uid,value])=>({uid,...value}));
}
async function writeKeywordTotals(trx,scope,updates){
  if(updates.some(row=>!['item','group','pattern'].includes(row?.type)))
    fail('Keyword aggregate target type is required');
  const physicalUpdates=planKeywordTotalWrites(updates);
  if(!physicalUpdates.length)return 0;
  const table=sql.ref(anchorName(scope));
  const itemGroupUpdates=physicalUpdates.filter(row=>row.type==='item'||row.type==='group');
  if(itemGroupUpdates.length){
    const payload=JSON.stringify(itemGroupUpdates);
    const result=await sql`
      update ${table} as a
      set attr=jsonb_set(coalesce(a.attr,'{}'::jsonb),
        '{total}',to_jsonb(incoming.total),true)
      from jsonb_to_recordset(${payload}::jsonb) as incoming(uid text,total bigint)
      where a.uid=incoming.uid::char(8) and a.type in ('item','group')
    `.execute(trx);
    if(Number(result.numAffectedRows??0)!==itemGroupUpdates.length)
      fail('Keyword aggregate targets changed',409);
  }
  const patternUpdates=physicalUpdates.filter(row=>row.type==='pattern');
  if(patternUpdates.length){
    const payload=JSON.stringify(patternUpdates);
    const result=await sql`
      update ${table} as a
      set num=incoming.total::bigint,
        attr=coalesce(a.attr,'{}'::jsonb)-'total'
      from jsonb_to_recordset(${payload}::jsonb) as incoming(uid text,total bigint)
      where a.uid=incoming.uid::char(8) and a.type='pattern'
    `.execute(trx);
    if(Number(result.numAffectedRows??0)!==patternUpdates.length)
      fail('Keyword Pattern counts changed',409);
  }
  return physicalUpdates.length;
}

async function persistItemCounts(trx,scope,classUid,tree,counts,attemptId='',expectedCount=null,expectedEpoch=0){
  const old=await lockedKeywordMetadata(trx,scope,classUid,expectedEpoch);
  if(expectedCount!==null){
    const latest=await trx.selectFrom(galaxyName(scope))
      .select(eb=>eb.fn.count('uid').as('n')).executeTakeFirst();
    if(Number(latest?.n)!==expectedCount)
      fail('Galaxy changed during Item analysis; rerun',409);
  }
  const current=await classTree(trx,scope,classUid);
  if(JSON.stringify(current.items)!==JSON.stringify(tree.items)||
      JSON.stringify(current.groups.map(x=>x.uid))!==
      JSON.stringify(tree.groups.map(x=>x.uid))||
      JSON.stringify(current.patterns)!==JSON.stringify(tree.patterns))
    fail('Item/Pattern rules changed during analysis; rerun',409);
  const updates=[
    ...current.items.map(item=>({uid:item.uid,type:'item',
      total:Math.max(0,Number(counts.itemCounts?.[item.uid])||0)})),
    ...current.groups.map(group=>({uid:group.uid,type:'group',
      total:Math.max(0,Number(counts.groupCounts?.[group.uid])||0)})),
    ...current.patterns.map(pattern=>({uid:pattern.uid,type:'pattern',
      total:Math.max(0,Number(counts.patternCounts?.[pattern.uid])||0)}))
  ];
  // The lock makes aggregate writes and Pattern.num commits linearizable.
  await writeKeywordTotals(trx,scope,updates);
  const now=new Date().toISOString();
  const {pattern_index_version,pattern_scans,scan_progress,...rest}=old;
  // Pattern counters belong to their existing Anchor rows, not a duplicate
  // finished-Class cache inside Scope keyword_meta.
  const {itemCounts,groupCounts,patternCounts,...smallCounts}=counts;
  const completed=completeKeywordClass(rest,classUid,{
    ...smallCounts,...(attemptId?{attemptId}:{})
  },now);
  await trx.updateTable(configName(scope)).set({
    keyword_meta:JSON.stringify({...completed,scan_progress:{}}),
    staticstime:null,updated_at:now
  }).where('id','=',scope).execute();
}

async function persistScanProgress(trx,scope,classUid,progress,expectedEpoch){
  const meta=await lockedKeywordMetadata(trx,scope,classUid,expectedEpoch);
  await trx.updateTable(configName(scope))
    .set({keyword_meta:JSON.stringify(writeKeywordScanProgress(meta,classUid,progress))})
    .where('id','=',scope).execute();
}

export async function analyzeKeywordScope(db,scope,classUid,{
  authorizeTransaction=()=>{},startedAt=new Date().toISOString(),onProgress=()=>{},
  attemptId='',analysisEpoch=null
}={}){
  checkScope(scope);checkClass(classUid);
  if(!Number.isSafeInteger(analysisEpoch)||analysisEpoch<1)
    fail('Keyword analysis requires a confirmed reset generation',409);
  const cfg=await configuration(db,scope),tree=await classTree(db,scope,classUid);
  const meta=attr({attr:cfg.keyword_meta});
  const expectedEpoch=keywordClassEpoch(meta,classUid);
  if(expectedEpoch!==analysisEpoch)
    fail('舊分析工作階段已失效；請重新從零開始解析',409);
  // Checkpoints are legal only for the SAME fresh epoch. Subsequent row
  // locks prevent old checkpoints/final totals committing after another reset.
  const resume=readKeywordScanProgress(meta,classUid);
  const total=await db.selectFrom(galaxyName(scope))
    .select(eb=>eb.fn.count('uid').as('n')).executeTakeFirst();
  const expectedCount=Number(total?.n??0);
  if(!Number.isSafeInteger(expectedCount)||expectedCount<0)
    fail('Galaxy article count out of range');
  const reader=createIndexedDateKeywordReader({
    readDateBatch:async({afterDate,afterUid,limit})=>{
      let q=db.selectFrom(galaxyName(scope)).select(galaxyKeywordScanProjection)
        .where('date','is not',null)
        .orderBy('date','asc').orderBy('uid','asc').limit(limit);
      if(afterDate!==null)q=q.where(eb=>eb.or([
        eb('date','>',afterDate),eb.and([eb('date','=',afterDate),eb('uid','>',afterUid)])
      ]));
      return q.execute();
    },
    readUndatedBatch:async({afterUid,limit})=>{
      let q=db.selectFrom(galaxyName(scope)).select(galaxyKeywordScanProjection)
        .where('date','is',null).orderBy('uid','asc').limit(limit);
      if(afterUid!==null)q=q.where('uid','>',afterUid);
      return q.execute();
    }
  });
  const remoteAbsorb=keywordComputeAbsorber(await computeClient(db));
  const result=await analyzeItemKeywordCounts({
    ...itemScope(tree),patterns:tree.patterns,expectedCount,readMetadataPage:reader,remoteAbsorb,
    minChars:Math.max(0,Number(cfg.keyword_min_chars)||0),
    pageSize:KEYWORD_SCAN_START_ROWS,resume,
    maxRowsPerRun:KEYWORD_ROWS_PER_REQUEST,
    minRowsPerRun:KEYWORD_MIN_ROWS_PER_REQUEST,
    checkpointRows:KEYWORD_CHECKPOINT_ROWS,
    timeBudgetMs:KEYWORD_REQUEST_BUDGET_MS,
    paceRows:true,deferFinalization:true,
    onCheckpoint:async progress=>{
      await db.transaction().execute(async trx=>{
        await authorizeTransaction(trx);
        // The attempt ID identifies this specific persisted tail if the
        // network closes before the server emits its next-step receipt.
        await persistScanProgress(trx,scope,classUid,
          {...progress,...(attemptId?{attemptId}:{})},expectedEpoch);
      });
      onProgress({phase:progress.finalizePending?'finalizing':'checkpoint',
        total:expectedCount,completed:progress.scanned,parsed:progress.parsed,
        matchedDocuments:progress.matchedDocuments,itemMatches:progress.itemMatches,occurrences:progress.occurrences,
        targetRowsPerSecond:progress.targetRowsPerSecond,
        percent:Math.min(99,Math.round(expectedCount?
          progress.scanned/expectedCount*100:0)),
        label:progress.finalizePending
          ?'最後不足整批的文章已存檔，正在提交統計'
          :'分析進度已保存，可接續下一批'});
    },
    onProgress:({phase,completed=0,parsed=0,matchedDocuments,itemMatches,occurrences,
      rowsPerSecond=0,targetRowsPerSecond=null})=>onProgress({
      phase,total:expectedCount,completed,parsed,matchedDocuments,itemMatches,occurrences,
      rowsPerSecond,targetRowsPerSecond,
      percent:phase==='completed'?100:Math.min(99,
        Math.round(expectedCount?completed/expectedCount*100:0)),
      label:phase==='completed'?'分析已完成'
        :phase==='finalizing'?'尾段已存檔，正在完成統計':'逐批分析 Item 規則'
    }),
    finalize:async counts=>db.transaction().execute(async trx=>{
      await authorizeTransaction(trx);
      await persistItemCounts(trx,scope,classUid,tree,counts,attemptId,expectedCount,expectedEpoch);
    })
  });
  if(result.incomplete)return {incomplete:true,total:expectedCount,
    completed:result.scanned,parsed:result.parsed,reused:0,
    matchedDocuments:result.matchedDocuments,itemMatches:result.itemMatches,occurrences:result.occurrences,
    finalizePending:result.finalizePending===true,
    rowsPerSecond:result.rowsPerSecond,
    targetRowsPerSecond:result.targetRowsPerSecond};
  return {...result,reusedDocuments:0,indexedWords:0};
}

// Fixed-purpose read-only completion check for one client operation.
// No article contents, Pattern UIDs, or SQL authority leave this action.
export async function readKeywordAnalysisCompletion(db,scope,classUid,attemptId){
  checkScope(scope);checkClass(classUid);
  if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(String(attemptId||'')))
    fail('Invalid Keyword analysis attempt',400);
  const cfg=await configuration(db,scope);
  const meta=attr({attr:cfg.keyword_meta});
  const record=meta.by_class?.[classUid];
  if(!record||record.attemptId!==attemptId||!record.completedAt){
    const pending=readKeywordScanProgress(meta,classUid);
    // Do not expose the saved cursor, article bodies or Item counters.
    // A matching attempt may safely continue automatically: the tail
    // request ONLY checkpointed and returned; it never began final SQL.
    if(pending?.finalizePending===true&&
        Number.isSafeInteger(pending.scanned)&&pending.scanned>=0)
      return {completed:false,resumable:true,
        attemptMatched:pending.attemptId===attemptId,
        scanned:pending.scanned,parsed:Number(pending.parsed)||0};
    return {completed:false};
  }
  return {completed:true,result:{
    classUid,analyzedDocuments:Number(record.analyzedDocuments)||0,
    matchedDocuments:Number(record.matchedDocuments)||0,
    parsedDocuments:Number(record.parsedDocuments)||0,
    reusedDocuments:Number(record.reusedDocuments)||0,
    itemMatches:Number(record.itemMatches)||0,
    occurrences:Number(record.occurrences)||0,
    completedAt:record.completedAt
  }};
}

// Reset one Class's completed receipt, unfinished cursor and all linked
// Item/Group/Pattern totals in the SAME authorized transaction.
export async function resetKeywordScope(db,scope,classUid,{
  authorizeTransaction=()=>{}
}={}){
  checkScope(scope);checkClass(classUid);
  return db.transaction().execute(async trx=>{
    await authorizeTransaction(trx);
    const cfg=await trx.selectFrom(configName(scope))
      .select('keyword_meta').where('id','=',scope).forUpdate().executeTakeFirst();
    if(!cfg)fail('Keyword Scope not configured',404);
    const before=await classTree(trx,scope,classUid);
    const legacyItemsMaterialized=await materializeLegacyItemPatterns(
      trx,scope,before);
    const tree=legacyItemsMaterialized
      ?await classTree(trx,scope,classUid):before;
    const classItems=new Set(tree.items.map(item=>item.uid));
    const otherItems=await trx.selectFrom(anchorName(scope)).select(['uid','attr'])
      .where('type','=','item').execute();
    const sharedPatterns=new Set(otherItems.filter(item=>!classItems.has(item.uid))
      .flatMap(children));
    const ids=[...tree.groups.map(row=>({uid:row.uid,type:'group'})),
      ...tree.items.map(row=>({uid:row.uid,type:'item'})),
      ...tree.patterns.filter(pattern=>!sharedPatterns.has(pattern.uid))
        .map(row=>({uid:row.uid,type:'pattern'}))];
    // Reset analyzed counts while preserving hierarchy UID lists.
    const changed=await writeKeywordTotals(trx,scope,ids.map(row=>({...row,total:0})));
    const previous=attr({attr:cfg.keyword_meta});
    const meta=bumpKeywordClassEpoch(
      writeKeywordScanProgress(invalidateKeywordClass(previous,classUid),classUid,null),
      classUid);
    // Never acknowledge an incomplete reset. Clearing the cursor and
    // incrementing the epoch makes a late, disconnected scan unable to
    // restore its old 32768-row snapshot.
    if(readKeywordScanProgress(meta,classUid)!==null||
      Object.hasOwn(meta.by_class||{},classUid))
      fail('Keyword reset failed to clear analysis state',409);
    await trx.updateTable(configName(scope)).set({
      keyword_meta:JSON.stringify(meta),staticstime:null,
      updated_at:new Date().toISOString()
    }).where('id','=',scope).execute();
    return {count:changed,retainedShared:0,cleared:true,legacyItemsMaterialized,
      resetEpoch:keywordClassEpoch(meta,classUid),
      clearedPatterns:tree.patterns.length};
  });
}

const asNodeText=value=>String(value??'').normalize('NFKC').trim();
function checkKeywordWordList(value){
  if(!Array.isArray(value)||value.length>400)fail('Too many Item Patterns');
  const seen=new Set(),out=[];
  for(const raw of value){
    if(typeof raw!=='string')fail('Invalid Pattern word');
    const word=asNodeText(raw),key=norm(word);
    if(!word||word.length>256||seen.has(key))continue;
    seen.add(key);out.push(word);
  }
  return out;
}
async function findContainingGroup(trx,scope,itemUid){
  const groups=await trx.selectFrom(anchorName(scope))
    .select(['uid','attr']).where('type','=','group').execute();
  const parents=groups.filter(group=>children(group).includes(itemUid));
  if(parents.length!==1)fail('Keyword Item parent Group is missing or ambiguous',409);
  return parents[0];
}
async function classContainingGroup(trx,scope,groupUid){
  const classes=await trx.selectFrom(anchorName(scope))
    .select(['uid','attr']).where('type','=','class').execute();
  const matched=classes.filter(row=>children(row).includes(groupUid));
  if(matched.length!==1)fail('Keyword Group parent Class is missing or ambiguous',409);
  return matched[0].uid;
}
// Upgrade only pre-Pattern Items, identified by the retired attr.keyword
// property. Old Item.title semantics become an explicit Pattern once; new
// Items have no such marker and never inherit their label as a match rule.
async function materializeLegacyItemPatterns(trx,scope,tree){
  const table=anchorName(scope),legacyItems=tree.itemRows.filter(row=>
    Object.hasOwn(attr(row),'keyword'));
  if(!legacyItems.length)return 0;
  const rows=await trx.selectFrom(table).select(['uid','title'])
    .where('type','=','pattern').orderBy('uid','asc').execute();
  const byTitle=new Map();
  for(const row of rows){
    const key=norm(row.title);
    if(key&&!byTitle.has(key))byTitle.set(key,row);
  }
  const assigned=new Set();
  for(const item of legacyItems){
    const old=attr(item),links=children(item),titles=[
      String(item.title||''),...(Array.isArray(old.keyword)?old.keyword:[])
    ];
    const linkedPatterns=links.length?await trx.selectFrom(table)
      .select(['uid','title']).where('type','=','pattern').where('uid','in',links).execute():[];
    if(linkedPatterns.length!==links.length)
      fail('Keyword Pattern relationship incomplete',409);
    titles.push(...linkedPatterns.map(row=>row.title));
    const patternUids=[];
    for(const title of titles){
      const word=asNodeText(title),key=norm(word);
      if(!key)continue;
      let pattern=byTitle.get(key);
      if(!pattern){
        let inserted=null;
        for(let attempt=0;attempt<32&&!inserted;attempt++){
          const uid=allocateAnchorUid(assigned);assigned.add(uid);
          inserted=await trx.insertInto(table).values({uid,type:'pattern',
            title:word,description:'',attr:'{}'}).onConflict(oc=>
            oc.column('uid').doNothing()).returning(['uid','title']).executeTakeFirst();
        }
        if(!inserted)fail('Cannot allocate unique Pattern UID',409);
        pattern=inserted;byTitle.set(key,pattern);
      }
      if(!patternUids.includes(pattern.uid))patternUids.push(pattern.uid);
    }
    await trx.updateTable(table).set({attr:JSON.stringify(
      cleanItemAttr(item.attr,patternUids))})
      .where('uid','=',item.uid).where('type','=','item').execute();
  }
  return legacyItems.length;
}
async function invalidateKeywordTreeClass(trx,scope,classUid){
  const cfg=await configuration(trx,scope);
  const metadata=invalidateKeywordClass(cfg.keyword_meta,classUid);
  await trx.updateTable(configName(scope))
    .set({keyword_meta:JSON.stringify(metadata),staticstime:null,
      updated_at:new Date().toISOString()}).where('id','=',scope).execute();
}

// The Item editor's single authorized transaction saves Pattern Anchor rows,
// maintains Group membership and stores only Pattern UIDs on the Item.
export async function saveKeywordItem(db,scope,values,{
  authorizeTransaction=()=>{}
}={}){
  checkScope(scope);
  if(!values||typeof values!=='object'||Array.isArray(values)||
    !UID.test(String(values.uid||''))||
    typeof values.name!=='string'||!asNodeText(values.name)||
    asNodeText(values.name).length>256||
    typeof values.desc!=='string'||values.desc.length>4000)
    fail('Invalid Keyword Item');
  const words=checkKeywordWordList(values.words);
  const mode=String(values.mode||'');
  if(!['create','update'].includes(mode))fail('Invalid Item write mode');
  return db.transaction().execute(async trx=>{
    await authorizeTransaction(trx);
    const scopeLock=await trx.selectFrom(configName(scope)).select('id')
      .where('id','=',scope).forUpdate().executeTakeFirst();
    if(!scopeLock)fail('Keyword Scope not configured',404);
    const table=anchorName(scope),old=await trx.selectFrom(table)
      .select(['uid','type','attr']).where('uid','=',values.uid).forUpdate().executeTakeFirst();
    const patternRows=await trx.selectFrom(table).select(['uid','title'])
      .where('type','=','pattern').orderBy('uid','asc').execute();
    const patternByTitle=new Map();
    for(const pattern of patternRows){
      const key=norm(pattern.title);
      if(key&&!patternByTitle.has(key))patternByTitle.set(key,pattern);
    }
    const assigned=new Set();
    const patternUids=[];
    for(const word of words){
      const key=norm(word);
      let pattern=patternByTitle.get(key);
      if(!pattern){
        let inserted=null;
        for(let attempt=0;attempt<32&&!inserted;attempt++){
          const uid=allocateAnchorUid(assigned);
          assigned.add(uid);
          inserted=await trx.insertInto(table).values({uid,type:'pattern',title:word,
            description:'',attr:'{}'}).onConflict(oc=>oc.column('uid').doNothing())
            .returning('uid').executeTakeFirst();
        }
        if(!inserted)fail('Cannot allocate unique Pattern UID',409);
        pattern={uid:inserted.uid,title:word};
        patternByTitle.set(key,pattern);
      }
      patternUids.push(pattern.uid);
    }
    let parent;
    if(mode==='create'){
      if(old)fail('Keyword UID is already in use',409);
      const groupId=String(values.parentUid||'');
      if(!UID.test(groupId))fail('Invalid parent Group UID');
      parent=await trx.selectFrom(table).select(['uid','type','attr'])
        .where('uid','=',groupId).where('type','=','group').forUpdate().executeTakeFirst();
      if(!parent)fail('Unknown parent Group',404);
      await trx.insertInto(table).values({uid:values.uid,type:'item',
        title:asNodeText(values.name),description:values.desc,
        attr:JSON.stringify({uid:patternUids})}).execute();
      await trx.updateTable(table).set({attr:JSON.stringify({
        ...removeLegacyKeywordHitCache(attr(parent)),uid:[...new Set([...children(parent),values.uid])]
      })}).where('uid','=',parent.uid).where('type','=','group').execute();
    }else{
      if(old?.type!=='item')fail('Keyword Item not found',404);
      parent=await findContainingGroup(trx,scope,values.uid);
      await trx.updateTable(table).set({
        title:asNodeText(values.name),description:values.desc,
        attr:JSON.stringify(cleanItemAttr(old,patternUids))
      }).where('uid','=',values.uid).where('type','=','item').execute();
    }
    const classUid=await classContainingGroup(trx,scope,parent.uid);
    await invalidateKeywordTreeClass(trx,scope,classUid);
    return {uid:values.uid,classUid,created:0,linked:0};
  });
}

export async function deleteKeywordItem(db,scope,itemUid,{authorizeTransaction=()=>{}}={}){
  checkScope(scope);if(!UID.test(String(itemUid||'')))fail('Invalid Item UID');
  return db.transaction().execute(async trx=>{
    await authorizeTransaction(trx);
    const scopeLock=await trx.selectFrom(configName(scope)).select('id')
      .where('id','=',scope).forUpdate().executeTakeFirst();
    if(!scopeLock)fail('Keyword Scope not configured',404);
    const table=anchorName(scope);
    const item=await trx.selectFrom(table).select(['uid','type','attr'])
      .where('uid','=',itemUid).forUpdate().executeTakeFirst();
    if(item?.type!=='item')fail('Keyword Item missing',404);
    const parent=await findContainingGroup(trx,scope,itemUid);
    const classUid=await classContainingGroup(trx,scope,parent.uid);
    await trx.updateTable(table).set({attr:JSON.stringify({
      ...removeLegacyKeywordHitCache(attr(parent)),uid:children(parent).filter(uid=>uid!==itemUid)
    })}).where('uid','=',parent.uid).execute();
    await trx.deleteFrom(table).where('uid','=',itemUid).where('type','=','item').execute();
    // Pattern anchors have their own lifetime. They may be linked from many
    // Items/classes and remain valid vocabulary even after one Item is removed.
    await invalidateKeywordTreeClass(trx,scope,classUid);
    return {uid:itemUid,removed:0};
  });
}
// Class sharing is one read-modify-write transaction, not a page SELECT
// followed by a separate HTTP UPDATE that could overwrite a newer setting.
export async function setKeywordClassShare(db,scope,classUid,enabled,{
  authorizeTransaction=()=>{}
}={}){
  checkScope(scope);checkClass(classUid);
  if(typeof enabled!=='boolean')fail('Invalid Keyword sharing choice');
  return db.transaction().execute(async trx=>{
    await authorizeTransaction(trx);
    const current=await trx.selectFrom(configName(scope))
      .select('keyword_meta').where('id','=',scope)
      .forUpdate().executeTakeFirst();
    if(!current)fail('Keyword Scope config missing',404);
    const metadata=attr({attr:current.keyword_meta})||{};
    const keyword_meta={...metadata,
      class_shares:{...(metadata.class_shares||{}),[classUid]:enabled}};
    const result=await trx.updateTable(configName(scope))
      .set({keyword_meta:JSON.stringify(keyword_meta)})
      .where('id','=',scope).executeTakeFirst();
    if(Number(result?.numUpdatedRows||0)!==1)
      fail('Keyword sharing update did not complete',409);
    return {keyword_meta};
  });
}

