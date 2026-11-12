import {detectCountChangepoints} from '../../../loc/karaul-count-changepoints.mjs';

const DAY_MS=86400000;
const ANCHOR_COVER_DAYS=3;
const SUGGESTION_MIN_GAP_DAYS=7;
const SUGGESTION_MIN_SEGMENT_SHARE=0.03;
const MIN_ANCHOR_SUGGESTION_ITEMS=20;

function dayKey(value){
  const key=String(value||'').slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key)?key:'';
}
function dayMs(value){
  const key=dayKey(value);
  return key?Date.parse(key+'T00:00:00Z'):NaN;
}
function dayFromMs(value){
  return new Date(value).toISOString().slice(0,10);
}

function aggregateRiverDensity(rows=[]){
  const counts=new Map();
  for(const row of rows||[]){
    const date=dayKey(row?.date||row?.day||row?.start_date);
    const count=Math.max(0,Number(row?.count??row?.item_count??0)||0);
    if(!date||count<=0)continue;
    counts.set(date,(counts.get(date)||0)+count);
  }
  return [...counts.entries()]
    .map(([date,count])=>({date,count}))
    .sort((a,b)=>a.date.localeCompare(b.date));
}

function fillRiverDensity(rows=[]){
  const aggregated=aggregateRiverDensity(rows);
  if(!aggregated.length)return [];
  const counts=new Map(aggregated.map(row=>[row.date,row.count]));
  const start=dayMs(aggregated[0].date);
  const end=dayMs(aggregated.at(-1).date);
  const filled=[];
  for(let cursor=start;cursor<=end;cursor+=DAY_MS){
    const date=dayFromMs(cursor);
    filled.push({date,count:counts.get(date)||0});
  }
  return filled;
}

function nearestPublishedBefore(rows,index){
  for(let cursor=Math.min(index-1,rows.length-1);cursor>=0;cursor--){
    if(Number(rows[cursor]?.count)>0)return rows[cursor].date;
  }
  return '';
}
function nearestPublishedAtOrAfter(rows,index){
  for(let cursor=Math.max(0,index);cursor<rows.length;cursor++){
    if(Number(rows[cursor]?.count)>0)return rows[cursor].date;
  }
  return '';
}
function structuralEmptyRuns(rows,changepoints){
  const changeSet=new Set(changepoints);
  const runs=[];
  let start=-1;
  for(let index=0;index<=rows.length;index++){
    const empty=index<rows.length&&Number(rows[index]?.count)===0;
    if(empty&&start<0)start=index;
    if((!empty||index===rows.length)&&start>=0){
      const endIndex=index;
      if(changeSet.has(start)||changeSet.has(endIndex))runs.push({startIndex:start,endIndex});
      start=-1;
    }
  }
  return runs;
}

