// The LOC / LunaRunes statistics timeframe is controlled exclusively by +/-.
// Default to the last calendar year; never request more than one year at once.
// Automatic week/month buckets are presentation only.
// One page-size contract for both the visual Rune ranking and media facets.
export const RUNE_RANKING_PAGE_SIZE=8;
export const OTHER_RANKING_PAGE_SIZE=10;
const MS_PER_DAY=86_400_000;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const validDate=value=>{
  if(!DATE.test(String(value||'')))return false;
  const date=new Date(value+'T00:00:00Z');
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
};
const epoch=value=>Date.parse(value+'T00:00:00Z');
const dateFromEpoch=value=>new Date(value).toISOString().slice(0,10);

export function statisticsZoomLevel(value=0){
  return Math.trunc(Number.isFinite(Number(value))?Number(value):0);
}
function lastYearDate(value){
  const date=new Date(value+'T00:00:00Z');
  const day=date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth()-12);
  const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();
  date.setUTCDate(Math.min(day,last));
  return date.toISOString().slice(0,10);
}
export function statisticsZoomWindow(level=0,endDate='',earliestDate=''){
  const zoom=statisticsZoomLevel(level);
  if(!validDate(endDate))return {
    startDate:'',endDate:'',bucket:'day',level:zoom,fullHistory:false,canZoomOut:false,canZoomIn:false
  };
  const origin=lastYearDate(endDate);
  const baseDays=Math.max(1,Math.round((epoch(endDate)-epoch(origin))/MS_PER_DAY));
  const earliest=validDate(earliestDate)&&earliestDate<=endDate?earliestDate:'';
  const factor=2**(-zoom);
  const span=Number.isFinite(factor)?Math.max(0,Math.round(baseDays*factor)):Infinity;
  const boundedSpan=Math.min(baseDays,span);
  const candidate=dateFromEpoch(epoch(endDate)-boundedSpan*MS_PER_DAY);
  const startDate=earliest&&candidate<earliest?earliest:candidate;
  const days=Math.round((epoch(endDate)-epoch(startDate))/MS_PER_DAY);
  return {
    startDate,endDate,
    bucket:days>180?'month':days>31?'week':'day',
    level:zoom,
    fullHistory:Boolean(earliest&&startDate<=earliest),
    canZoomOut:Boolean(earliest&&startDate>earliest&&startDate>origin),
    canZoomIn:Boolean(earliest&&days>0)
  };
}
export function statisticsWeekKey(date){
  const at=new Date(String(date).slice(0,10)+'T00:00:00Z');
  if(!Number.isFinite(at.getTime()))return '';
  at.setUTCDate(at.getUTCDate()-(at.getUTCDay()+6)%7);
  return at.toISOString().slice(0,10);
}

// Pure chart capability selection is shared by all statistics callers.
// Chart types are capabilities, not ten interchangeable skins for one number.
export function chartTypeGroups(available=[],recommended=[]){
  const keep=new Set(recommended);
  return {
    primary:available.filter(([type])=>keep.has(type)),
    advanced:available.filter(([type])=>!keep.has(type))
  };
}

export const STAT_VISUAL_TYPES=Object.freeze([
  'line','bar','pie','area','stacked','composed','scatter','radar','radial','treemap'
].map(type=>Object.freeze([type,'uiExtra.chartTypes.'+type])));
// Strongly separated hues remain legible across light/dark themes and 8 lanes.
const COLORS=['#8962e3','#e5a13c','#14b8c4','#e75a68','#53bd79','#e37bb8','#468fe2','#dbb347',
  '#52b4a5','#da7550','#7b90e2','#ce637f','#4d9cc9','#bc8050','#80be7b','#d48fb3'];
export const number=value=>Math.max(0,Number(value)||0);
export const color=i=>COLORS[i%COLORS.length];
// Each individual bar/point gets a deterministic color. Extend beyond the
// fixed 16-color series palette without repeating colors on long timelines.
export const pointColor=index=>{
  const i=Math.max(0,Math.floor(Number(index)||0));
  if(i<COLORS.length)return COLORS[i];
  return `hsl(${Math.round((i*137.508+25)%360)} 70% ${45+(Math.floor(i/COLORS.length)%3)*5}%)`;
};

