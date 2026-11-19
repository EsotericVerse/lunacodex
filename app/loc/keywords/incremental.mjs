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
  const continuing=resume?.scanMode==='literal_full_v1';
  if(continuing&&(!resume.patternSets||typeof resume.patternSets!=='object'||
    !Array.isArray(resume.checked)||!Number.isSafeInteger(resume.scanned)||
    resume.scanned<0||resume.checked.length!==resume.scanned))
    throw new Error('Invalid Keyword full-scan checkpoint');
  const sets=new Map();
  for(const key of literals.keys()){
    const prior=continuing?resume.patternSets[key]:[];
    if(!Array.isArray(prior)||prior.some(uid=>typeof uid!=='string'||!UID.test(uid))||
      new Set(prior).size!==prior.length)
      throw new Error('Invalid Keyword full-scan postings checkpoint');
    sets.set(key,new Set(prior));
  }
  if(continuing&&Object.keys(resume.patternSets).length!==sets.size)
    throw new Error('Keyword Pattern catalog changed during scan; restart analysis');
  const checked=new Set(continuing?resume.checked:[]);
  if(continuing&&checked.size!==resume.checked.length)
    throw new Error('Duplicate Galaxy UID in Keyword scan checkpoint');

  let scanned=continuing?resume.scanned:0,parsed=continuing?resume.parsed:0;
  let cursor=continuing?resume.cursor:null;
  const invocationStart=now();
  // A small first page is a calibration sample, not a processing ceiling.
  // Subsequent sizes follow measured per-row cost and the upper quartile
  // of recent pages, not an owner-supplied fixed Regex/Immer percentage.
  let currentPageSize=continuing&&Number.isSafeInteger(resume.currentPageSize)&&
    resume.currentPageSize>0?resume.currentPageSize:Math.min(pageSize,128);
  const rowMs=[];
  if(continuing&&resume.lastPageMs>0&&resume.currentPageSize>0)
    rowMs.push(resume.lastPageMs/resume.currentPageSize);
  let lastPageMs=continuing?resume.lastPageMs||null:null;
  async function checkpoint(){
    if(!onCheckpoint)return;
    const patternSets=Object.fromEntries([...sets].map(([key,ids])=>[key,[...ids]]));
    await onCheckpoint({
      scanMode:'literal_full_v1',cursor,scanned,parsed,reused:0,
      patternSets,checked:[...checked],currentPageSize,lastPageMs
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
    const ids=[];
    for(const row of read.rows){
      const uid=String(row?.uid||'');
      if(!UID.test(uid)||checked.has(uid))
        throw new Error('Invalid or duplicate Galaxy UID during full scan');
      checked.add(uid);
      // Explicit keyword:false is the article's published feature flag,
      // not a heuristic about whether its contents are worth analyzing.
      if(row.keyword!==false)ids.push(uid);
    }

    if(ids.length){
      const bodies=await readContent(ids);
      const wanted=new Set(ids),seen=new Set();
      if(!Array.isArray(bodies)||bodies.length!==ids.length)
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

  if(expectedCount!==null&&scanned!==expectedCount)
    throw new Error('Galaxy count changed during full Keyword scan; no Pattern index committed');

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