export function analyzeRiverDensity(rows=[],anchorDates=[]){
  const density=fillRiverDensity(rows);
  if(density.length<3)return {density,changepoints:[],hiddenDates:[],suggestions:[]};

  const values=density.map(row=>Number(row.count)||0);
  let changepoints=[];
  try{
    changepoints=detectCountChangepoints(values)
      .filter(index=>Number.isInteger(index)&&index>0&&index<density.length);
  }catch{
    changepoints=[];
  }

  const totalCount=values.reduce((sum,value)=>sum+value,0);
  if(totalCount<MIN_ANCHOR_SUGGESTION_ITEMS){
    return {density,changepoints,hiddenDates:[],suggestions:[],suggestionEligible:false,totalCount};
  }
  const boundaries=[0,...changepoints,density.length];
  const segmentTotals=[];
  for(let i=0;i<boundaries.length-1;i++){
    let total=0;
    for(let index=boundaries[i];index<boundaries[i+1];index++)total+=values[index];
    segmentTotals.push(total);
  }
  const supportedBoundaries=new Set();
  for(let i=1;i<boundaries.length-1;i++){
    const share=totalCount>0?Math.max(segmentTotals[i-1]||0,segmentTotals[i]||0)/totalCount:0;
    if(share>=SUGGESTION_MIN_SEGMENT_SHARE)supportedBoundaries.add(boundaries[i]);
  }

  const emptySegments=structuralEmptyRuns(density,changepoints);
  const hiddenDates=emptySegments.map(segment=>({
    start:density[segment.startIndex].date,
    end:segment.endIndex<density.length?density[segment.endIndex].date:dayFromMs(dayMs(density.at(-1).date)+DAY_MS)
  }));

  const existing=(anchorDates||[]).map(dayMs).filter(Number.isFinite);
  const suggestions=new Map();
  const coveredByAnchor=key=>{
    const value=dayMs(key);
    return Number.isFinite(value)&&existing.some(anchor=>Math.abs(value-anchor)<=ANCHOR_COVER_DAYS*DAY_MS);
  };
  const addSuggestion=(date,reason)=>{
    const key=dayKey(date);
    if(!key||coveredByAnchor(key))return;
    const current=suggestions.get(key);
    if(!current||reason==='gap-edge')suggestions.set(key,{date:key,reason});
  };

  for(const index of changepoints){
    if(!supportedBoundaries.has(index))continue;
    const before=Number(density[index-1]?.count)||0;
    const after=Number(density[index]?.count)||0;
    if(before>0&&after===0)addSuggestion(nearestPublishedBefore(density,index),'change-point');
    else addSuggestion(nearestPublishedAtOrAfter(density,index),'change-point');
  }
  for(const segment of emptySegments){
    if(supportedBoundaries.has(segment.startIndex))addSuggestion(nearestPublishedBefore(density,segment.startIndex),'gap-edge');
    if(supportedBoundaries.has(segment.endIndex))addSuggestion(nearestPublishedAtOrAfter(density,segment.endIndex),'gap-edge');
  }

  const rawSuggestions=[...suggestions.values()].sort((a,b)=>a.date.localeCompare(b.date));
  const densityIndex=new Map(density.map((row,index)=>[row.date,index]));
  const contrast=item=>{
    const index=densityIndex.get(item.date);
    if(!Number.isInteger(index))return 0;
    const before=density.slice(Math.max(0,index-3),index);
    const after=density.slice(index+1,Math.min(density.length,index+4));
    const mean=list=>list.length?list.reduce((sum,row)=>sum+(Number(row.count)||0),0)/list.length:0;
    return Math.abs(mean(after)-mean(before));
  };
  const clusters=[];
  for(const item of rawSuggestions){
    const last=clusters.at(-1);
    if(last&&dayMs(item.date)-dayMs(last.at(-1).date)<SUGGESTION_MIN_GAP_DAYS*DAY_MS)last.push(item);
    else clusters.push([item]);
  }
  const filteredSuggestions=clusters.map(cluster=>[...cluster].sort((a,b)=>contrast(b)-contrast(a)||a.date.localeCompare(b.date))[0]);
  const explainedSuggestions=filteredSuggestions.map(item=>{
    const index=densityIndex.get(item.date);
    const beforeRows=Number.isInteger(index)?density.slice(Math.max(0,index-3),index):[];
    const afterRows=Number.isInteger(index)?density.slice(index+1,Math.min(density.length,index+4)):[];
    const mean=list=>list.length?list.reduce((sum,row)=>sum+(Number(row.count)||0),0)/list.length:0;
    const beforeMean=mean(beforeRows);
    const afterMean=mean(afterRows);
    const beforeCount=beforeRows.reduce((sum,row)=>sum+(Number(row.count)||0),0);
    const afterCount=afterRows.reduce((sum,row)=>sum+(Number(row.count)||0),0);
    const delta=afterMean-beforeMean;
    const analysis=[];
    if(item.reason==='gap-edge'){
      if(beforeMean>0&&afterMean===0)analysis.push('作品分布在此處進入結構性空白。');
      else if(beforeMean===0&&afterMean>0)analysis.push('作品分布在此處由結構性空白恢復。');
      else analysis.push('此處位於作品分布的結構性空白邊界。');
    }else{
      analysis.push('PELT 偵測到此處前後的作品密度出現變化。');
    }
    if(beforeRows.length&&afterRows.length){
      const direction=delta>0?'增加':delta<0?'減少':'持平';
      analysis.push('切點前 3 日 '+beforeCount.toLocaleString()+' 項，後 3 日 '+afterCount.toLocaleString()+' 項；平均 '+beforeMean.toFixed(1)+' → '+afterMean.toFixed(1)+' 項／日，密度'+direction+'。');
    }
    analysis.push('相鄰區段至少一側占此時期作品總量 3% 以上。');
    return {...item,beforeMean,afterMean,beforeCount,afterCount,delta,analysis};
  });

  return {
    density,
    changepoints,
    hiddenDates,
    suggestions:explainedSuggestions,
    suggestionEligible:true,
    totalCount
  };
}
