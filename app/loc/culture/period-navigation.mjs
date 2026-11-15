import {timePeriodContainsDate,timeDateWindows} from './time-anchor-ranges.mjs';
const toDay=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||'').slice(0,10))
  ?String(value).slice(0,10):'';
const toMs=day=>Date.parse(day+'T00:00:00Z');
const keyOf=row=>String(row?.period||row?.era_id||row?.uid||row?.id||'').trim();
// Select the closest real era by distance from the *calendar today*.
// Today is a query/selection reference, NEVER a Time anchor or a trace end.
// Ranges may be disconnected, overlapping or singleton points.
export function structurePeriodPreference(periods=[],items=[],referenceDay=''){
  const lastAnchor=(Array.isArray(items)?items:[])
    .filter(row=>row?.entry_type==='anchor'&&toDay(row.start_date))
    .sort((a,b)=>String(a.start_date).localeCompare(String(b.start_date))).at(-1)||null;
  const day=toDay(referenceDay)||new Date().toISOString().slice(0,10);
  const target=toMs(day);
  let closest=null,best=Infinity,bestEnd=-Infinity;
  for(const trace of Array.isArray(periods)?periods:[]){
    const windows=Array.isArray(trace.ranges)
      ?timeDateWindows(trace.ranges):
        trace.start_date?[{startDate:toDay(trace.start_date),
          endDate:toDay(trace.end_date)||toDay(trace.start_date)}]:[];
    for(const interval of windows){
      const a=toMs(interval.startDate),b=toMs(interval.endDate);
      if(!Number.isFinite(a)||!Number.isFinite(b))continue;
      const distance=target<a?a-target:target>b?target-b:0;
      if(distance<best||distance===best&&b>bestEnd){
        closest=trace;best=distance;bestEnd=b;
      }
    }
  }
  return {lastAnchor,preferredKey:closest?keyOf(closest):'all'};
}
