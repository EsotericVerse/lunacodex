// Annual dates are derived from existing Time anchors and the Scope birthday.
// A proposal is virtual until the reader explicitly saves it, or an authorized
// import matches that calendar day. This module never writes to the database.
const parseDay=value=>{
  const day=String(value||'').slice(0,10);
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if(!match)return null;
  const year=+match[1],month=+match[2],date=+match[3];
  const d=new Date(0);d.setUTCHours(0,0,0,0);d.setUTCFullYear(year,month-1,date);
  if(d.getUTCFullYear()!==year||d.getUTCMonth()!==month-1||d.getUTCDate()!==date)
    return null;
  return {day,year,month,date,monthDay:day.slice(5)};
};
function createAnniversaryLookup(anchors=[],{birthday=''}={}){
  const exactDays=new Set(),byMonthDay=new Map();
  for(const item of Array.isArray(anchors)?anchors:[]){
    if(item?.type!=='anchor'&&item?.entry_type!=='anchor')continue;
    const source=parseDay(item.address);
    if(!source)continue;
    exactDays.add(source.day);
    const list=byMonthDay.get(source.monthDay)||[];
    list.push({source,uid:String(item.uid||''),title:String(item.title||'').trim()});
    byMonthDay.set(source.monthDay,list);
  }
  const born=parseDay(birthday);
  return date=>{
    const target=parseDay(date);
    if(!target||exactDays.has(target.day))return [];
    const suggestions=[];
    if(born&&target.monthDay===born.monthDay&&target.day>=born.day){
      const years=target.year-born.year;
      suggestions.push({date:target.day,years,sourceUid:'birthday',
        sourceDate:born.day,sourceTitle:'生日',
        title:years?'生日 · '+years+' 歲':'生日'});
    }
    for(const {source,uid,title} of byMonthDay.get(target.monthDay)||[]){
      if(source.year>=target.year)continue;
      const years=target.year-source.year;
      suggestions.push({date:target.day,years,sourceUid:uid,
        sourceDate:source.day,sourceTitle:title,
        title:title?title+' · '+years+' 週年':years+' 週年紀念'});
    }
    return suggestions.sort((a,b)=>Number(b.sourceUid==='birthday')-
      Number(a.sourceUid==='birthday')||b.years-a.years||
      a.sourceDate.localeCompare(b.sourceDate)).slice(0,20);
  };
}
export function anniversarySuggestionsForDate(date,anchors=[],options={}){
  return createAnniversaryLookup(anchors,options)(date);
}
