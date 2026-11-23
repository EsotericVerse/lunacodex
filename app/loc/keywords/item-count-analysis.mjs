import {createTextAdaptiveRows} from '../query/query-batch-size.mjs';
// Item-driven LOC keyword classification. No Pattern posting or persisted article UID list.
import {createKeywordDocumentClassifier} from '../model/keyword-engine.mjs';
import {compileKeywordLiteralMatcher} from './literal-matcher.mjs';
import {keywordScanText} from './content-filter.mjs';
import {parseRuneKeywordRuleSentence} from '../model/rune-keyword-rules.mjs';
const norm=x=>String(x??'').normalize('NFKC').trim().toLocaleLowerCase('zh-Hant');
const count=x=>Math.max(0,Number(x)||0);
// Full-text Item scans already handle 4096 Galaxy rows per indexed SELECT.
// The old 1024-row cap made every 4096/8192 checkpoint issue 4-8 SQL reads.
// Keep the proven 4096-row floor; a compact page can grow to 8192, while the
// per-request cursor and checkpoints still bound total work. The character
// budget influences growth, never forces repeated 1024-row SQL requests.
export const KEYWORD_SCAN_START_ROWS=4096;
export const KEYWORD_SCAN_MAX_ROWS=8192;
export const KEYWORD_SCAN_START_RATE=1024;
export const KEYWORD_SCAN_MAX_RATE=8192;
export const KEYWORD_SCAN_RATE_STEP=1024;
export const KEYWORD_SCAN_CHECKPOINT_ROWS=4096;

