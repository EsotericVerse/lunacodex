import {buildKeywordSearchPatterns,keywordPatternItemMetrics} from './search-pattern.mjs';
import {createKeywordUidDocumentClassifier} from '../model/keyword-uid-analysis.mjs';
import {keywordScanText} from './content-filter.mjs';
import {compileKeywordLiteralMatcher} from './literal-matcher.mjs';

const UID=/^[A-Za-z0-9]{8}$/;
const keyOf=value=>String(value??'').normalize('NFKC').trim().toLocaleLowerCase('zh-Hant');
const isoMillis=value=>{
  const millis=Date.parse(String(value??''));
  return Number.isFinite(millis)?millis:null;
};
// Dynamic page sizing: react to how long a page actually took to classify,
// not a fixed row count. The target is a roughly steady amount of CPU time
// per page, same spirit as discovery-queue.mjs's byte-based adaptation, just
// measuring elapsed ms here instead of payload bytes (this reader never
// leaves the server, so wire size is not the cost that matters).
// No upper cap: page size is left to grow as far as measured performance
// allows. Only the lower floor (MIN_PAGE_ROWS) and the per-step doubling
// cap below protect against whiplash; there is no fixed ceiling above that.
const MIN_PAGE_ROWS=1000,MAX_PAGE_ROWS=Infinity,TARGET_PAGE_MS=800;
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));

