import {HEAVY_INITIAL_ROWS} from '../query/query-batch-size.mjs';
import {sql} from 'kysely';
// LOC native Keywords: Item owns literal and TO/AND/NAME/NOR rules;
// Anchor.num is UID-list cardinality; Item/Group.attr.total is the existing
// cached article hit count. Class completion remains in Scope keyword_meta.
import {parseRuneKeywordRuleSentence} from '../model/rune-keyword-rules.mjs';
import {analyzeItemKeywordCounts,readItemKeywordProjection,
  itemKeywordStatistics,itemScope} from './item-count-analysis.mjs';
import {createIndexedDateKeywordReader} from './article-reader.mjs';
import {completeKeywordClass,invalidateKeywordClass,
  readKeywordScanProgress,writeKeywordScanProgress,
  keywordClassEpoch,bumpKeywordClassEpoch} from './class-state.mjs';
import {galaxyReadColumns} from '../../../packages/zenstack/galaxy-read-models.mjs';

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
const terms=item=>[String(item.item_name||''),...(Array.isArray(item.keywords)?item.keywords:[])
  .filter(term=>typeof term==='string'&&!parseRuneKeywordRuleSentence(term).rules.length)]
  .map(norm).filter(Boolean);
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
const KEYWORD_CHECKPOINT_ROWS=8192;
const KEYWORD_REQUEST_BUDGET_MS=15000;

const removeLegacyKeywordHitCache=value=>{
  const {uidlists,articles,hits,total,...links}=value||{};
  // Keep Item.attr.uid: these are Pattern Anchor IDs, not article postings.
  return links;
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
  const words=ordered.flatMap(group=>children(group).map(uid=>{
    const item=byItem.get(uid);
    return {uid,item_name:String(item.title||''),group_uid:group.uid,
      keywords:Array.isArray(attr(item).keyword)?attr(item).keyword:[]};
  }));
  return {root,groups:ordered,items:words,itemRows:items};
}

const validateKeywordFilters=({start='',end='',source=''})=>{
  if([start,end].some(v=>v&&!DATE.test(v))||start&&end&&start>end||
    typeof source!=='string'||source.length>120)fail('Invalid Keyword filters');
};

