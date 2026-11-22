// Presentation-only TimeAnchor hierarchy for every Time record list.
// Era.attr.period -> Period; Period.attr.uid -> Date. Never infer a parent
// from calendar overlap or materialize placeholder Anchor UIDs.
const uid=row=>String(row?.uid||'').trim();
const ids=row=>Array.isArray(row?.anchor_ids)?[...new Set(row.anchor_ids.map(String))]:[];
const title=row=>String(row?.title||row?.uid||'未命名紀錄');
const day=row=>String(row?.address||row?.attr?.date||'').slice(0,10);
const option=(row,group='')=>({
  value:uid(row),
  label:(row.type==='anchor'&&day(row)?day(row)+'｜':'')+title(row),
  ...(group?{group}:{})
});

export function timeRecordHierarchyOptions(rows=[],type='anchor'){
  const all=Array.isArray(rows)?rows:[];
  const eras=all.filter(row=>row.type==='era'&&uid(row));
  const periods=all.filter(row=>row.type==='period'&&uid(row));
  const dates=all.filter(row=>(row.type==='anchor'||row.type==='date')&&uid(row));
  const byPeriod=new Map(periods.map(row=>[uid(row),row]));
  const byDate=new Map(dates.map(row=>[uid(row),row]));
  const linkedPeriods=new Set(),linkedDates=new Set();
  const choices=[];
  if(type==='era')return eras.map(row=>option(row));
  const renderPeriod=(period,era)=>{
    const section=era?'時代：'+title(era):'未分類時代';
    if(type==='period')choices.push(option(period,section));
    else if(type==='anchor'){
      const path=section+'／時期：'+title(period);
      for(const id of ids(period)){
        const row=byDate.get(id);
        if(!row)continue;
        linkedDates.add(id);
        choices.push(option(row,path));
      }
    }
  };
  for(const era of eras){
    const seen=new Set();
    for(const id of ids(era)){
      const period=byPeriod.get(id);
      if(!period||seen.has(id))continue;
      seen.add(id);linkedPeriods.add(id);
      renderPeriod(period,era);
    }
  }
  for(const period of periods)
    if(!linkedPeriods.has(uid(period)))renderPeriod(period,null);
  if(type==='anchor')
    for(const row of dates)
      if(!linkedDates.has(uid(row)))
        choices.push(option(row,'未分類定錨點'));
  return choices;
}
