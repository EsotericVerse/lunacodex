// Fixed-purpose native Kysely Keyword service. Runs within the existing LOC
// Pages application, using the server-only database profile. Never exposes
// arbitrary SQL, a connection string, or a general SQL Gateway endpoint.
import {parseRuneKeywordRuleSentence} from './model/rune-keyword-rules.mjs';
import {buildKeywordSearchPatterns,keywordPatternItemMetrics,keywordPatternDailySummary} from './keyword-search-pattern.mjs';
import {keywordClassCatalog} from './keyword-tree.mjs';
import {analyzeIncrementalKeywordPatterns} from './keyword-incremental.mjs';
import {createIndexedDateKeywordReader} from './keyword-article-reader.mjs';
import {completeKeywordClass,invalidateKeywordClass} from './keyword-class-state.mjs';
import {scopeDatabaseUid,readScopePatternRows,storeScopePatternMatches,ensureScopePatternLibrary} from './keyword-anchor-index.mjs';

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
  return {root,groups:ordered,items:words};
}

async function indexRows(db,scope){
  return readScopePatternRows(db,scope,await scopeDatabaseUid(db,scope));
}

async function matchingArticleMetadata(db,scope,patterns,{start='',end='',source='',places=null}={}){
  if([start,end].some(value=>value&&!DATE.test(value))||
     start&&end&&start>end||source.length>120)
    fail('Invalid Keyword statistics date or source');
  const ids=[...new Set(patterns.flatMap(row=>row.uid_list||[]))];
  const out=[];
  for(let i=0;i<ids.length;i+=500){
    let query=db.selectFrom(galaxyName(scope))
      .select(['uid','date']).where('uid','in',ids.slice(i,i+500))
      .where('keyword','=',true).where('date','is not',null);
    if(start)query=query.where('date','>=',start);
    if(end)query=query.where('date','<=',end);
    if(source)query=query.where('site','=',source);
    if(Array.isArray(places)&&places.length)
      query=query.where('place_id','in',places);
    out.push(...await query.execute());
  }
  return out;
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
  owner=false,start='',end='',source=''
}={}){
  checkScope(scope);checkClass(classUid);
  const cfg=await configuration(db,scope);
  if(!owner&&!shared(cfg,classUid))fail('Keyword Class not published',403);
  const tree=await classTree(db,scope,classUid);
  const patterns=await indexRows(db,scope);
  let permitted=null,daily=[];
  if(start||end||source){
    const matching=await matchingArticleMetadata(db,scope,patterns,{start,end,source});
    permitted=new Set(matching.map(row=>String(row.uid)));
    daily=keywordPatternDailySummary(tree.items,patterns,matching);
  }
  const indexed=keywordPatternItemMetrics(tree.items,patterns,{articleUids:permitted});
  return {
    class_uid:classUid,class_name:String(tree.root.title||''),
    completedAt:String(cfg.keyword_meta?.by_class?.[classUid]?.completedAt||''),
    keywordMinChars:Math.max(0,Number(cfg.keyword_min_chars??32)),
    keywordMinDocuments:Math.max(0,Number(cfg.keyword_min_documents??100)),
    groups:tree.groups.map(group=>{
      const own=indexed.items.filter(item=>item.group_uid===group.uid);
      const hits=own.reduce((sum,item)=>sum+item.hit_count,0);
      return {uid:group.uid,name:String(group.title||''),hit_count:hits,
        document_count:Number(indexed.group_document_counts?.[group.uid])||0,
        ratio:indexed.total_hits?100*hits/indexed.total_hits:0};
    }),
    ...indexed,daily
  };
}

export async function readKeywordCatalog(db,scope,classUid,{owner=false}={}){
  const stats=await readKeywordStatistics(db,scope,classUid,{owner});
  const tree=await classTree(db,scope,classUid);
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
  const itemUids=tree.items.map(item=>item.uid);
  const itemRows=itemUids.length?await db.selectFrom(anchor)
    .select(['uid','type','title','description','attr'])
    .where('uid','in',itemUids).where('type','=','item').execute():[];
  const itemByUid=new Map(itemRows.map(row=>[row.uid,row]));
  return {class_uid:classUid,rows:[
    model(tree.root),...tree.groups.map(model),
    ...tree.items.map(item=>model(itemByUid.get(item.uid))).filter(Boolean)
  ]};
}

export async function readKeywordDaily(db,scope,classUid,{
  owner=false,start='',end='',source='',places=null
}={}){
  checkScope(scope);checkClass(classUid);
  const cfg=await configuration(db,scope);
  if(!owner&&!shared(cfg,classUid))fail('Keyword Class not published',403);
  const tree=await classTree(db,scope,classUid);
  const patterns=await indexRows(db,scope);
  const articles=await matchingArticleMetadata(db,scope,patterns,{start,end,source,places});
  return keywordPatternDailySummary(tree.items,patterns,articles);
}

