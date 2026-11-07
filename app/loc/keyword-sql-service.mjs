// Fixed-purpose native Kysely Keyword service. Runs within the existing LOC
// Pages application, using the server-only database profile. Never exposes
// arbitrary SQL, a connection string, or a general SQL Gateway endpoint.
import {parseRuneKeywordRuleSentence} from './model/rune-keyword-rules.mjs';
import {buildKeywordSearchPatterns,keywordPatternItemMetrics,keywordPatternDailySummary} from './keyword-search-pattern.mjs';
import {keywordClassCatalog} from './keyword-tree.mjs';
import {analyzeIncrementalKeywordPatterns} from './keyword-incremental.mjs';
import {createIndexedDateKeywordReader} from './keyword-article-reader.mjs';
import {completeKeywordClass} from './keyword-class-state.mjs';

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

async function indexRows(db,scope,withTime=false){
  return db.selectFrom('silver.loc_search_pattern')
    .select(withTime?['pattern','count','uid_list','update_time']:
      ['pattern','count','uid_list'])
    .where('scopeid','=',scope).execute();
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
    const escaped=prefix.replace(/[\\%_]/gu,char=>'\\'+char);
    const rows=await db.selectFrom('silver.loc_search_pattern')
      .select(['pattern','count']).where('scopeid','=',scope)
      .where('pattern','ilike',escaped+'%')
      .orderBy('count','desc').limit(2000).execute();
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
  const rows=await indexRows(trx,scope,true);
  const old=new Map(rows.map(row=>[norm(row.pattern),row]));
  const active=new Set();
  const allItems=await trx.selectFrom(anchorName(scope))
    .select(['title','attr']).where('type','=','item').execute();
  for(const row of allItems)
    for(const term of terms({item_name:row.title,keywords:attr(row).keyword}))
      active.add(term);
  const seen=new Set(),changes=[],renamed=[];
  const now=new Date().toISOString();
  for(const row of patterns){
    const key=norm(row.pattern),previous=old.get(key);
    if(!key||!active.has(key)||seen.has(key)||!Array.isArray(row.uid_list)||
       row.uid_list.some(uid=>!UID.test(uid))||
       new Set(row.uid_list).size!==row.uid_list.length||
       row.count!==row.uid_list.length)fail('Invalid Keyword pattern write');
    seen.add(key);
    const sorted=[...row.uid_list].sort();
    const same=previous&&previous.uid_list.length===sorted.length&&
      [...previous.uid_list].sort().every((uid,i)=>uid===sorted[i]);
    if(previous?.pattern!==undefined&&previous.pattern!==row.pattern)
      renamed.push(previous.pattern);
    if(previous&&previous.pattern===row.pattern&&same)continue;
    changes.push({scopeid:scope,pattern:row.pattern,count:sorted.length,
      uid_list:sorted,update_time:same?previous.update_time:now});
  }
  const obsolete=rows.filter(row=>!active.has(norm(row.pattern)))
    .map(row=>row.pattern);
  const deleting=[...new Set([...renamed,...obsolete])];
  for(let i=0;i<deleting.length;i+=100){
    const batch=deleting.slice(i,i+100);
    if(batch.length)await trx.deleteFrom('silver.loc_search_pattern')
      .where('scopeid','=',scope).where('pattern','in',batch).execute();
  }
  for(let i=0;i<changes.length;i+=100){
    await trx.insertInto('silver.loc_search_pattern')
      .values(changes.slice(i,i+100))
      .onConflict(oc=>oc.columns(['scopeid','pattern']).doUpdateSet(eb=>({
        count:eb.ref('excluded.count'),uid_list:eb.ref('excluded.uid_list'),
        update_time:eb.ref('excluded.update_time')
      }))).execute();
  }
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
