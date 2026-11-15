// LOC Culture: two independently owned items compared by the same daily calendar.
// The three-calendar-month limit applies to the query, not only the screen.
export const ITEM_CONFLUENCE_MAX_MONTHS=3;
export const ITEM_CONFLUENCE_PAGE_SIZE=20;
export const ITEM_LANE_OPTIONS=Object.freeze([
  {value:'galaxy:facebook',label:'文字 · Facebook'},
  {value:'galaxy:threads',label:'文字 · Threads'},
  {value:'galaxy:instagram',label:'文字 · Instagram／Reels'},
  {value:'galaxy:all',label:'文字 · 全部來源'},
  {value:'galaxy:exact',label:'文字 · 指定 site'},
  {value:'media:all',label:'媒體 · 全部類型'},
  {value:'media:exact',label:'媒體 · 指定類型'},
  {value:'daily:rune',label:'每日符文（僅符韻）'}
]);
export function itemConfluenceDate(value){
  const day=String(value||'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return '';
  const parsed=new Date(day+'T00:00:00Z');
  return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===day?day:'';
}
export function itemConfluenceShiftMonth(value,delta){
  const day=itemConfluenceDate(value);
  if(!day)return '';
  const date=new Date(day+'T00:00:00Z');
  const originalDay=date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth()+delta);
  const maxDay=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();
  date.setUTCDate(Math.min(originalDay,maxDay));
  return date.toISOString().slice(0,10);
}
export function validateItemConfluenceRange(startDate,endDate){
  const start=itemConfluenceDate(startDate),end=itemConfluenceDate(endDate);
  if(!start||!end)return {valid:false,reason:'請指定有效的起始與結束日期。'};
  if(start>end)return {valid:false,reason:'結束日期不得早於開始日期。'};
  if(end>itemConfluenceShiftMonth(start,ITEM_CONFLUENCE_MAX_MONTHS))
    return {valid:false,reason:'項目交會最多三個日曆月，請縮小查詢區間。'};
  return {valid:true,startDate:start,endDate:end};
}
export function validateItemLane(lane,scopes){
  const scopeId=String(lane?.scopeId||'');
  const source=String(lane?.source||'');
  const exact=String(lane?.exact||'').trim();
  if(!Array.isArray(scopes)||!scopes.some(scope=>scope.id===scopeId&&scopeId!=='loc'))
    return {valid:false,reason:'請選擇可以讀取的 Scope。'};
  if(!ITEM_LANE_OPTIONS.some(option=>option.value===source))
    return {valid:false,reason:'請選擇有效的河道項目。'};
  if(source==='daily:rune'&&scopeId!=='lrunes')
    return {valid:false,reason:'每日符文只能從符韻 Scope 讀取。'};
  if(source.endsWith(':exact')&&(!exact||exact.length>100))
    return {valid:false,reason:'請輸入有效的來源／媒體類型（最多 100 字）。'};
  return {valid:true,scopeId,source,exact};
}
export function itemLaneDescription(lane){
  const option=ITEM_LANE_OPTIONS.find(item=>item.value===lane?.source);
  return String(lane?.scopeId||'')+' · '+(lane?.source?.endsWith(':exact')
    ?(String(lane?.source||'').startsWith('media:')?'媒體 · ':'文字 · ')+String(lane?.exact||'')
    :option?.label||'未選擇');
}

// Only the LunaRunes daily stream has semantic daily entries.
// Never reinterpret another Scope's frequency data as rune meanings.
const RUNE_KIND_LABELS=Object.freeze({
  main:'主抽',supplement:'補抽',history_1:'歷史一',history_2:'歷史二'
});
const RUNE_KIND_ORDER=Object.freeze({main:0,supplement:1,history_1:2,history_2:3});
export function itemRuneDisplay(draw){
  const name=String(draw?.rune_name||draw?.rune_number||'未知符文');
  const direction=String(draw?.direction||'方向未記錄');
  const phase=String(draw?.true_moon_phase||'月相未知');
  const kind=RUNE_KIND_LABELS[draw?.draw_kind]||String(draw?.draw_kind||'紀錄');
  return kind+' · '+name+' · '+direction+' · '+phase;
}
export function groupItemConfluenceRunes(rows=[],moonPhaseAtDate=()=> '未知'){
  const days=new Map();
  for(const source of Array.isArray(rows)?rows:[]){
    const day=itemConfluenceDate(source?.record_date);
    if(!day)continue;
    // Astronomical phase belongs to the calendar day, not to an inferred
    // density value or to another Scope's posts.
    const true_moon_phase=String(moonPhaseAtDate(day)||'未知');
    const draw={
      draw_kind:String(source.draw_kind||''),
      rune_number:Number(source.rune_number),
      rune_name:String(source.rune_name||source.rune_number||'未知符文'),
      direction:String(source.direction||''),
      true_moon_phase
    };
    if(!days.has(day))days.set(day,[]);
    days.get(day).push(draw);
  }
  return [...days.entries()].map(([day,draws])=>{
    draws.sort((a,b)=>(RUNE_KIND_ORDER[a.draw_kind]??9)-(RUNE_KIND_ORDER[b.draw_kind]??9)
      ||a.rune_number-b.rune_number);
    return {day,count:draws.length,draws};
  }).sort((a,b)=>a.day.localeCompare(b.day));
}