// Exactly one stored word row per Scope + normalized literal. The existing
// keyword_meta JSON stores the last *completed scan* per word, separate from
// loc_search_pattern.update_time (changed UID set). Galaxy.UpdateTime is the
// article's import/edit clock. No extra physical column or Class-specific index.
//
// A Scope's full article table rarely fits inside one HTTP request's CPU/time
// budget. `resume` lets a caller hand back exactly what a prior, checkpointed
// call of this same function produced (see `onCheckpoint` below) so this call
// continues from that exact in-memory state instead of starting over. This is
// deliberately NOT the same thing as `existingPatterns`/`patternScans`, which
// describe the last *completed* scan and are used only to decide which words
// still need to be rechecked for the current article. A resumed call's
// per-word postings-so-far simply replace that baseline wherever the resume
// state has an entry, because they already incorporate every delete/add this
// in-progress attempt has made.
export async function analyzeIncrementalKeywordPatterns({
  scopeId,classUid,treeRows,items,existingPatterns=[],patternScans={},
  minChars=0,exceptionWords=[],pageSize=1000,expectedCount=null,readMetadataPage,readContent,
  writePatterns,finalize,onProgress=()=>{},startedAt=new Date().toISOString(),
  resume=null,onCheckpoint=null,timeBudgetMs=null,now=()=>Date.now()
}={}){
  if(!Array.isArray(existingPatterns)||!patternScans||typeof patternScans!=='object'||
     Array.isArray(patternScans)||!Array.isArray(exceptionWords)||
     exceptionWords.some(word=>typeof word!=='string')||
     !Number.isSafeInteger(pageSize)||pageSize<1||
     typeof readMetadataPage!=='function'||typeof readContent!=='function'||
     typeof writePatterns!=='function'||typeof finalize!=='function'||
     resume!==null&&(typeof resume!=='object'||Array.isArray(resume)||
       !('cursor' in resume)||
       !Number.isSafeInteger(resume.scanned)||resume.scanned<0||
       !Number.isSafeInteger(resume.parsed)||resume.parsed<0||
       !Number.isSafeInteger(resume.reused)||resume.reused<0||
       !resume.patternSets||typeof resume.patternSets!=='object'||
       Array.isArray(resume.patternSets)||
       !Array.isArray(resume.checked)||resume.checked.length!==resume.scanned||
       resume.checked.some(uid=>typeof uid!=='string'||!UID.test(uid))||
       // Older checkpoints predate this field; absent just means "resume at
       // the caller's starting pageSize", not an invalid checkpoint.
       'currentPageSize' in resume&&(!Number.isSafeInteger(resume.currentPageSize)||
         resume.currentPageSize<1))||
     onCheckpoint!==null&&typeof onCheckpoint!=='function'||
     timeBudgetMs!==null&&(!Number.isFinite(timeBudgetMs)||timeBudgetMs<=0))
    throw new TypeError('Invalid incremental Keyword analysis adapters');
  if(isoMillis(startedAt)===null)throw new Error('Invalid analysis start time');
  const invocationStart=now();
  // PatternAnchor is the canonical ZModel word-level entry. The Item graph
  // provides rule/ownership verification only, never an alternate word index.
  const expected=buildKeywordSearchPatterns(scopeId,items,[]);
  const expectedKeys=new Set(expected.map(row=>keyOf(row.pattern)));
  const words=existingPatterns.map(row=>({
    uid:String(row.uid||''),scopeid:scopeId,pattern:String(row.pattern||''),
    count:0,uid_list:[]
  })).sort((a,b)=>a.pattern.localeCompare(b.pattern));
  if(words.some(row=>!UID.test(row.uid))||
     new Set(words.map(row=>row.uid)).size!==words.length)
    throw new Error('Invalid or duplicated Pattern UID');
  if(expectedKeys.size!==words.length||
    words.some(row=>!expectedKeys.has(keyOf(row.pattern))))
    throw new Error('Pattern UID index does not match the selected Keyword Class');
  const oldByKey=new Map();
  for(const row of existingPatterns){
    const k=keyOf(row?.pattern);
    if(!k||oldByKey.has(k)||!Array.isArray(row?.uid_list)||
       row.uid_list.some(uid=>!UID.test(uid))||
       new Set(row.uid_list).size!==row.uid_list.length||
       Number(row.count)!==row.uid_list.length)
      throw new Error('Invalid or duplicated stored Keyword pattern');
    oldByKey.set(k,row);
  }
  // A resumed call's own postings-so-far override the completed-scan baseline
  // wherever it has an entry for that word; a word it never touched keeps the
  // ordinary baseline (seeding `sets` identically to a fresh, non-resumed call).
  if(resume){
    const resumeKeys=new Set(Object.keys(resume.patternSets));
    if(resumeKeys.size!==words.length||words.some(row=>!resumeKeys.has(keyOf(row.pattern))))
      throw new Error('Keyword analysis resume state does not match the selected Class; restart required');
  }
  const sets=new Map(),scanMs=new Map(),wordNames=new Map();
  for(const row of words){
    const k=keyOf(row.pattern),old=oldByKey.get(k);
    if(resume){
      const partial=resume.patternSets[k];
      if(!Array.isArray(partial)||partial.some(uid=>!UID.test(String(uid))))
        throw new Error('Invalid Keyword analysis resume postings');
      sets.set(k,new Set(partial));
    }else sets.set(k,new Set(old?.uid_list||[]));
    wordNames.set(k,row.pattern);
    // Existing UID lists without a known successful scan are not trusted.
    const completed=old?isoMillis(patternScans[k]):null;
    scanMs.set(k,completed);
  }
  // `checked` must track every UID seen across the WHOLE attempt (including
  // earlier, already-checkpointed invocations), not just this call's own
  // pages: it is the final filter that drops a deleted article's stale
  // posting (see the `uid_list` filter at completion below). Seeding it from
  // `resume.checked` keeps that filter correct after a resume; its length is
  // already verified above to equal `resume.scanned`, so duplicates there
  // would be a sign of corrupt resume state, not a silent truncation here.
  const checked=new Set(resume?resume.checked:[]),compiledByWords=new Map();
  if(resume&&checked.size!==resume.checked.length)
    throw new Error('Invalid Keyword analysis resume state: duplicate checked UID');
  const skipMatcher=compileKeywordLiteralMatcher(exceptionWords
    .map(keyOf).filter(Boolean));
  // A completed word scan is an UpdateTime lower bound. Most unchanged
  // documents can bypass the per-word loop entirely without touching content.
  let earliestComplete=Infinity;
  for(const completed of scanMs.values()){
    if(completed===null){earliestComplete=null;break;}
    earliestComplete=Math.min(earliestComplete,completed);
  }
  // `cursor` is opaque to this function: whatever `readMetadataPage` hands
  // back as `nextCursor`, checkpointed and passed straight back on the next
  // call. This file has no idea it is (date, uid) underneath — only the
  // caller wiring up `readMetadataPage` (sql-service.mjs) knows that shape.
  // A plain row-count offset would be wrong here: the reader is a keyset
  // cursor, not an OFFSET-style page number.
  let cursor=resume?resume.cursor:null,scanned=resume?resume.scanned:0,
    parsed=resume?resume.parsed:0,reused=resume?resume.reused:0;
  // Carry the page size a resumed scan had already grown to into this round,
  // instead of restarting the doubling ramp-up from the floor every single
  // HTTP round. Without this, a scan that needs many rounds never spends
  // long enough at a large page size to finish in few-enough rounds, and
  // checkpoints end up far more frequent (and far smaller) than necessary.
  let currentPageSize=clamp(resume?.currentPageSize??pageSize,MIN_PAGE_ROWS,MAX_PAGE_ROWS);
  // Shared by the per-page write below and the final write at completion:
  // the live uid_list for every word, as of whatever `sets`/`checked` state
  // exists right now. Safe to call mid-scan - `checked` only grows, so an
  // uid this call filters out for not being checked yet simply reappears
  // once a later page does check it.
  const buildPatterns=()=>words.map(row=>{
    const k=keyOf(row.pattern);
    const uid_list=[...sets.get(k)].filter(uid=>checked.has(uid)).sort();
    return {...row,count:uid_list.length,uid_list};
  });
  const checkpointNow=async()=>{
    const patternSets=Object.fromEntries([...sets].map(([k,set])=>[k,[...set]]));
    await onCheckpoint({cursor,scanned,parsed,reused,patternSets,checked:[...checked],
      currentPageSize});
  };
  // Writing to the live Anchor table opens its own DB connection
  // (storeScopePatternMatches's own transaction) separate from the
  // metadata/content reads above. Flushing on every SQL page ties that
  // connection-open rate to the READ page size - which is sized for read
  // throughput, not for how many articles were actually small/large. A run
  // of many small articles pages through fast (small content, many pages
  // per round) and would otherwise open one write-connection per page in
  // quick succession; a few huge articles can land in one page and still
  // only need one write. So the write is paced by accumulated characters
  // actually scanned - the real "stream volume" - not by page count: pull
  // content, scan it (no DB connection needed while classifying), and only
  // reconnect to write back once enough volume has piled up.
  // Kept conservative on purpose: a bigger number means fewer connection
  // opens but a bigger single write transaction (and more work resting
  // unwritten if a later page in the same round throws). Pool headroom is
  // the thing actually at risk here, so this errs toward smaller/safer
  // rather than toward minimizing connection count.
  const PATTERN_WRITE_FLUSH_CHARS=500_000;
  let pendingChars=0;
  const flushPatterns=async()=>{
    if(!pendingChars)return;
    await writePatterns({classUid,items,patterns:buildPatterns()});
    pendingChars=0;
  };
  for(;;){
    const pageStart=now();
    const read=await readMetadataPage({cursor,limit:currentPageSize});
    if(!read||typeof read!=='object'||!Array.isArray(read.rows)||
       read.rows.length>currentPageSize||!('nextCursor' in read))
      throw new Error('Invalid Galaxy metadata page');
    const page=read.rows;
    if(!page.length)break;
    cursor=read.nextCursor;
    const affected=new Map(),contentUids=[];
    for(const row of page){
      const uid=String(row?.uid||'');
      if(!UID.test(uid)||checked.has(uid))throw new Error('Invalid/duplicate Galaxy UID');
      checked.add(uid);
      const updated=isoMillis(row.UpdateTime);
      // An absent/invalid update time cannot justify skipping a previously
      // indexed UID. The next run must also treat it as requiring inspection.
      if(updated!==null&&earliestComplete!==null&&updated<earliestComplete){
        reused++;
        continue;
      }
      const wordsToCheck=[];
      for(const [k,completed] of scanMs)
        if(completed===null||updated===null||updated>=completed)
          wordsToCheck.push(k);
      if(!wordsToCheck.length){reused++;continue;}
      affected.set(uid,{wordsToCheck,eligible:row.keyword===true});
      if(row.keyword!==false)contentUids.push(uid);
    }
    const bodies=new Map();
    // Content-batch size follows the same dynamic page size as the metadata
    // page itself (no separate fixed ceiling): a hardcoded small batch here
    // would force extra DB round-trips per page regardless of how large
    // currentPageSize has already grown, undoing that growth.
    for(let i=0;i<contentUids.length;i+=currentPageSize){
      const batch=contentUids.slice(i,i+currentPageSize);
      const rows=await readContent(batch);
      if(!Array.isArray(rows)||rows.length!==batch.length||
         rows.some(row=>!UID.test(String(row?.uid||''))||
           !batch.includes(row.uid)||bodies.has(row.uid)))
        throw new Error('Galaxy content read incomplete; no patterns committed');
      for(const row of rows)bodies.set(row.uid,row);
    }
    // Word-specific cutoffs mean that an old document containing a newly
    // introduced word must NOT cause any old word to be reparsed.
    const partitions=new Map();
    for(const [uid,work] of affected){
      for(const k of work.wordsToCheck)sets.get(k).delete(uid);
      if(!work.eligible)continue;
      const body=bodies.get(uid);
      if(!body||body.keyword!==true)continue;
      // Read Galaxy once, then use a temporary scan projection. The DB's
      // HTML, title, date, site, place and media fields are never rewritten.
      const scan_text=keywordScanText(body);
      if(skipMatcher.contains(keyOf(scan_text)))continue;
      let visible=0;
      for(const char of scan_text)
        if(!/\s/u.test(char)&&++visible>minChars)break;
      if(visible<=minChars)continue;
      const signature=JSON.stringify(work.wordsToCheck);
      if(!partitions.has(signature))partitions.set(signature,[]);
      partitions.get(signature).push({...body,scan_text});
    }
    for(const [signature,docs] of partitions){
      const allowed=new Set(JSON.parse(signature));
      let classify=compiledByWords.get(signature);
      if(!classify){
        classify=createKeywordUidDocumentClassifier(treeRows,classUid,{
          collectKeywordTerms:true,selectedTerms:allowed
        });
        compiledByWords.set(signature,classify);
      }
      const result=classify(docs);
      for(const row of result.classifications||[]){
        if(!bodies.has(row.uid))throw new Error('Unknown classified Galaxy article');
        for(const word of row.matched_terms||[]){
          const k=keyOf(word);
          if(!allowed.has(k)||!sets.has(k))throw new Error('Unexpected Keyword result');
          sets.get(k).add(row.uid);
        }
      }
      parsed+=docs.length;
      pendingChars+=docs.reduce((sum,doc)=>sum+doc.scan_text.length,0);
    }
    scanned+=page.length;
    onProgress({phase:'reading',completed:scanned,parsed,reused});
    // Flush once enough characters have actually been scanned, not once per
    // page - see the comment on PATTERN_WRITE_FLUSH_CHARS above.
    // storeScopePatternMatches is idempotent (diffs uid_list before
    // writing), so the final write at completion repeating this is harmless.
    if(pendingChars>=PATTERN_WRITE_FLUSH_CHARS)await flushPatterns();
    // React to how long this page actually took, not a fixed row count.
    // Capped to 2x change per page so one unusually heavy/light page cannot
    // whiplash the next request size.
    const pageMs=Math.max(1,now()-pageStart);
    const wanted=Math.round(currentPageSize*TARGET_PAGE_MS/pageMs);
    currentPageSize=clamp(wanted,MIN_PAGE_ROWS,
      Math.min(MAX_PAGE_ROWS,currentPageSize*2));
    // Checked every page, not batched: Date.now() itself costs nothing, and
    // batching this by page count (as "check every N pages" once did) is
    // unsafe here - at the target page time alone, a few dozen pages can
    // already add up to multiples of the whole time budget, so a check that
    // only runs every N pages can arrive well after Cloudflare has already
    // killed the request. The actually expensive step, writing a checkpoint,
    // still only ever runs once, right here, when the condition trips.
    if(onCheckpoint&&timeBudgetMs!==null&&now()-invocationStart>timeBudgetMs*0.8){
      // Flush whatever volume has piled up before giving the connection
      // back, rather than letting it sit unwritten until a later round.
      await flushPatterns();
      await checkpointNow();
      return {incomplete:true,cursor,scanned,parsed,reused};
    }
  }
  if(expectedCount!==null&&scanned!==expectedCount)
    throw new Error('Galaxy metadata COUNT changed during analysis; no Keyword patterns written');
  // Deletions do not emit UpdateTime: a lightweight metadata scan still
  // detects and removes their stale UIDs without loading any full article.
  const patterns=buildPatterns();
  const summary=keywordPatternItemMetrics(items,patterns);
  const progress=Object.fromEntries(wordNames.keys().map(k=>[k,startedAt]));
  const stats={
    classUid,analyzedDocuments:scanned,parsedDocuments:parsed,reusedDocuments:reused,
    matchedDocuments:summary.document_count,
    itemMatches:summary.items.reduce((sum,item)=>sum+item.document_count,0),
    occurrences:summary.total_hits,
    groupCount:new Set(items.map(item=>item.group_uid)).size,itemCount:items.length,
    patternScans:progress
  };
  // Only the change writer touches loc_search_pattern; it preserves the
  // word's update_time unless its UID set differs.
  await writePatterns({classUid,items,patterns});
  await finalize(stats);
  onProgress({phase:'completed',completed:scanned,parsed,reused});
  return stats;
}
