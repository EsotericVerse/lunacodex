import {detectCountChangepoints} from './karaul-count-changepoints.mjs';
import {createNewKeywordDiscovery} from './keyword-discovery.mjs';

let discovery=null;
function changePoints(values){
  if(values.length<4)return [];
  try{return detectCountChangepoints(values)
    .filter(index=>Number.isInteger(index)&&index>0&&index<values.length);}
  catch{return [];}
}
function denseAndSparse(result){
  const months=result.monthCoverage||[];
  if(!months.length)return {...result,dense:null,sparse:null};
  const novelByMonth=new Map();
  for(const item of result.candidates){
    for(const [month,count] of item.months||[])
      novelByMonth.set(month,(novelByMonth.get(month)||0)+count);
  }
  // Analyze density *per article*, not raw writing volume. A busy month
  // should not count as a new-term burst solely because it has more posts.
  const rawHits=months.map(row=>novelByMonth.get(row.month)||0);
  const series=months.map((row,index)=>
    Math.round(rawHits[index]/Math.max(1,row.documents)*10));
  const changes=changePoints(series);
  const boundaries=[0,...changes,months.length];
  const segments=[];
  for(let i=0;i<boundaries.length-1;i++){
    const from=boundaries[i],to=boundaries[i+1];
    const source=months.slice(from,to);
    const documents=source.reduce((sum,x)=>sum+x.documents,0);
    const existingCovered=source.reduce((sum,x)=>sum+x.existingCovered,0);
    const novelHits=rawHits.slice(from,to).reduce((sum,x)=>sum+x,0);
    if(documents<=0)continue;
    segments.push({
      start:source[0].month,end:source.at(-1).month,
      documents,novelHits,existingCovered,
      novelPerArticle:novelHits/documents,
      existingRatio:existingCovered/documents,
      detectedByPelt:changes.length>0
    });
  }
  const byDense=[...segments].sort((a,b)=>b.novelPerArticle-a.novelPerArticle||b.documents-a.documents);
  const bySparse=[...segments].sort((a,b)=>a.novelPerArticle-b.novelPerArticle||b.documents-a.documents);
  const dense=byDense[0]||null;
  // Without a statistically detected boundary there are not two opposing
  // periods. Do not invent an "empty" side from the same segment.
  const sparse=segments.length>1?bySparse[0]:null;
  const overallExistingRatio=months.reduce((s,row)=>s+row.existingCovered,0)/
    Math.max(1,months.reduce((s,row)=>s+row.documents,0));
  if(dense){
    for(const item of result.candidates){
      item.denseDocuments=(item.months||[]).reduce((sum,[month,count])=>
        sum+(month>=dense.start&&month<=dense.end?count:0),0);
    }
    // New terms from the PELT-dense side rank first, but a constant,
    // long-running new word must never be excluded solely for no changepoint.
    result.candidates.sort((a,b)=>
      b.denseDocuments-a.denseDocuments||b.documents-a.documents
      ||b.occurrences-a.occurrences||a.word.localeCompare(b.word));
  }
  return {...result,dense,sparse,overallExistingRatio};
}
function annotateTrend(result){
  const months=result.monthCoverage||[];
  result=denseAndSparse(result);
  // Rank first and analyze only the 120 candidates retained in the result.
  // Avoid running PELT on the other 120 candidates that will be discarded.
  result.candidates=result.candidates.slice(0,120);
  // A high-publication month must not look like a keyword trend merely
  // because more articles were posted. Compare per-article rates.
  for(const item of result.candidates){
    const counts=new Map(item.months||[]);
    const series=months.map(row=>
      Math.round((counts.get(row.month)||0)/Math.max(1,row.documents)*10));
    item.trendChanges=changePoints(series).length;
    delete item.months;
  }
  delete result.monthCoverage;
  return result;
}
self.onmessage=event=>{
  const {type,rows,existingRows}=event.data||{};
  try{
    if(type==='start'){
      discovery=createNewKeywordDiscovery(existingRows);
      self.postMessage({type:'ready'});
    }else if(type==='batch'){
      if(!discovery)throw new Error('新關鍵詞掃描尚未初始化');
      self.postMessage({type:'progress',...discovery.consume(rows)});
    }else if(type==='finish'){
      if(!discovery)throw new Error('新關鍵詞掃描尚未初始化');
      const result=annotateTrend(discovery.finish());
      self.postMessage({type:'finished',result});
      discovery=null;
    }
  }catch(error){
    discovery=null;
    self.postMessage({type:'error',error:String(error?.message||error)});
  }
};