// Fixed, owner-only Keyword editor snapshot. No browser-selected SQL relation,
// projection, filter or unrestricted SELECT. Each page and its Scope settings
// share one read-only Transaction; the physical Anchor model is unchanged.
export async function readKeywordWorkspace(trx,scope,{cursor='',limit=250}={}){
  checkScope(scope);
  if(cursor&&!UID.test(cursor))fail('Invalid Keyword editor cursor',400);
  if(!Number.isInteger(limit)||limit<1||limit>250)
    fail('Invalid Keyword editor page size',400);
  let q=trx.selectFrom(anchorName(scope))
    .select(['uid','type','title','description','attr'])
    .where('type','in',['category','class','group','item']);
  if(cursor)q=q.where('uid','>',cursor);
  const rows=await q.orderBy('uid','asc').limit(limit+1).execute();
  const page=rows.slice(0,limit);
  const config=await trx.selectFrom(configName(scope))
    .select(['current_keyword_class_uid','keyword_min_chars',
      'keyword_min_documents','keyword_class_share_enabled',
      'keyword_meta','staticstime'])
    .where('id','=',scope).executeTakeFirst();
  if(!config)fail('Keyword Scope not configured',404);
  return {rows:page,config,nextCursor:rows.length>limit
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
  let counts=receipt,daily=[];
  if(start||end||source){
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
      groupCounts:Object.fromEntries(tree.groups.map(row=>[row.uid,byUid.get(row.uid)||0]))
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
      Array.isArray(attr(node).keyword)?attr(node).keyword:[],
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
  for(const scope of new Set(scopeIds)){
    if(!ownerScopes.has(scope))continue;
    // A literal autocomplete lookup on Pattern.title. No language translation,
    // English/Chinese mapping, Galaxy content scan, or article UID index.
    const rows=await db.selectFrom(anchorName(scope))
      .select(['uid','title']).where('type','=','pattern').execute();
    for(const row of rows){
      const literal=String(row.title||'').trim(),key=norm(literal);
      if(!key.includes(prefix)||!literal)continue;
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

// The native Keyword service runs on LOC's trusted PostgreSQL Kysely target.
// One typed SQL statement updates only attr.total, preserving every other
// Anchor attribute, hierarchy UID list and its independently derived num.
// This is not a second keyword index or a public SQL request surface.
// Pure and testable: distinct physical Anchor PKs, not occurrences of the
// same Item under several Keyword Groups, determine UPDATE row cardinality.
export function planKeywordTotalWrites(updates){
  if(!Array.isArray(updates))fail('Invalid Keyword aggregate counts');
  const byUid=new Map();
  for(const row of updates){
    if(!UID.test(String(row?.uid||''))||
       !Number.isSafeInteger(row.total)||row.total<0)
      fail('Invalid Keyword aggregate counts');
    if(byUid.has(row.uid)&&byUid.get(row.uid)!==row.total)
      fail('Conflicting Keyword counts for one Item UID',409);
    byUid.set(row.uid,row.total);
  }
  return [...byUid].map(([uid,total])=>({uid,total}));
}
async function writeKeywordTotals(trx,scope,updates){
  const physicalUpdates=planKeywordTotalWrites(updates);
  if(!physicalUpdates.length)return 0;
  const payload=JSON.stringify(physicalUpdates);
  const table=sql.ref(anchorName(scope));
  const result=await sql`
    update ${table} as a
    set attr=jsonb_set(coalesce(a.attr,'{}'::jsonb),
      '{total}',to_jsonb(incoming.total),true)
    from jsonb_to_recordset(${payload}::jsonb) as incoming(uid text,total bigint)
    where a.uid=incoming.uid::char(8) and a.type in ('item','group')
  `.execute(trx);
  const affected=Number(result.numAffectedRows??0);
  if(affected!==physicalUpdates.length)fail('Keyword aggregate targets changed',409);
  return affected;
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
      JSON.stringify(tree.groups.map(x=>x.uid)))
    fail('Item rules changed during analysis; rerun',409);
  const updates=[
    ...current.items.map(item=>({uid:item.uid,
      total:Math.max(0,Number(counts.itemCounts?.[item.uid])||0)})),
    ...current.groups.map(group=>({uid:group.uid,
      total:Math.max(0,Number(counts.groupCounts?.[group.uid])||0)}))
  ];
  // The metadata row was locked before this statement. The typed UPDATE
  // touches only Item/Group total and never overwrites concurrent attr edits.
  await writeKeywordTotals(trx,scope,updates);
  const now=new Date().toISOString();
  const {pattern_index_version,pattern_scans,scan_progress,...rest}=old;
  const {itemCounts,groupCounts,...smallCounts}=counts;
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
  attemptId=''
}={}){
  checkScope(scope);checkClass(classUid);
  const cfg=await configuration(db,scope),tree=await classTree(db,scope,classUid);
  const meta=attr({attr:cfg.keyword_meta});
  const expectedEpoch=keywordClassEpoch(meta,classUid);
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
  const result=await analyzeItemKeywordCounts({
    ...itemScope(tree),expectedCount,readMetadataPage:reader,
    minChars:Math.max(0,Number(cfg.keyword_min_chars)||0),
    pageSize:HEAVY_INITIAL_ROWS,resume,
    maxRowsPerRun:KEYWORD_ROWS_PER_REQUEST,
    minRowsPerRun:KEYWORD_MIN_ROWS_PER_REQUEST,
    checkpointRows:KEYWORD_CHECKPOINT_ROWS,
    timeBudgetMs:KEYWORD_REQUEST_BUDGET_MS,
    onCheckpoint:async progress=>{
      await db.transaction().execute(async trx=>{
        await authorizeTransaction(trx);
        await persistScanProgress(trx,scope,classUid,progress,expectedEpoch);
      });
      onProgress({phase:'checkpoint',total:expectedCount,
        completed:progress.scanned,parsed:progress.parsed,
        percent:Math.min(99,Math.round(expectedCount?
          progress.scanned/expectedCount*100:0)),
        label:'分析進度已保存，可接續下一批'});
    },
    onProgress:({phase,completed=0,parsed=0})=>onProgress({
      phase,total:expectedCount,completed,parsed,
      percent:phase==='completed'?100:Math.min(99,
        Math.round(expectedCount?completed/expectedCount*100:0)),
      label:phase==='completed'?'分析已完成':'逐批分析 Item 規則'
    }),
    finalize:async counts=>db.transaction().execute(async trx=>{
      await authorizeTransaction(trx);
      await persistItemCounts(trx,scope,classUid,tree,counts,attemptId,expectedCount,expectedEpoch);
    })
  });
  if(result.incomplete)return {incomplete:true,total:expectedCount,
    completed:result.scanned,parsed:result.parsed,reused:0};
  return {...result,reusedDocuments:0,indexedWords:0};
}

// Fixed-purpose read-only completion check for a particular client operation.
// No article contents, Pattern UIDs, or SQL authority leave this endpoint.
export async function readKeywordAnalysisCompletion(db,scope,classUid,attemptId){
  checkScope(scope);checkClass(classUid);
  if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(String(attemptId||'')))
    fail('Invalid Keyword analysis attempt',400);
  const cfg=await configuration(db,scope);
  const meta=attr({attr:cfg.keyword_meta});
  const record=meta.by_class?.[classUid];
  if(!record||record.attemptId!==attemptId||!record.completedAt)
    return {completed:false};
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

// Reset selected Class and its Item/Group aggregate counters only.
export async function resetKeywordScope(db,scope,classUid,{
  authorizeTransaction=()=>{}
}={}){
  checkScope(scope);checkClass(classUid);
  return db.transaction().execute(async trx=>{
    await authorizeTransaction(trx);
    const cfg=await trx.selectFrom(configName(scope))
      .select('keyword_meta').where('id','=',scope).forUpdate().executeTakeFirst();
    if(!cfg)fail('Keyword Scope not configured',404);
    const tree=await classTree(trx,scope,classUid);
    const ids=[...tree.groups.map(x=>x.uid),...tree.items.map(x=>x.uid)];
    // Reset only article count snapshots: preserve structural UID cardinality.
    // Same row-locked metadata transaction as completion, but one SQL
    // statement clears all cached counts without changing Anchor.num.
    const changed=await writeKeywordTotals(trx,scope,ids.map(uid=>({uid,total:0})));
    const previous=attr({attr:cfg.keyword_meta});
    const meta=bumpKeywordClassEpoch(
      writeKeywordScanProgress(invalidateKeywordClass(previous,classUid),classUid,null),
      classUid);
    await trx.updateTable(configName(scope)).set({
      keyword_meta:JSON.stringify(meta),staticstime:null,
      updated_at:new Date().toISOString()
    }).where('id','=',scope).execute();
    return {count:changed,retainedShared:0};
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
async function invalidateKeywordTreeClass(trx,scope,classUid){
  const cfg=await configuration(trx,scope);
  const metadata=invalidateKeywordClass(cfg.keyword_meta,classUid);
  await trx.updateTable(configName(scope))
    .set({keyword_meta:JSON.stringify(metadata),staticstime:null,
      updated_at:new Date().toISOString()}).where('id','=',scope).execute();
}

// The Item editor's single authorized transaction saves its word list,
// maintains Group membership and reconciles all Pattern UID references.
// Legacy Item.keyword remains as temporary input to old style readers;
// Pattern vocabulary nodes hold no Galaxy article UID postings.
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
    const table=anchorName(scope),old=await trx.selectFrom(table)
      .select(['uid','type','attr']).where('uid','=',values.uid).forUpdate().executeTakeFirst();
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
        attr:JSON.stringify({keyword:words})}).execute();
      await trx.updateTable(table).set({attr:JSON.stringify({
        ...removeLegacyKeywordHitCache(attr(parent)),uid:[...new Set([...children(parent),values.uid])]
      })}).where('uid','=',parent.uid).where('type','=','group').execute();
    }else{
      if(old?.type!=='item')fail('Keyword Item not found',404);
      parent=await findContainingGroup(trx,scope,values.uid);
      await trx.updateTable(table).set({
        title:asNodeText(values.name),description:values.desc,
        attr:JSON.stringify({...removeLegacyKeywordHitCache(attr(old)),keyword:words})
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
    const table=anchorName(scope);
    const item=await trx.selectFrom(table).select(['uid','type'])
      .where('uid','=',itemUid).forUpdate().executeTakeFirst();
    if(item?.type!=='item')fail('Keyword Item missing',404);
    const parent=await findContainingGroup(trx,scope,itemUid);
    const classUid=await classContainingGroup(trx,scope,parent.uid);
    await trx.updateTable(table).set({attr:JSON.stringify({
      ...removeLegacyKeywordHitCache(attr(parent)),uid:children(parent).filter(uid=>uid!==itemUid)
    })}).where('uid','=',parent.uid).execute();
    await trx.deleteFrom(table).where('uid','=',itemUid).where('type','=','item').execute();
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