export function buildItemConfluenceDaily({startDate,endDate,lanes=[],series=[]}={}){
  const valid=validateItemConfluenceRange(startDate,endDate);
  if(!valid.valid)return [];
  const lookup=(series||[]).map(rows=>new Map((rows||[]).map(row=>[
    itemConfluenceDate(row?.day),row
  ])));
  const maximum=lookup.map(map=>Math.max(0,...[...map.values()].map(row=>Number(row?.count)||0)));
  const result=[];
  for(let date=new Date(startDate+'T00:00:00Z'),stop=new Date(endDate+'T00:00:00Z');date<=stop;date.setUTCDate(date.getUTCDate()+1)){
    const day=date.toISOString().slice(0,10);
    const counts=lookup.map(map=>Number(map.get(day)?.count)||0);
    const ratios=counts.map((count,index)=>maximum[index]>0?count/maximum[index]:0);
    const runeDraws=lookup.map((map,index)=>lanes[index]?.source==='daily:rune'
      ?(map.get(day)?.draws||[]):[]);
    result.push({day,counts,ratios,runeDraws});
  }
  return result;
}
export function buildItemConfluenceRiver(daily=[],labels=[],lanes=[]){
  const result=[];
  for(const row of daily){
    row.counts.forEach((count,index)=>{
      if(count<=0)return;
      const label=labels[index]||('河道 '+(index+1));
      // LunaRunes is the sole content-type lane: name + four-way direction
      // + true moon phase. Do not paint these records as density.
      if(lanes[index]?.source==='daily:rune'){
        const draws=row.runeDraws?.[index]||[];
        if(!draws.length)return;
        const runeText=draws.map(itemRuneDisplay).join(' ／ ');
        result.push({
          id:'loc-item:rune:'+index+':'+row.day,
          entry_id:'loc-item:rune:'+index+':'+row.day,
          entry_type:'item_daily_rune',
          scope_id:'lrunes',
          group_key:'loc-item-lane:'+index,
          group_label:label,
          group_order:index,
          start_date:row.day,
          display_label:runeText,
          title:row.day+' · 每日符文 · '+runeText+'（真實月相依紀錄日期計算）',
          daily_draws:draws
        });
        return;
      }
      const end=new Date(row.day+'T00:00:00Z');
      end.setUTCDate(end.getUTCDate()+1);
      result.push({
        id:'loc-item:'+index+':'+row.day,
        entry_id:'loc-item:'+index+':'+row.day,
        entry_type:'item_density',
        group_key:'loc-item-lane:'+index,
        group_label:label,
        group_order:index,
        start_date:row.day,
        end_date:end.toISOString().slice(0,10),
        item_count:count,
        density_ratio:row.ratios[index],
        global_density_ratio:row.ratios[index],
        display_label:'',
        title:row.day+' · '+label+' · '+count+' 筆 · 相對密度 '+(row.ratios[index]*100).toFixed(1)+'%'
      });
    });
  }
  return result;
}

export function itemConfluenceSummary(daily=[]){
  const totals=[0,0],peak=[0,0];
  let bothActiveDays=0;
  for(const row of daily){
    for(let i=0;i<2;i++){
      totals[i]+=row.counts[i]||0;
      peak[i]=Math.max(peak[i],row.counts[i]||0);
    }
    if(row.counts[0]>0&&row.counts[1]>0)bothActiveDays++;
  }
  return {totals,peak,bothActiveDays,totalDays:daily.length};
}
