// Time hierarchy is stored as Era.attr.period UID references.
// Never infer membership from overlapping calendar windows.
const uid=row=>String(row?.uid||row?.event_id||row?.id||'').trim();
export function cultureEraPeriodHierarchy(eras=[],timelineItems=[],scope=''){
  const periods=(Array.isArray(timelineItems)?timelineItems:[])
    .filter(row=>row?.entry_type==='period'&&(!scope||row.scope_id===scope)&&uid(row));
  const byUid=new Map(periods.map(row=>[uid(row),row]));
  const assigned=new Set();
  const groups=(Array.isArray(eras)?eras:[]).filter(row=>!scope||row?.scope_id===scope)
    .map(era=>{
      const seen=new Set(),children=[];
      for(const ref of era.anchor_ids||[]){
        const key=String(ref||'').trim();
        if(seen.has(key))continue;
        seen.add(key);
        const period=byUid.get(key);
        if(period){children.push(period);assigned.add(key);}
      }
      return {era,periods:children};
    });
  return {groups,unassigned:periods.filter(row=>!assigned.has(uid(row)))};
}
