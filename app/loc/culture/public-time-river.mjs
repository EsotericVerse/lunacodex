const list=value=>Array.isArray(value)?value:[];
const text=value=>String(value??'').trim();
const day=value=>String(value??'').slice(0,10);
const validDay=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&
  Number.isFinite(Date.parse(value+'T00:00:00Z'));
function attributes(row){
  if(typeof row?.attr==='string'){
    try{return JSON.parse(row.attr)||{};}catch{return {};}
  }
  return row?.attr&&typeof row.attr==='object'&&!Array.isArray(row.attr)?row.attr:{};
}
function inlineDates(row){
  return list(attributes(row).date||attributes(row).dates)
    .map(day).filter(validDay);
}
function linkedDateRows(period,datesByUid){
  const attr=attributes(period);
  const linked=list(attr.uid||attr.lucus).map(text)
    .map(uid=>datesByUid.get(uid)).filter(Boolean);
  const inline=inlineDates(period).map(date=>({uid:'inline:'+date,date,title:date}));
  const seen=new Set();
  return [...linked,...inline].filter(row=>{
    const key=String(row.uid||row.date);
    if(seen.has(key))return false;
    seen.add(key);
    return true;
  });
}
function mergeRanges(ranges){
  const sorted=[...ranges].filter(row=>row.start&&row.end&&row.start<=row.end)
    .sort((a,b)=>a.start.localeCompare(b.start)||a.end.localeCompare(b.end));
  const output=[];
  for(const range of sorted){
    const prior=output.at(-1);
    if(prior&&range.start<=prior.end){
      if(range.end>prior.end)prior.end=range.end;
    }else output.push({...range});
  }
  return output;
}

/**
 * Build the public Scope TimeLucus river from one bounded TimeLucus snapshot.
 * Era and Period metadata are retained; DateLucus rows are already restricted
 * by the server to the requested interval. Expanding an Era only changes the
 * presentation and never starts another read.
 */
export function buildPublicTimeLucusRiver(rows=[],{
  startDate='',endDate='',expandedEras=[]
}={}){
  const start=day(startDate),end=day(endDate);
  if(!validDay(start)||!validDay(end)||start>end)return {items:[],groups:[]};
  const source=list(rows).filter(row=>['era','period','date'].includes(row?.type));
  const byUid=new Map(source.map(row=>[text(row.uid),row]).filter(([uid])=>uid));
  const dates=source.filter(row=>row.type==='date').map(row=>({
    ...row,date:day(attributes(row).date)
  })).filter(row=>validDay(row.date)&&row.date>=start&&row.date<=end);
  const datesByUid=new Map(dates.map(row=>[text(row.uid),row]));
  const eras=source.filter(row=>row.type==='era').map(era=>{
    const periodUids=list(attributes(era).period).map(text).filter(Boolean);
    const periods=periodUids.map(uid=>byUid.get(uid)).filter(row=>row?.type==='period');
    const periodModels=periods.map(period=>{
      const points=linkedDateRows(period,datesByUid).filter(row=>row.date>=start&&row.date<=end);
      const days=points.map(row=>row.date).sort();
      return {row:period,points,start:days[0]||'',end:days.at(-1)||''};
    }).filter(item=>item.start);
    const ownDates=inlineDates(era).filter(value=>value>=start&&value<=end);
    const allDays=[...periodModels.flatMap(item=>[item.start,item.end]),...ownDates].sort();
    return {row:era,periodModels,ownDates,start:allDays[0]||'',end:allDays.at(-1)||''};
  }).sort((a,b)=>(a.start||'9999-12-31').localeCompare(b.start||'9999-12-31')||
    text(a.row.uid).localeCompare(text(b.row.uid)));

  const groups=[],items=[],assignedDates=new Set();
  for(const [eraOrder,model] of eras.entries()){
    const era=model.row,eraUid=text(era.uid),eraGroup='era:'+eraUid;
    const eraLabel=text(era.title)||'時代';
    const hasChildren=Boolean(model.periodModels.length||model.ownDates.length);
    const expanded=hasChildren&&list(expandedEras).includes(eraUid);
    groups.push({id:eraGroup,label:eraLabel,order:eraOrder,
      collapsible:hasChildren,expanded,className:'scope-time-trace-parent'});

    for(const [index,range] of mergeRanges(model.periodModels.map(item=>({
      start:item.start,end:item.end
    })).concat(model.ownDates.map(value=>({start:value,end:value})))).entries()){
      items.push({id:eraGroup+':segment:'+index,entry_type:'era',uid:eraUid,
        title:eraLabel,group_key:eraGroup,group_label:eraLabel,
        group_order:eraOrder,start_date:range.start,
        ...(range.end>range.start?{end_date:range.end}:{})});
    }

    for(const periodModel of model.periodModels)
      for(const point of periodModel.points){
        const uid=text(point.uid);
        if(uid)assignedDates.add(uid);
      }
    if(!expanded)continue;
    for(const [periodOrder,periodModel] of model.periodModels.entries()){
      const period=periodModel.row,periodUid=text(period.uid);
      const periodGroup='period:'+eraUid+':'+periodUid;
      const periodLabel=text(period.title)||'期間';
      groups.push({id:periodGroup,label:'　'+periodLabel,
        order:groups.length,className:'scope-time-trace-child'});
      items.push({id:periodGroup+':range',entry_type:'period',uid:periodUid,
        title:periodLabel,group_key:periodGroup,group_label:periodLabel,
        group_order:periodOrder,start_date:periodModel.start,
        ...(periodModel.end>periodModel.start?{end_date:periodModel.end}:{})});
      for(const point of periodModel.points){
        const uid=text(point.uid);
        if(uid)assignedDates.add(uid);
        items.push({id:periodGroup+':'+(uid||point.date),entry_type:'lucus',
          uid,title:text(point.title)||point.date,display_label:'◆',
          start_date:point.date,group_key:periodGroup,group_label:periodLabel,
          class_name:'scope-time-original-lucus'});
      }
    }
    for(const value of model.ownDates){
      const uid='era-inline:'+eraUid+':'+value;
      items.push({id:uid,entry_type:'lucus',uid,title:value,display_label:'◆',
        start_date:value,group_key:eraGroup,group_label:eraLabel});
    }
  }

  const unassigned=dates.filter(row=>!assignedDates.has(text(row.uid))&&
    !eras.some(model=>model.ownDates.includes(row.date)));
  if(eras.length||dates.length){
    const group='time-undefined';
    groups.push({id:group,label:'未定義',order:groups.length,
      className:'scope-time-anchor-parent'});
    for(const row of unassigned){
      items.push({id:group+':'+text(row.uid),entry_type:'lucus',
        uid:text(row.uid),title:text(row.title)||row.date,display_label:'●',
        start_date:row.date,group_key:group,group_label:'未定義',
        class_name:'scope-time-original-lucus'});
    }
  }
  return {items,groups};
}