export async function suggestKeywordPatterns(db,scopeIds=[],query='',{
  ownerScopes=new Set()
}={}){
  if(!Array.isArray(scopeIds)||scopeIds.length<1||scopeIds.length>50||
     scopeIds.some(scope=>!SCOPE.test(String(scope||'')))||
     typeof query!=='string'||query.length>120)
    fail('Invalid Keyword suggestion request');
  const prefix=norm(query);
  if(!prefix)return [];
  const matches=new Map();
  for(const scope of new Set(scopeIds)){
    const owner=ownerScopes.has(scope);
    let visible=null;
    if(!owner){
      const cfg=await configuration(db,scope);
      const sharedClasses=Object.entries(cfg.keyword_meta?.class_shares||{})
        .filter(([,enabled])=>enabled===true).map(([id])=>id);
      if(!sharedClasses.length)continue;
      visible=new Set();
      for(const classUid of sharedClasses){
        if(!UID.test(classUid))continue;
        const tree=await classTree(db,scope,classUid);
        for(const item of tree.items)
          for(const term of terms(item))visible.add(term);
      }
    }
    const rows=(await indexRows(db,scope))
      .filter(row=>norm(row.pattern).startsWith(prefix))
      .sort((a,b)=>b.count-a.count||a.pattern.localeCompare(b.pattern)).slice(0,2000);
    for(const row of rows){
      const key=norm(row.pattern);
      if(visible&&!visible.has(key))continue;
      const record=matches.get(key)||{pattern:String(row.pattern),count:0};
      record.count+=Number(row.count)||0;
      matches.set(key,record);
    }
  }
  return [...matches.values()].sort((a,b)=>b.count-a.count||
    a.pattern.localeCompare(b.pattern)).slice(0,10);
}

async function persistPatterns(trx,scope,classUid,patterns,stats){
  // The Pattern rows and their Item UID edges are committed in the same
  // transaction as class completion. Article bodies never enter loc_anchor.
  const dbUid=await scopeDatabaseUid(trx,scope);
  await storeScopePatternMatches(trx,scope,dbUid,patterns);
  const now=new Date().toISOString();
  const cfg=await configuration(trx,scope);
  const record={class_uid:classUid,matchedDocuments:stats.matchedDocuments,
    analyzedDocuments:stats.analyzedDocuments,parsedDocuments:stats.parsedDocuments,
    reusedDocuments:stats.reusedDocuments,itemMatches:stats.itemMatches,
    occurrences:stats.occurrences};
  const merged=completeKeywordClass(cfg.keyword_meta,classUid,record,now);
  const metadata={...merged,pattern_scans:{
    ...(merged.pattern_scans||{}),...stats.patternScans
  }};
  await trx.updateTable(configName(scope))
    .set({keyword_meta:JSON.stringify(metadata),staticstime:null,updated_at:now})
    .where('id','=',scope).execute();
}

export async function analyzeKeywordScope(db,scope,classUid,{
  authorizeTransaction=()=>{},startedAt=new Date().toISOString()
}={}){
  checkScope(scope);checkClass(classUid);
  const cfg=await configuration(db,scope);
  const anchor=anchorName(scope);
  const nativeRows=await db.selectFrom(anchor)
    .select(['uid','type','title','description','attr'])
    .where('type','in',['category','class','group','item']).execute();
  const treeRows=nativeRows.map(row=>({
    uid:row.uid,type:row.type,name:String(row.title||''),
    desc:String(row.description||''),
    lists:row.type==='item'
      ?(Array.isArray(attr(row).keyword)?attr(row).keyword:[]):children(row),
    uid_lists:[]
  }));
  const {catalog}=keywordClassCatalog(treeRows,classUid);
  const existingPatterns=await indexRows(db,scope);
  const total=await db.selectFrom(galaxyName(scope))
    .select(eb=>eb.fn.count('uid').as('n')).executeTakeFirst();
  const expectedCount=Number(total?.n??0);
  if(!Number.isSafeInteger(expectedCount)||expectedCount<0)
    fail('Galaxy count out of range');
  const cols=['uid','date','createtime','UpdateTime','keyword'];
  const maximumRows=10000;
  const reader=createIndexedDateKeywordReader({
    maximumRows,
    readDatePage:async({after,limit})=>{
      let q=db.selectFrom(galaxyName(scope)).select(cols)
        .where('date','is not',null).orderBy('date','asc').limit(limit);
      if(after!==null)q=q.where('date','>',after);
      return await q.execute();
    },
    readDatePeers:async({date,maximumRows})=>{
      const q=db.selectFrom(galaxyName(scope)).where('date','=',date);
      const [rows,total]=await Promise.all([
        q.select(cols).limit(maximumRows).execute(),
        q.select(eb=>eb.fn.count('uid').as('n')).executeTakeFirst()
      ]);
      return {rows,count:Number(total?.n??0)};
    },
    readUndated:async({maximumRows})=>{
      const q=db.selectFrom(galaxyName(scope)).where('date','is',null);
      const [rows,total]=await Promise.all([
        q.select(cols).limit(maximumRows).execute(),
        q.select(eb=>eb.fn.count('uid').as('n')).executeTakeFirst()
      ]);
      return {rows,count:Number(total?.n??0)};
    }
  });
  let pending=null;
  const result=await analyzeIncrementalKeywordPatterns({
    scopeId:scope,classUid,treeRows,items:catalog,
    existingPatterns,patternScans:cfg.keyword_meta?.pattern_scans||{},
    expectedCount,minChars:Math.max(0,Number(cfg.keyword_min_chars)||0),
    startedAt,pageSize:1000,readMetadataPage:reader,
    readContent:async uids=>{
      if(!uids.length)return [];
      return db.selectFrom(galaxyName(scope))
        .select(['uid','content','keyword'])
        .where('uid','in',uids).execute();
    },
    writePatterns:async ({patterns})=>{pending=patterns;},
    finalize:async stats=>{
      if(!pending)fail('Keyword patterns were not produced');
      await db.transaction().execute(async trx=>{
        await authorizeTransaction(trx);
        await persistPatterns(trx,scope,classUid,pending,stats);
      });
    }
  });
  const {patternScans,...safe}=result;
  return {...safe,indexedWords:pending?.length||0};
}

