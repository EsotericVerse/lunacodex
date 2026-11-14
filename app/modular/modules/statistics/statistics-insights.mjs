// LOC Statistics insight projection. No SQL, article reads or source taxonomy.
const count=value=>{
  const n=Number(value);
  return Number.isFinite(n)&&n>=0?n:0;
};
const average=values=>values.length
  ?values.reduce((sum,value)=>sum+value,0)/values.length:0;
const period=entry=>String(entry.period||entry.day||'').trim();

export function totalPeriodStats(rows=[]){
  const entries=(Array.isArray(rows)?rows:[])
    .filter(row=>row&&period(row)&&Number.isFinite(Number(row.total))&&Number(row.total)>=0)
    .map(row=>({period:period(row),value:count(row.total)}));
  const values=entries.map(row=>row.value);
  const sorted=[...values].sort((a,b)=>a-b);
  const middle=Math.floor(sorted.length/2);
  const median=sorted.length
    ?sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2:0;
  const descending=[...entries].sort((a,b)=>b.value-a.value||a.period.localeCompare(b.period));
  const ascending=[...entries].sort((a,b)=>a.value-b.value||a.period.localeCompare(b.period));
  return {
    entries,values,total:values.reduce((sum,value)=>sum+value,0),
    mean:average(values),median,
    maximum:descending[0]||null,minimum:ascending[0]||null,
    top:descending,bottom:ascending
  };
}

// A PELT boundary is evidence of a change in mean publication density, not a
// causal explanation or a prediction. Never manufacture a trend without one.
export function explainPeltChange(rows=[],points=[]){
  const stats=totalPeriodStats(rows);
  const valid=[...new Set((Array.isArray(points)?points:[])
    .filter(n=>Number.isInteger(n)&&n>=2&&n<=stats.values.length-2))].sort((a,b)=>a-b);
  if(!valid.length)return {detected:false,boundary:null,direction:'none',
    before:0,after:0,changePercent:null};
  const at=valid.at(-1);
  const previous=valid.length>1?valid.at(-2):0;
  const before=average(stats.values.slice(previous,at));
  const after=average(stats.values.slice(at));
  const delta=after-before;
  const direction=Math.abs(delta)<1e-9?'flat':delta>0?'up':'down';
  return {detected:true,boundary:stats.entries[at]?.period||null,
    boundaryIndex:at,direction,before,after,
    changePercent:before>0?delta/before*100:null,
    allBoundaries:valid.map(index=>stats.entries[index].period)};
}

// Rank periods by deviation from their PELT-detected structural segment.
// When no boundary is detected, the full-series mean is the baseline.
// The ranking is therefore contextual rather than a rigid total-count chart.
export function rankInsightPeriods(rows=[],points=[]){
  const stats=totalPeriodStats(rows);
  const n=stats.entries.length;
  const boundaries=[0,...new Set((Array.isArray(points)?points:[])
    .filter(v=>Number.isInteger(v)&&v>=2&&v<=n-2))].sort((a,b)=>a-b);
  boundaries.push(n);
  const scored=[];
  for(let j=1;j<boundaries.length;j++){
    const start=boundaries[j-1],end=boundaries[j];
    const baseline=average(stats.values.slice(start,end));
    for(let i=start;i<end;i++){
      const row=stats.entries[i];
      scored.push({...row,baseline,deviation:row.value-baseline});
    }
  }
  const up=scored.filter(row=>row.deviation>0).sort((a,b)=>
    b.deviation-a.deviation||a.period.localeCompare(b.period));
  const down=scored.filter(row=>row.deviation<0).sort((a,b)=>
    a.deviation-b.deviation||a.period.localeCompare(b.period));
  return {up,down,segmented:boundaries.length>2};
}