export function nonemptySeries(rows=[],series=[]){
  return (Array.isArray(series)?series:[]).filter(s=>s?.key&&rows.some(row=>number(row[s.key])>0)).slice(0,8);
}
export function normalizeDistribution(distribution=[],rows=[],series=[]){
  const supplied=(Array.isArray(distribution)?distribution:[])
    .map(item=>({name:String(item.name||item.term||''),key:item.key??item.name??item.term,value:number(item.value??item.item_count),...((typeof item.fill==='string'&&/^#[0-9a-fA-F]{6}$/.test(item.fill))?{fill:item.fill}:{})}))
    .filter(item=>item.name&&item.value>0);
  if(supplied.length)return supplied;
  return series.map(s=>({name:s.label||s.key,value:rows.reduce((n,row)=>n+number(row[s.key]),0)}))
    .filter(item=>item.value>0);
}
function totalValue(row,series,totalKey=''){
  return totalKey?number(row?.[totalKey]):series.reduce((n,s)=>n+number(row?.[s.key]),0);
}
export function movingAverage(rows,series,totalKey){
  return rows.map((row,i)=>({
    ...row,
    __stat_total:totalValue(row,series,totalKey),
    __stat_average:rows.slice(Math.max(0,i-2),i+1).reduce((n,r)=>n+totalValue(r,series,totalKey),0)/(Math.min(i+1,3))
  }));
}
export function scatterPair(rows,series){
  for(let a=0;a<series.length;a++)for(let b=a+1;b<series.length;b++){
    const left=series[a],right=series[b];
    const x=rows.map(row=>number(row[left.key])),y=rows.map(row=>number(row[right.key]));
    if(rows.length>=3&&new Set(x).size>1&&new Set(y).size>1&&rows.some(row=>number(row[left.key])&&number(row[right.key]))){
      return {x:left,y:right,data:rows.map(row=>({x:number(row[left.key]),y:number(row[right.key]),period:row.period}))};
    }
  }
  return null;
}
export function radarPeriodComparison(rows,series){
  if(rows.length<2||series.length<3)return null;
  const mid=Math.ceil(rows.length/2);
  const first=rows.slice(0,mid),last=rows.slice(mid);
  const firstTotal=first.reduce((n,row)=>n+totalValue(row,series),0);
  const lastTotal=last.reduce((n,row)=>n+totalValue(row,series),0);
  if(!firstTotal||!lastTotal)return null;
  const data=series.map(s=>{
    const early=first.reduce((n,row)=>n+number(row[s.key]),0)*100/firstTotal;
    const late=last.reduce((n,row)=>n+number(row[s.key]),0)*100/lastTotal;
    return {name:s.label||s.key,early,late};
  });
  if(!data.some(row=>Math.abs(row.early-row.late)>=.5))return null;
  return data;
}
export function activePeriodCoverage(rows,series){
  if(rows.length<3||series.length<2)return null;
  const result=series.map((s,i)=>({
    name:s.label||s.key,
    value:100*rows.filter(row=>number(row[s.key])>0).length/rows.length,
    fill:color(i)
  }));
  if(new Set(result.map(item=>Math.round(item.value*10))).size<2)return null;
  return result;
}
export function availableStatisticChartTypes({rows=[],series=[],distribution=[],totalKey=''}={}){
  const time=Array.isArray(rows)?rows:[];
  const fields=nonemptySeries(time,series);
  const categories=normalizeDistribution(distribution,time,fields);
  const hasTime=time.length>0&&(fields.length>0||(totalKey&&time.some(row=>number(row[totalKey])>0)));
  if(!hasTime&&!categories.length)return [];
  const hasMix=categories.length>=2;
  const compare=fields.length>=2;
  const usable=type=>{
    if(type==='line')return hasTime; // A distribution without dated rows is not a time-series line.
    if(type==='bar')return hasTime||categories.length>0;
    if(type==='area')return hasTime&&time.length>=2;
    if(type==='pie'||type==='treemap')return hasMix;
    if(type==='stacked')return compare&&time.length>=2;
    if(type==='composed')return time.length>=3&&new Set(time.map(row=>totalValue(row,fields,totalKey))).size>1;
    if(type==='scatter')return Boolean(scatterPair(time,fields));
    if(type==='radar')return Boolean(radarPeriodComparison(time,fields));
    if(type==='radial')return Boolean(activePeriodCoverage(time,fields));
    return false;
  };
  return STAT_VISUAL_TYPES.filter(([type])=>usable(type));
}



// Recharts is a presentation engine, not a reason to offer every chart for
// every metric. Geography and multimedia are categorical keyword dimensions:
// overlapping keyword/media hits must never be presented as parts of a pie.
// Keep this pure: all callers use their existing bounded analytics response.
export const STATISTIC_CHART_PURPOSES=Object.freeze({
  total:Object.freeze(['line','composed','area','bar']),
  source:Object.freeze(['line','stacked','bar','area','pie','treemap']),
  place:Object.freeze(['bar','line','stacked','area','pie']),
  keyword:Object.freeze(['bar','line','stacked','area']),
  media:Object.freeze(['bar','line','stacked','area']),
  comparison:Object.freeze(['line','stacked','bar','scatter'])
});

// Decide the default by the question the statistic answers, not by the
// last chart selected on a different dimension. Manual choices remain valid.
export const STATISTIC_DEFAULT_CHART=Object.freeze({
  total:'line',
  source:'line',
  place:'bar',
  keyword:'bar',
  media:'bar',
  comparison:'line'
});

export function preferredStatisticChartType({purpose='total',available=[],requested='auto'}={}){
  const ids=new Set(available.map(([id])=>id));
  if(requested!=='auto'&&ids.has(requested))return requested;
  const preferred=STATISTIC_DEFAULT_CHART[purpose]||'line';
  return ids.has(preferred)?preferred:(available[0]?.[0]||'');
}

export function semanticStatisticChartTypes({
  purpose='total',rows=[],series=[],distribution=[],totalKey=''
}={}){
  const preferred=STATISTIC_CHART_PURPOSES[purpose]||STATISTIC_CHART_PURPOSES.total;
  const possible=new Map(availableStatisticChartTypes({rows,series,distribution,totalKey}));
  const categories=normalizeDistribution(distribution,rows,nonemptySeries(rows,series));
  // Too many pie slices conceal the ranking. A Treemap remains available
  // for exclusive source categories; never for overlapping keyword/media.
  return preferred.filter(type=>possible.has(type)&&
    !(type==='pie'&&categories.length>6))
    .map(type=>[type,possible.get(type)]);
}