// Explicit reset clears a selected Class's completion and its words ONLY when
// not shared by another Class. No Keyword Anchor.attr totals are written.
export async function resetKeywordScope(db,scope,classUid,{
  authorizeTransaction=()=>{}
}={}){
  checkScope(scope);checkClass(classUid);
  return db.transaction().execute(async trx=>{
    await authorizeTransaction(trx);
    const existing=await configuration(trx,scope);
    const classes=await trx.selectFrom(anchorName(scope))
      .select('uid').where('type','=','class').execute();
    if(!classes.some(row=>row.uid===classUid))
      fail('Unknown Keyword Class',404);
    const own=new Set(),other=new Set();
    for(const row of classes){
      const tree=await classTree(trx,scope,row.uid);
      const set=row.uid===classUid?own:other;
      for(const item of tree.items)
        for(const word of terms(item))set.add(word);
    }
    const unique=[...own].filter(word=>!other.has(word));
    const dbUid=await scopeDatabaseUid(trx,scope);
    const stored=await readScopePatternRows(trx,scope,dbUid);
    const reset=stored.filter(row=>unique.includes(norm(row.pattern))&&row.uid_list.length);
    for(let i=0;i<reset.length;i+=100){
      const updated=reset.slice(i,i+100).map(row=>{
        const posting={...row.attr,[dbUid]:[]};
        const total=Object.values(posting).reduce((count,ids)=>
          count+(Array.isArray(ids)?new Set(ids).size:0),0);
        return {uid:row.uid,type:'pattern',attr:JSON.stringify(posting),num:total};
      });
      await trx.insertInto(anchorName(scope)).values(updated)
        .onConflict(oc=>oc.column('uid').doUpdateSet(eb=>({
          attr:eb.ref('excluded.attr'),num:eb.ref('excluded.num')
        }))).execute();
    }
    const meta=invalidateKeywordClass(existing.keyword_meta,classUid);
    const scans={...(meta.pattern_scans||{})};
    for(const word of unique)delete scans[word];
    const updated={...meta,pattern_scans:scans};
    await trx.updateTable(configName(scope))
      .set({keyword_meta:JSON.stringify(updated),staticstime:null,
        updated_at:new Date().toISOString()}).where('id','=',scope).execute();
    return {count:reset.length,retainedShared:own.size-unique.length};
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
// the actual postings are exclusively on Pattern Anchor rows.
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
        ...attr(parent),uid:[...new Set([...children(parent),values.uid])]
      })}).where('uid','=',parent.uid).where('type','=','group').execute();
    }else{
      if(old?.type!=='item')fail('Keyword Item not found',404);
      parent=await findContainingGroup(trx,scope,values.uid);
      await trx.updateTable(table).set({
        title:asNodeText(values.name),description:values.desc,
        attr:JSON.stringify({...attr(old),keyword:words})
      }).where('uid','=',values.uid).where('type','=','item').execute();
    }
    const dbUid=await scopeDatabaseUid(trx,scope);
    const linked=await ensureScopePatternLibrary(trx,scope,dbUid);
    const classUid=await classContainingGroup(trx,scope,parent.uid);
    await invalidateKeywordTreeClass(trx,scope,classUid);
    return {uid:values.uid,classUid,created:linked.created,linked:linked.linked};
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
      ...attr(parent),uid:children(parent).filter(uid=>uid!==itemUid)
    })}).where('uid','=',parent.uid).execute();
    await trx.deleteFrom(table).where('uid','=',itemUid).where('type','=','item').execute();
    const dbUid=await scopeDatabaseUid(trx,scope);
    const linked=await ensureScopePatternLibrary(trx,scope,dbUid);
    await invalidateKeywordTreeClass(trx,scope,classUid);
    return {uid:itemUid,removed:linked.removed};
  });
}
export async function synchronizeKeywordLibrary(db,scope,{
  authorizeTransaction=()=>{}
}={}){
  checkScope(scope);
  return db.transaction().execute(async trx=>{
    await authorizeTransaction(trx);
    const dbUid=await scopeDatabaseUid(trx,scope);
    return ensureScopePatternLibrary(trx,scope,dbUid);
  });
}
