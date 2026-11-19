import {keywordScanText} from './content-filter.mjs';
import {compileKeywordLiteralMatcher} from './literal-matcher.mjs';

const UID=/^[A-Za-z0-9]{8}$/;
const keyOf=value=>String(value??'').normalize('NFKC').trim().toLocaleLowerCase('zh-Hant');
const TARGET_PAGE_MS=650;
const quantile=(ordered,fraction)=>ordered[Math.floor((ordered.length-1)*fraction)];

// Keep the existing caller contract during the full-scan cutover. A selected
// Class is only a completion/permission handle: it does NOT classify words or
// influence which Pattern literals match which Galaxy articles.
export async function analyzeIncrementalKeywordPatterns({
  scopeId,classUid,existingPatterns=[],pageSize=1000,expectedCount=null,
  readMetadataPage,readContent,writePatterns,finalize,onProgress=()=>{},
  resume=null,onCheckpoint=null,timeBudgetMs=null,now=()=>Date.now()
}={}){
  if(!Array.isArray(existingPatterns)||typeof readMetadataPage!=='function'||
    typeof readContent!=='function'||typeof writePatterns!=='function'||
    typeof finalize!=='function'||!Number.isSafeInteger(pageSize)||pageSize<1||
    onCheckpoint!==null&&typeof onCheckpoint!=='function'||
    timeBudgetMs!==null&&(!Number.isFinite(timeBudgetMs)||timeBudgetMs<=0))
    throw new TypeError('Invalid full-scan Keyword analysis adapters');

  const words=existingPatterns.map(row=>({
    uid:String(row.uid||''),scopeid:scopeId,pattern:String(row.pattern||'')
  }));
  const literals=new Map();
  for(const word of words){
    const key=keyOf(word.pattern);
    if(!UID.test(word.uid)||!key||literals.has(key))
      throw new Error('Invalid or duplicate Pattern UID/literal');
    literals.set(key,word.uid);
  }
  // One compiled literal matcher for the whole Scope, never a Class score,
  // user-preference weight, per-word regex scan, or content semantic model.
  const matcher=compileKeywordLiteralMatcher([...literals.keys()]);
  // Checkpoints from the former per-article incremental algorithm are not
  // compatible with an exact full-scan result and must not be resumed.
  // A concurrent Keyword editor save may legitimately change the Pattern
  // catalog while a checkpoint is parked. Discard only the obsolete partial
  // scan, then restart from the beginning with the current catalog. No stale
  // partial postings ever enter the live Pattern index.
  const resumeSets=resume?.patternSets;
  const continuing=resume?.scanMode==='literal_full_v2'&&
    resumeSets&&typeof resumeSets==='object'&&!Array.isArray(resumeSets)&&
    Number.isSafeInteger(resume.scanned)&&resume.scanned>=0&&
    Number.isSafeInteger(resume.parsed)&&resume.parsed>=0&&
    Object.keys(resumeSets).length===literals.size&&
    [...literals.keys()].every(key=>{
      const list=resumeSets[key];
      return Array.isArray(list)&&
        list.every(uid=>typeof uid==='string'&&UID.test(uid))&&
        new Set(list).size===list.length;
    });
  const sets=new Map([...literals.keys()].map(key=>[
    key,new Set(continuing?resumeSets[key]:[])
  ]));
  let scanned=continuing?resume.scanned:0,parsed=continuing?resume.parsed:0;
  let cursor=continuing?resume.cursor:null;
  const invocationStart=now();
  // A small first page is a calibration sample, not a processing ceiling.
  // Subsequent sizes follow measured per-row cost and the upper quartile
  // of recent pages, not an owner-supplied fixed Regex/Immer percentage.
  const carriedSize=continuing&&Number.isSafeInteger(resume.currentPageSize)&&
    resume.currentPageSize>0?resume.currentPageSize:Math.min(pageSize,128);
  const previousRowMs=continuing&&resume.lastPageMs>0&&resume.lastPageSize>0
    ?resume.lastPageMs/resume.lastPageSize:null;
  // Keep the calibrated read size, but derate it if its actual measured
  // latency would consume too much of a new request's time budget.
  let currentPageSize=previousRowMs!==null&&timeBudgetMs!==null
    ?Math.max(1,Math.min(carriedSize,Math.floor(timeBudgetMs*0.4/previousRowMs)))
    :carriedSize;
  const rowMs=[];
  if(previousRowMs!==null)rowMs.push(previousRowMs);
  let lastPageMs=continuing?resume.lastPageMs||null:null;
  let lastPageSize=continuing?resume.lastPageSize||null:null;
  async function checkpoint(){
    if(!onCheckpoint)return;
    const patternSets=Object.fromEntries([...sets].map(([key,ids])=>[key,[...ids]]));
    await onCheckpoint({
      scanMode:'literal_full_v2',cursor,scanned,parsed,reused:0,
      patternSets,currentPageSize,lastPageMs,lastPageSize
    });
  }

  for(;;){
    const started=now();
    const read=await readMetadataPage({cursor,limit:currentPageSize});
    if(!read||!Array.isArray(read.rows)||read.rows.length>currentPageSize||
      !Object.hasOwn(read,'nextCursor'))
      throw new Error('Invalid Galaxy metadata page');
    if(!read.rows.length)break;
    cursor=read.nextCursor;
    // A date may be scanned again on a retry. The postings below are Sets,
    // so reading an article UID again cannot double-count it.
    const ids=new Set();
    for(const row of read.rows){
      const uid=String(row?.uid||'');
      if(!UID.test(uid))throw new Error('Invalid Galaxy UID during full scan');
      // Explicit keyword:false is the article's published feature flag.
      if(row.keyword!==false)ids.add(uid);
    }

    if(ids.size){
      const bodies=await readContent([...ids]);
      const wanted=ids,seen=new Set();
      if(!Array.isArray(bodies)||bodies.length!==ids.size)
        throw new Error('Galaxy content read incomplete; no Pattern index committed');
      for(const body of bodies){
        const uid=String(body?.uid||'');
        if(!wanted.has(uid)||seen.has(uid))
          throw new Error('Galaxy content read duplicated or wrong UID');
        seen.add(uid);
        if(body.keyword===false)continue;
        const text=keyOf(keywordScanText(body));
        if(!text)continue;
        for(const literal of matcher.matched(text))sets.get(literal).add(uid);
        parsed++;
      }
    }
    scanned+=read.rows.length;
    onProgress({phase:'reading',completed:scanned,parsed,reused:0});

    const elapsed=Math.max(1,now()-started);
    lastPageMs=elapsed;
    lastPageSize=read.rows.length;
    rowMs.push(elapsed/read.rows.length);
    if(rowMs.length>11)rowMs.shift();
    const sorted=[...rowMs].sort((a,b)=>a-b);
    const upperQuartile=quantile(sorted,0.75);
    let wanted=Math.max(1,Math.round(TARGET_PAGE_MS/upperQuartile));
    if(timeBudgetMs!==null){
      const remaining=Math.max(1,timeBudgetMs-(now()-invocationStart));
      wanted=Math.min(wanted,Math.max(1,Math.floor(remaining*0.4/upperQuartile)));
    }
    currentPageSize=Math.max(1,Math.min(wanted,currentPageSize*2));
    if(onCheckpoint&&timeBudgetMs!==null&&
      now()-invocationStart>timeBudgetMs*0.65){
      // No partial Pattern/num publication. Only the resume bookmark is saved.
      await checkpoint();
      return {incomplete:true,cursor,scanned,parsed,reused:0};
    }
  }

  // A replayed date can count more read rows than distinct Galaxy UIDs.
  // Pattern postings deduplicate by UID, so only an under-read is suspicious.
  if(expectedCount!==null&&scanned<expectedCount)
    throw new Error('Galaxy scan ended before reaching the expected article count');

  // Exactly one count per unique Pattern UID, only after the complete scan.
  const patterns=words.map(word=>{
    const uid_list=[...sets.get(keyOf(word.pattern))].sort();
    return {...word,uid_list,count:uid_list.length};
  });
  const matchingArticles=new Set();
  for(const ids of sets.values())for(const uid of ids)matchingArticles.add(uid);
  const stats={
    classUid,analyzedDocuments:scanned,parsedDocuments:parsed,reusedDocuments:0,
    matchedDocuments:matchingArticles.size,
    occurrences:patterns.reduce((total,row)=>total+row.count,0),
    patternScans:{}
  };
  await writePatterns({classUid,patterns});
  await finalize(stats);
  onProgress({phase:'completed',completed:scanned,parsed,reused:0});
  return stats;
}