// Processing throughput and persisted SQL progress are distinct controls.
// The next one-second window grows by only 1024 if the previous target was
// actually completed at that speed. Checkpoints never reset this controller.
export function createKeywordScanRate({
  initial=KEYWORD_SCAN_START_RATE,
  maximum=KEYWORD_SCAN_MAX_RATE,step=KEYWORD_SCAN_RATE_STEP,
  now=()=>Date.now(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
}={}){
  if(!Number.isSafeInteger(initial)||initial<1||
      !Number.isSafeInteger(maximum)||maximum<initial||
      !Number.isSafeInteger(step)||step<1||
      typeof now!=='function'||typeof sleep!=='function')
    throw new TypeError('Invalid Keyword scan rate');
  let target=initial,started=now(),reserved=0,completed=0;
  return {
    get target(){return target;},
    async take(remaining){
      if(!Number.isSafeInteger(remaining)||remaining<1)
        throw new TypeError('Invalid Keyword scan work count');
      for(;;){
        const time=now(),elapsed=Math.max(0,time-started);
        if(elapsed>=1000){
          // An over-budget CPU/SQL window does NOT qualify for a promotion.
          // An incomplete window never demotes the carried speed target.
          if(completed>=target&&elapsed<=1250)
            target=Math.min(maximum,target+step);
          started=time;reserved=0;completed=0;
        }
        const available=target-reserved;
        if(available>0){
          const granted=Math.min(remaining,available);
          reserved+=granted;
          return granted;
        }
        await sleep(Math.max(1,1000-elapsed));
      }
    },
    complete(rows){
      if(!Number.isSafeInteger(rows)||rows<1||completed+rows>reserved)
        throw new TypeError('Invalid Keyword scan completion');
      completed+=rows;
    }
  };
}
const KEYWORD_SCAN_PAGE_OPTIONS=Object.freeze({
  maximum:KEYWORD_SCAN_MAX_ROWS,targetChars:32*1024*1024
});
const object=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:{};
const mapOf=(keys,values)=>Object.fromEntries(keys.map(k=>[k,count(object(values)[k])]));
const dayOf=x=>x instanceof Date?x.toISOString().slice(0,10):String(x||'').slice(0,10);
export const itemLiterals=item=>[item.item_name,...(Array.isArray(item.keywords)?item.keywords:[])
  .filter(x=>typeof x==='string'&&!parseRuneKeywordRuleSentence(x).rules.length)]
  .map(x=>String(x||'').trim()).filter(Boolean);
export const itemScope=tree=>({items:tree.items,groups:tree.groups.map(x=>({uid:x.uid,title:x.title}))});
export function itemKeywordSuggestions(items=[],query=''){
  const prefix=norm(query),map=new Map();
  for(const item of items)for(const label of itemLiterals(item)){
    const key=norm(label);
    if(key.startsWith(prefix)&&!map.has(key))map.set(key,{pattern:label,count:0});
  }
  return [...map.values()].sort((a,b)=>a.pattern.localeCompare(b.pattern));
}
export function createItemCountAccumulator(items=[],groups=[],resume=null,{minChars=0,patterns=[]}={}){
  // Pattern is an existing typed Anchor UID, never a synthetic word string.
  // One Pattern can be referenced by several Items, but receives one count
  // for each literal occurrence in an eligible Galaxy article.
  const patternByUid=new Map();
  for(const pattern of patterns){
    const uid=String(pattern?.uid||''),word=norm(pattern?.title);
    if(!/^[A-Za-z0-9]{8}$/.test(uid)||!word)
      throw new TypeError('Invalid Keyword Pattern UID/title');
    if(patternByUid.has(uid)&&patternByUid.get(uid)!==word)
      throw new TypeError('Conflicting Keyword Pattern UID titles');
    patternByUid.set(uid,word);
  }
  const patternTerms=[...new Set(patternByUid.values())];
  const patternMatcher=patternTerms.length?compileKeywordLiteralMatcher(patternTerms):null;
  const uidsByTerm=new Map();
  for(const [uid,word] of patternByUid){
    if(!uidsByTerm.has(word))uidsByTerm.set(word,[]);
    uidsByTerm.get(word).push(uid);
  }
  const catalog=items.map((item,i)=>({
    item_no:i+1,item_name:item.item_name,class_group:item.group_uid,
    keywords:item.keywords,order_no:i+1,class_enable:true
  }));
  const classify=createKeywordDocumentClassifier(catalog);
  const itemIds=items.map(x=>x.uid),groupIds=groups.map(x=>x.uid);
  const fingerprint=JSON.stringify({catalog,groupIds,minChars,
    patterns:[...patternByUid]});
  const saved=resume?.scanMode==='item_count_v1'&&resume.fingerprint===fingerprint
    ?resume:null;
  const state={scanMode:'item_count_v1',fingerprint,
    scanned:count(saved?.scanned),parsed:count(saved?.parsed),
    matchedDocuments:count(saved?.matchedDocuments),
    itemMatches:count(saved?.itemMatches),occurrences:count(saved?.occurrences),
    itemCounts:mapOf(itemIds,saved?.itemCounts),itemDocuments:mapOf(itemIds,saved?.itemDocuments),
    groupCounts:mapOf(groupIds,saved?.groupCounts),
    groupDocuments:mapOf(groupIds,saved?.groupDocuments),
    patternCounts:mapOf([...patternByUid.keys()],saved?.patternCounts)};
  const byDay=new Map(),groupOrder=new Map(groupIds.map((uid,i)=>[uid,i]));
  const fallback=groups.find(g=>items.some(i=>i.group_uid===g.uid&&i.item_name==='德'))?.uid||'';
  function absorb(rows=[],callback=null){
    // The old path stripped/parses HTML twice per eligible article: once
    // for the min-length filter and again inside the Rune classifier.
    // Carry the same scan-only visible text through both operations without
    // changing persisted Galaxy content or the classification rules.
    const docs=[];
    for(const row of rows){
      if(row.keyword===false)continue;
      const scanText=typeof row?.scan_text==='string'
        ?row.scan_text:keywordScanText(row);
      if(Array.from(scanText.replace(/\s/gu,'')).length<=minChars)continue;
      docs.push({...row,scan_text:scanText});
    }
    if(!docs.length)return;
    const classifications=classify(docs).classifications||[];
    if(classifications.length!==docs.length)throw Error('Incomplete Item classifier result');
    for(let i=0;i<docs.length;i++){
      const doc=docs[i],result=classifications[i],hits=new Map();
      state.parsed++;
      if(patternMatcher){
        // Count literal occurrences using the same already-cleaned article
        // text as the Item classifier. No second Galaxy read, no UID postings.
        for(const [word,times] of patternMatcher.countMatches(norm(doc.scan_text)))
          for(const uid of uidsByTerm.get(word)||[])
            state.patternCounts[uid]+=times;
      }
      for(const hit of result.rune_counts||[]){
        const item=items[Number(hit.rune_id)-1];
        if(!item)throw Error('Unknown Item rule result');
        const times=count(hit.count);
        if(!times)continue;
        state.itemCounts[item.uid]+=times;
        state.itemDocuments[item.uid]++;
        state.itemMatches++;state.occurrences+=times;
        hits.set(item.uid,times);
      }
      if(hits.size)state.matchedDocuments++;
      const tied=(result.tied_groups||[]).filter(id=>groupOrder.has(id));
      let group=String(result.classification_group||'');
      if(tied.length>1)group=[...tied].sort((a,b)=>
        state.groupCounts[a]-state.groupCounts[b]||groupOrder.get(a)-groupOrder.get(b))[0];
      else if(tied.length===1)group=tied[0];
      else if(!groupOrder.has(group))group=fallback;
      if(hits.size&&groupOrder.has(group)){
        state.groupCounts[group]++;
        state.groupDocuments[group]++;
      }
      const day=dayOf(doc.date);
      if(/^\d{4}-\d{2}-\d{2}$/.test(day)&&hits.size){
        const bucket=byDay.get(day)||{documents:0,itemHits:{},itemDocs:{},groups:{}};
        bucket.documents++;
        for(const [uid,times] of hits){
          bucket.itemHits[uid]=(bucket.itemHits[uid]||0)+times;
          bucket.itemDocs[uid]=(bucket.itemDocs[uid]||0)+1;
        }
        if(groupOrder.has(group))bucket.groups[group]=(bucket.groups[group]||0)+1;
        byDay.set(day,bucket);
      }
      callback?.(doc,{hits,group,matched:Boolean(hits.size)});
    }
  }
  function totals(){return {
    analyzedDocuments:state.parsed,scannedDocuments:state.scanned,
    parsedDocuments:state.parsed,
    matchedDocuments:state.matchedDocuments,itemMatches:state.itemMatches,
    occurrences:state.occurrences,itemCounts:{...state.itemCounts},
    itemDocuments:{...state.itemDocuments},groupCounts:{...state.groupCounts},
    groupDocuments:{...state.groupDocuments},patternCounts:{...state.patternCounts}
  };}
  function daily(){
    const rows=[{kind:'eligible',item_key:null,group_uid:null,day:'',
      hit_count:state.matchedDocuments,document_count:state.matchedDocuments}];
    for(const item of items)rows.push({kind:'item',item_key:item.uid,group_uid:item.group_uid,
      day:'',hit_count:state.itemCounts[item.uid],
      document_count:state.itemDocuments[item.uid]});
    for(const [day,b] of [...byDay].sort((a,b)=>a[0].localeCompare(b[0]))){
      rows.push({kind:'keyword_all_day',item_key:null,group_uid:null,day,
        hit_count:b.documents,document_count:b.documents});
      for(const group of groups)if(b.groups[group.uid]){
        const n=b.groups[group.uid];
        rows.push({kind:'class_day',item_key:null,group_uid:group.uid,day,
          hit_count:n,document_count:n});
        rows.push({kind:'group_items_day',item_key:null,group_uid:group.uid,day,
          hit_count:n,document_count:n});
      }
      for(const item of items)if(b.itemDocs[item.uid])
        rows.push({kind:'item_day',item_key:item.uid,group_uid:item.group_uid,day,
          hit_count:b.itemHits[item.uid],document_count:b.itemDocs[item.uid]});
    }
    return rows;
  }
  return {state,fingerprint,absorb,totals,daily};
}
export async function analyzeItemKeywordCounts({items,groups,patterns=[],expectedCount,
  readMetadataPage,readContent,finalize,onCheckpoint=null,onProgress=()=>{},
  resume=null,pageSize=KEYWORD_SCAN_START_ROWS,timeBudgetMs=null,now=()=>Date.now(),minChars=0,
  maxRowsPerRun=null,minRowsPerRun=null,
  checkpointRows=KEYWORD_SCAN_CHECKPOINT_ROWS,
  paceRows=false,rateSleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  deferFinalization=false
}={}){
  const a=createItemCountAccumulator(items,groups,resume,{minChars,patterns});
  const valid=resume?.scanMode==='item_count_v1'&&resume.fingerprint===a.fingerprint&&
    Object.hasOwn(resume,'cursor');
  let cursor=valid?resume.cursor:null,scanned=valid?count(resume.scanned):0;
  const startedScanned=scanned,started=now();
  // A request cap is NOT a Scope data limit. A completed batch returns its
  // durable cursor and counts; the browser continues in a fresh request.
  const runLimit=Number.isSafeInteger(maxRowsPerRun)&&maxRowsPerRun>0
    ?maxRowsPerRun:null;
  const floorLimit=Number.isSafeInteger(minRowsPerRun)&&minRowsPerRun>0
    ?minRowsPerRun:null;
  if(floorLimit!==null&&(runLimit===null||floorLimit>=runLimit))
    throw new TypeError('Invalid Keyword adaptive batch bounds');
  if(onCheckpoint&&(!Number.isSafeInteger(checkpointRows)||checkpointRows<1))
    throw new TypeError('Invalid Keyword checkpoint interval');
  // 4096-row indexed SQL pages align durable checkpoints without dividing
  // the per-second processing budget into artificial 296-row fragments.
  const sizer=createTextAdaptiveRows({
    ...KEYWORD_SCAN_PAGE_OPTIONS,
    initial:pageSize,maximum:Math.min(KEYWORD_SCAN_START_ROWS,
      KEYWORD_SCAN_PAGE_OPTIONS.maximum),
    minimum:Math.min(pageSize,KEYWORD_SCAN_START_ROWS)
  });
  const pace=paceRows?createKeywordScanRate({
    initial:valid&&Number.isSafeInteger(resume?.targetRowsPerSecond)
      ?Math.max(KEYWORD_SCAN_START_RATE,
        Math.min(KEYWORD_SCAN_MAX_RATE,resume.targetRowsPerSecond))
      :KEYWORD_SCAN_START_RATE,
    now,sleep:rateSleep
  }):null;
  let lastCheckpoint=scanned,extended=false;
  // Measure actual completed scan throughput. The 1024 rows/second goal is
  // an acceptance metric, not a forced SQL LIMIT or an artificial throttle.
  const rate=()=>Math.round((scanned-startedScanned)*1000/
    Math.max(1,now()-started));
  const incomplete=(finalizePending=false)=>({
    incomplete:true,scanned,parsed:a.state.parsed,finalizePending,
    rowsPerSecond:rate(),targetRowsPerSecond:pace?.target??null
  });
  const checkpoint=async(finalizePending=false)=>{
    if(onCheckpoint&&(lastCheckpoint!==scanned||finalizePending)){
      await onCheckpoint({...a.state,cursor,
        ...(pace?{targetRowsPerSecond:pace.target}:{}),
        ...(finalizePending?{finalizePending:true}:{})});
      lastCheckpoint=scanned;
    }
  };
  const finish=async()=>{
    const result=a.totals();
    await finalize(result);
    onProgress({phase:'completed',completed:scanned,parsed:a.state.parsed,
      rowsPerSecond:rate(),targetRowsPerSecond:pace?.target??null});
    return result;
  };
  // A tail receipt includes all counters and the final cursor. Once it has
  // committed, a fresh request ONLY finalizes Item/Group totals and need
  // not fetch or classify any article again.
  if(valid&&resume?.finalizePending===true&&scanned===expectedCount)
    return finish();
  for(;;){
    const runCount=scanned-startedScanned;
    const remaining=runLimit===null?Infinity:runLimit-runCount;
    if(remaining<=0){
      await checkpoint();
      return incomplete();
    }
    // Stop exactly at the first 4096-row decision point. If throughput has
    // sufficient headroom, continue to 8192 without an unnecessary SQL write.
    const untilFloor=floorLimit!==null&&!extended
      ?Math.max(1,floorLimit-runCount):Infinity;
    const requested=Math.min(sizer.size,remaining,untilFloor);
    const page=await readMetadataPage({cursor,limit:requested});
    if(!page||!Array.isArray(page.rows)||page.rows.length>requested||
      !Object.hasOwn(page,'nextCursor'))throw Error('Invalid Item scan page');
    if(!page.rows.length)break;
    cursor=page.nextCursor;
    const candidates=page.rows.filter(row=>row.keyword!==false);
    const ids=candidates.map(row=>String(row.uid));
    let pageChars=0;
    if(ids.length){
      if(new Set(ids).size!==ids.length)
        throw Error('Duplicate Item scan article UID');
      // The native SQL Runtime can supply eligible article text in its
      // indexed (date, uid) page. Avoid a second WHERE uid IN (...) fetch.
      // Keep readContent as the exact fallback for callers with lean pages.
      let ordered=candidates;
      if(!candidates.every(row=>Object.hasOwn(row,'title')&&
          Object.hasOwn(row,'content'))){
        if(typeof readContent!=='function')
          throw Error('Item scan article content reader is missing');
        const docs=await readContent(ids);
        if(!Array.isArray(docs)||docs.length!==ids.length)
          throw Error('Incomplete Item scan article page');
        const byUid=new Map(docs.map(row=>[String(row.uid),row]));
        if(byUid.size!==ids.length||ids.some(id=>!byUid.has(id)))
          throw Error('Incomplete Item scan article page');
        ordered=ids.map(id=>byUid.get(id));
      }
      pageChars=ordered.reduce((sum,row)=>sum+
        String(row?.title??'').length+String(row?.content??'').length,0);
      if(pace){
        // The SQL page may contain 4096 rows, but CPU work starts at a
        // 1024 rows/sec budget and ramps gently up to 8192. A saved page
        // is not a new speed window; unused capacity carries straight on.
        for(let index=0;index<ordered.length;){
          const size=await pace.take(ordered.length-index);
          a.absorb(ordered.slice(index,index+size));
          pace.complete(size);
          index+=size;
        }
      }else a.absorb(ordered);
    }
    scanned+=page.rows.length;
    a.state.scanned=scanned;
    sizer.observe(page.rows.length,pageChars);
    // Short Scopes fit in one request. Avoid the intermediate SQL checkpoint
    // entirely when every article is already classified AND there is enough
    // time left for the final authorized write. A slow short Scope still
    // gets the durable final-tail receipt used by larger scans.
    //
    // The 4096 threshold is total Scope size, not the SQL page size,
    // processing-rate target, or a restriction on bigger Scopes.
    if(deferFinalization&&onCheckpoint&&expectedCount!==null&&
        scanned===expectedCount){
      const canFinalizeNow=expectedCount<=KEYWORD_SCAN_CHECKPOINT_ROWS&&
        startedScanned===0&&
        (timeBudgetMs===null||now()-started<=timeBudgetMs*0.5);
      onProgress({phase:'finalizing',completed:scanned,parsed:a.state.parsed,
        rowsPerSecond:rate(),targetRowsPerSecond:pace?.target??null});
      if(canFinalizeNow)return finish();
      // Large Scopes and slow short Scopes first persist the exact tail,
      // then a fresh request commits final counters without rescanning.
      await checkpoint(true);
      return incomplete(true);
    }
    const elapsed=now()-started;
    if(floorLimit!==null&&!extended&&scanned-startedScanned>=floorLimit){
      // Only one checkpoint per successful request: save at 4096 when the
      // remaining time cannot safely handle another 4096, otherwise at 8192.
      if(timeBudgetMs!==null&&elapsed*2>timeBudgetMs*0.65){
        await checkpoint();
        onProgress({phase:'reading',completed:scanned,parsed:a.state.parsed,
          rowsPerSecond:rate(),targetRowsPerSecond:pace?.target??null});
        return incomplete();
      }
      extended=true;
    }
    if(onCheckpoint&&scanned-lastCheckpoint>=checkpointRows)
      await checkpoint();
    onProgress({phase:'reading',completed:scanned,parsed:a.state.parsed,
      rowsPerSecond:rate(),targetRowsPerSecond:pace?.target??null});
    if(onCheckpoint&&(
      runLimit!==null&&scanned-startedScanned>=runLimit||
      timeBudgetMs!==null&&elapsed>=timeBudgetMs*0.65)){
      await checkpoint();
      return incomplete();
    }
  }
  if(expectedCount!==null&&scanned<expectedCount)
    throw Error('Item scan ended before all Galaxy rows');
  return finish();
}
export async function readItemKeywordProjection(db,scope,{items,groups,start='',end='',
  source='',places=null,owner=true,minChars=0,onRow=null}={}){
  const a=createItemCountAccumulator(items,groups,null,{minChars});
  let after='';
  const sizer=createTextAdaptiveRows({
    initial:KEYWORD_SCAN_START_ROWS,minimum:KEYWORD_SCAN_START_ROWS,
    ...KEYWORD_SCAN_PAGE_OPTIONS
  });
  for(;;){
    const requested=sizer.size;
    let q=db.selectFrom('silver.'+scope+'_galaxy')
      .select(['uid','title','content','keyword','date','site','place_id','createtime'])
      .orderBy('uid','asc').limit(requested);
    if(after)q=q.where('uid','>',after);
    if(start)q=q.where('date','>=',start);
    if(end)q=q.where('date','<=',end);
    if(source)q=q.where('site','=',source);
    if(Array.isArray(places)&&places.length)q=q.where('place_id','in',places);
    if(!owner)q=q.where('search','=',true);
    const rows=await q.execute();
    if(!rows.length)break;
    after=String(rows.at(-1).uid);
    a.state.scanned+=rows.length;a.absorb(rows,onRow);
    const chars=rows.reduce((sum,row)=>sum+
      String(row?.title??'').length+String(row?.content??'').length,0);
    sizer.observe(rows.length,chars);
    if(rows.length<requested)break;
  }
  return {totals:a.totals(),daily:a.daily()};
}
export function itemKeywordStatistics(items,groups,totals){
  const hits=items.reduce((sum,i)=>sum+count(totals.itemCounts?.[i.uid]),0);
  const itemRows=items.map(item=>{
    const n=count(totals.itemCounts?.[item.uid]);
    return {uid:item.uid,group_uid:item.group_uid,name:item.item_name,
      hit_count:n,document_count:count(totals.itemDocuments?.[item.uid]),
      ratio:hits?100*n/hits:0,words:itemLiterals(item).map(word=>({
        pattern:word,count:0,indexed:false,ratio:0}))};
  });
  const groupRows=groups.map(g=>{
    const n=itemRows.filter(i=>i.group_uid===g.uid).reduce((s,i)=>s+i.hit_count,0);
    return {uid:g.uid,name:String(g.title||''),hit_count:n,
      document_count:count(totals.groupDocuments?.[g.uid]),
      ratio:hits?100*n/hits:0};
  });
  return {groups:groupRows,items:itemRows,total_hits:hits,
    document_count:count(totals.matchedDocuments),
    group_document_counts:object(totals.groupDocuments),missing_patterns:[]};
}
