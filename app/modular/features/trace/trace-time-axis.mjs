// The spatial timeline is a projection of already fetched Point.attr.times.
// Neither playback nor dragging the cursor queries Galaxy or aggregates dates.
const instant=value=>{
  if(typeof value!=='string'||!value.trim())return null;
  const ms=Date.parse(value);
  return Number.isFinite(ms)?ms:null;
};
export function traceTimeEvents(anchors=[]){
  const result=[];
  for(const point of Array.isArray(anchors)?anchors:[]){
    const uid=String(point?.uid||'');
    if(!uid||point?.trace_type!=='space_anchor')continue;
    const scope=String(point.source_scope||'');
    const members=Array.isArray(point.members)&&point.members.length?point.members:[point];
    for(const member of members){
      const key=String(member.source_scope||scope)+':'+String(member.uid||uid);
      const raw=member.times??member.attr?.times??[];
      const seen=new Set();
      for(const date of Array.isArray(raw)?raw:[]){
        const ms=instant(date);
        if(ms===null||seen.has(ms))continue;
        seen.add(ms);
        result.push({key,pointKey:scope+':'+uid,time:ms});
      }
    }
  }
  return result.sort((a,b)=>a.time-b.time);
}
export function traceTimeBounds(events=[]){
  if(!events.length)return null;
  const first=events[0].time,last=events[events.length-1].time;
  return {start:first,end:last,count:events.length};
}
export function traceTimeAt(bounds,progress){
  if(!bounds)return null;
  const fraction=Math.max(0,Math.min(1,Number(progress)||0));
  return bounds.start+(bounds.end-bounds.start)*fraction;
}
export function traceTimeProgress(bounds,time){
  if(!bounds)return 0;
  const span=bounds.end-bounds.start;
  return span<=0?1:Math.max(0,Math.min(1,(time-bounds.start)/span));
}
export function traceTimeActiveKeys(events=[],timestamp=null){
  if(timestamp===null||!Number.isFinite(timestamp))return [];
  const keys=new Set();
  for(const event of events){
    if(event.time>timestamp)break;
    keys.add(event.pointKey);
  }
  return [...keys];
}
