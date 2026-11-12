import {buildKeywordSearchPatterns,keywordPatternItemMetrics} from './keyword-search-pattern.mjs';
import {createKeywordUidDocumentClassifier} from './model/keyword-uid-analysis.mjs';

const UID=/^[A-Za-z0-9]{8}$/;
const keyOf=value=>String(value??'').normalize('NFKC').trim().toLocaleLowerCase('zh-Hant');
const isoMillis=value=>{
  const millis=Date.parse(String(value??''));
  return Number.isFinite(millis)?millis:null;
};

// Exactly one stored word row per Scope + normalized literal. The existing
// keyword_meta JSON stores the last *completed scan* per word, separate from
// loc_search_pattern.update_time (changed UID set). Galaxy.UpdateTime is the
// article's import/edit clock. No extra physical column or Class-specific index.
export async function analyzeIncrementalKeywordPatterns({
  scopeId,classUid,treeRows,items,existingPatterns=[],patternScans={},
  minChars=0,pageSize=1000,expectedCount=null,readMetadataPage,readContent,
  writePatterns,finalize,onProgress=()=>{},startedAt=new Date().toISOString()
}={}){
  if(!Array.isArray(existingPatterns)||!patternScans||typeof patternScans!=='object'||
     Array.isArray(patternScans)||!Number.isSafeInteger(pageSize)||pageSize<1||
     typeof readMetadataPage!=='function'||typeof readContent!=='function'||
     typeof writePatterns!=='function'||typeof finalize!=='function')
    throw new TypeError('Invalid incremental Keyword analysis adapters');
  if(isoMillis(startedAt)===null)throw new Error('Invalid analysis start time');
  const words=buildKeywordSearchPatterns(scopeId,items,[]);
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
  const sets=new Map(),scanMs=new Map(),wordNames=new Map();
  for(const row of words){
    const k=keyOf(row.pattern),old=oldByKey.get(k);
    sets.set(k,new Set(old?.uid_list||[]));
    wordNames.set(k,row.pattern);
    // Existing UID lists without a known successful scan are not trusted.
    const completed=old?isoMillis(patternScans[k]):null;
    scanMs.set(k,completed);
  }
  const checked=new Set(),compiledByWords=new Map();
  // A completed word scan is an UpdateTime lower bound. Most unchanged
  // documents can bypass the per-word loop entirely without touching content.
  let earliestComplete=Infinity;
  for(const completed of scanMs.values()){
    if(completed===null){earliestComplete=null;break;}
    earliestComplete=Math.min(earliestComplete,completed);
  }
  let offset=0,scanned=0,parsed=0,reused=0;
  for(;;){
    const page=await readMetadataPage({offset,limit:pageSize});
    if(!Array.isArray(page)||page.length>pageSize)
      throw new Error('Invalid Galaxy metadata page');
    if(!page.length)break;
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
    for(let i=0;i<contentUids.length;i+=500){
      const batch=contentUids.slice(i,i+500);
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
      let visible=0;
      for(const char of String(body.content??''))
        if(!/\s/u.test(char)&&++visible>minChars)break;
      if(visible<=minChars)continue;
      const signature=JSON.stringify(work.wordsToCheck);
      if(!partitions.has(signature))partitions.set(signature,[]);
      partitions.get(signature).push(body);
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
    }
    scanned+=page.length;offset+=page.length;
    onProgress({phase:'reading',completed:scanned,parsed,reused});
  }
  if(expectedCount!==null&&scanned!==expectedCount)
    throw new Error('Galaxy metadata COUNT changed during analysis; no Keyword patterns written');
  // Deletions do not emit UpdateTime: a lightweight metadata scan still
  // detects and removes their stale UIDs without loading any full article.
  const patterns=words.map(row=>{
    const k=keyOf(row.pattern);
    const uid_list=[...sets.get(k)].filter(uid=>checked.has(uid)).sort();
    return {...row,count:uid_list.length,uid_list};
  });
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
