// The LOC / LunaRunes statistics timeframe is controlled exclusively by +/-.
// Default to the last calendar year; never request more than one year at once.
// Automatic week/month buckets are presentation only.
// One page-size contract for Rune rankings and other comparisons.
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
export function scatterPair(rows,series,xKey='',yKey=''){
  const requestedX=series.find(field=>field.key===xKey);
  const requestedY=series.find(field=>field.key===yKey);
  const pairs=requestedX&&requestedY&&requestedX.key!==requestedY.key
    ?[[requestedX,requestedY]]
    :series.flatMap((left,index)=>series.slice(index+1).flatMap(right=>[
      [left,right],[right,left]
    ]));
  for(const [left,right] of pairs){
    const x=rows.map(row=>number(row[left.key])),y=rows.map(row=>number(row[right.key]));
    if(rows.length>=3&&new Set(x).size>1&&new Set(y).size>1&&rows.some(row=>number(row[left.key])&&number(row[right.key]))){
      return {x:left,y:right,data:rows.map(row=>({x:number(row[left.key]),y:number(row[right.key]),
        period:row.period,start_date:row.start_date,end_date:row.end_date}))};
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
    if(type==='scatter')return false; // Relationship charts require one raw record per point.
    if(type==='radar')return Boolean(radarPeriodComparison(time,fields));
    if(type==='radial')return Boolean(activePeriodCoverage(time,fields));
    return false;
  };
  return STAT_VISUAL_TYPES.filter(([type])=>usable(type));
}



// Recharts is a presentation engine, not a reason to offer every chart for
// every metric. Geography and keyword matches are potentially overlapping dimensions:
// these hits must not be presented as parts of a pie.
// Keep this pure: all callers use their existing bounded analytics response.
export const STATISTIC_CHART_PURPOSES=Object.freeze({
  total:Object.freeze(['line','composed','area','bar']),
  source:Object.freeze(['line','stacked','bar','area','pie','treemap']),
  // A work may refer to multiple places: counts are not exclusive slices.
  place:Object.freeze(['bar','line','area']),
  // Keyword hits can overlap, so stacking misstates their sum.
  keyword:Object.freeze(['bar','line','area']),
  // Different comparison lanes are not additive partitions.
  comparison:Object.freeze(['line','bar'])
});

// Decide the default by the question the statistic answers, not by the
// last chart selected on a different dimension. Manual choices remain valid.
export const STATISTIC_DEFAULT_CHART=Object.freeze({
  total:'line',
  source:'line',
  place:'bar',
  keyword:'bar',
  comparison:'line'
});

// Nine analytical intents. Renderers receive only data that matches the question;
// missing record-level values, targets or process stages are never fabricated.
export const STATISTIC_INTENTS=Object.freeze([
  Object.freeze(['compare','比大小']),
  Object.freeze(['trend','看趨勢']),
  Object.freeze(['composition','看組成']),
  Object.freeze(['compositionTrend','組成隨時間變化']),
  Object.freeze(['relationship','兩個數字的關係']),
  Object.freeze(['distribution','看分布']),
  Object.freeze(['ranking','看排名']),
  Object.freeze(['attainment','看達成率']),
  Object.freeze(['funnel','看流程流失'])
]);
const finiteMetric=value=>typeof value!=='boolean'&&value!==null&&value!==undefined&&
  value!==''&&Number.isFinite(Number(value))?Number(value):null;

export function recordScatterPair(records=[],fields=[],xKey='',yKey=''){
  const rows=Array.isArray(records)?records:[];
  const available=(Array.isArray(fields)?fields:[]).filter(field=>field?.key);
  const requestedX=available.find(field=>field.key===xKey);
  const requestedY=available.find(field=>field.key===yKey);
  const pairs=requestedX&&requestedY&&requestedX.key!==requestedY.key
    ?[[requestedX,requestedY]]
    :available.flatMap((left,index)=>available.slice(index+1).map(right=>[left,right]));
  for(const [xField,yField] of pairs){
    const data=rows.flatMap((row,index)=>{
      const x=finiteMetric(row?.[xField.key]),y=finiteMetric(row?.[yField.key]);
      if(x===null||y===null)return [];
      return [{
        x,y,recordId:String(row?.uid??row?.id??index),
        title:String(row?.title||row?.name||''),
        date:String(row?.date||row?.day||'').slice(0,10),
        source:row?.source??row?.site??null,
        place:row?.place??row?.place_id??null
      }];
    });
    if(data.length>=2&&new Set(data.map(row=>row.x)).size>1&&
      new Set(data.map(row=>row.y)).size>1)
      return {x:xField,y:yField,data};
  }
  return null;
}

export function compositionPercentages(distribution=[],maxVisible=7){
  const rows=normalizeDistribution(distribution)
    .sort((a,b)=>b.value-a.value||a.name.localeCompare(b.name));
  const total=rows.reduce((sum,row)=>sum+row.value,0);
  const limit=Math.max(2,Math.min(12,Math.trunc(Number(maxVisible)||7)));
  const visible=rows.slice(0,limit);
  const hidden=rows.slice(limit);
  const fields=[...visible];
  if(hidden.length)fields.push({
    key:'__composition_other',name:'其他',
    value:hidden.reduce((sum,row)=>sum+row.value,0),
    aggregated:true,sourceKeys:hidden.map(row=>row.key),items:hidden
  });
  return fields.map(row=>({...row,percent:total>0?row.value/total*100:0}));
}

// Keep the 100% denominator across every source category. To prevent a long
// legend from swallowing the chart, retain the seven largest series and group
// the rest as a truthful "其他" segment. The grouped segment remains inspectable.
export function compositionTrendRows(rows=[],series=[],maxVisible=7){
  const time=Array.isArray(rows)?rows:[];
  const fields=(Array.isArray(series)?series:[])
    .filter(field=>field?.key&&time.some(row=>finiteMetric(row?.[field.key])>0))
    .map(field=>({...field,total:time.reduce((sum,row)=>sum+Math.max(0,Number(row?.[field.key])||0),0)}))
    .sort((a,b)=>b.total-a.total||String(a.label||a.key).localeCompare(String(b.label||b.key)));
  if(fields.length<2)return {rows:[],fields:[]};
  const limit=Math.max(2,Math.min(12,Math.trunc(Number(maxVisible)||7)));
  const visible=fields.slice(0,limit);
  const hidden=fields.slice(limit);
  const outputFields=[
    ...visible.map((field,index)=>({...field,dataKey:'__composition_'+index,sourceKeys:[field.key]}))
  ];
  if(hidden.length)outputFields.push({
    key:'__composition_other',dataKey:'__composition_other',label:'其他',
    sourceKeys:hidden.map(field=>field.key),aggregated:true
  });
  const outputRows=time.map(row=>{
    const total=fields.reduce((sum,field)=>sum+Math.max(0,Number(row?.[field.key])||0),0);
    const output={...row};
    for(const field of outputFields){
      const raw=field.sourceKeys.reduce((sum,key)=>sum+Math.max(0,Number(row?.[key])||0),0);
      output[field.dataKey]=total>0?raw/total*100:0;
    }
    return output;
  });
  return {rows:outputRows,fields:outputFields};
}

export function histogramBins(values=[],requestedBins=0){
  const rows=(Array.isArray(values)?values:[]).flatMap((item,index)=>{
    const source=item&&typeof item==='object'?item:{value:item};
    const value=finiteMetric(source.value);
    return value===null?[]:[{
      ...source,value,recordId:String(source.uid??source.id??index),
      label:String(source.label||source.title||source.name||'')
    }];
  });
  if(!rows.length)return [];
  const {min,max}=rows.reduce((range,row)=>({
    min:Math.min(range.min,row.value),max:Math.max(range.max,row.value)
  }),{min:Infinity,max:-Infinity});
  if(min===max)return [{key:'bin:0',name:String(min),from:min,to:max,count:rows.length,items:rows}];
  const count=Math.max(2,Math.min(20,Math.trunc(Number(requestedBins)||Math.ceil(Math.sqrt(rows.length)))));
  const width=(max-min)/count;
  const bins=Array.from({length:count},(_,index)=>({
    key:'bin:'+index,from:min+width*index,to:index===count-1?max:min+width*(index+1),
    count:0,items:[]
  }));
  for(const row of rows){
    const index=Math.min(count-1,Math.floor((row.value-min)/width));
    bins[index].count++;
    bins[index].items.push(row);
  }
  return bins.filter(bin=>bin.count>0).map(bin=>({
    ...bin,name:bin.from.toLocaleString()+'–'+bin.to.toLocaleString()
  }));
}

export function normalizeFunnelStages(stages=[]){
  const rows=(Array.isArray(stages)?stages:[]).flatMap((stage,index)=>{
    const value=finiteMetric(stage?.value??stage?.count);
    const name=String(stage?.name||stage?.label||'').trim();
    return value===null||value<0||!name?[]:[{
      key:String(stage?.key??stage?.id??index),name,value
    }];
  });
  return rows.map((row,index)=>({
    ...row,
    conversionRate:index===0?100:(rows[index-1].value>0
      ?row.value/rows[index-1].value*100:0),
    dropOff:index===0?0:Math.max(0,rows[index-1].value-row.value),
    overallRate:rows[0]?.value>0?row.value/rows[0].value*100:0
  }));
}

export function resolveStatisticIntent({
  intent='trend',rows=[],series=[],distribution=[],mutuallyExclusive=false,seriesExclusive=false,
  records=[],recordFields=[],values=[],targetValue=null,attainmentValue=null,stages=[],totalKey=''
}={}){
  const time=Array.isArray(rows)?rows:[];
  const fields=nonemptySeries(time,series);
  const categories=normalizeDistribution(distribution,time,fields);
  const unavailable={intent,available:false,type:'',reason:'資料不足或不符合此分析意圖'};
  if(intent==='compare'){
    if(categories.length){
      const many=categories.length>6;
      return {
        intent,available:true,type:'bar',dataMode:'distribution',
        barLayout:many?'vertical':'horizontal',...(many?{sort:'desc'}:{})
      };
    }
    if(time.length&&(fields.length||(totalKey&&time.some(row=>finiteMetric(row?.[totalKey])!==null)))){
      const many=time.length>6;
      return {
        intent,available:true,type:'bar',dataMode:'time-comparison',
        barLayout:many?'vertical':'horizontal',...(many?{sort:'desc'}:{})
      };
    }
    return unavailable;
  }
  if(intent==='trend')return time.length&&(fields.length||(totalKey&&time.some(row=>finiteMetric(row?.[totalKey])!==null)))?{
    intent,available:true,type:time.length>=6?'line':'bar',dataMode:'time'
  }:unavailable;
  if(intent==='composition')return mutuallyExclusive&&categories.length>=2?{
    intent,available:true,type:'composition',dataMode:'distribution',
    barLayout:'vertical',normalization:'percent'
  }:unavailable;
  if(intent==='compositionTrend')return (seriesExclusive||mutuallyExclusive)&&time.length>0&&fields.length>=2?{
    intent,available:true,type:'compositionTrend',dataMode:'time',
    barLayout:'horizontal',normalization:'percent'
  }:unavailable;
  if(intent==='relationship'){
    const pair=recordScatterPair(records,recordFields);
    return pair?{intent,available:true,type:'scatter',dataMode:'records',pair}:unavailable;
  }
  if(intent==='distribution'){
    const observations=Array.isArray(values)?values:[];
    const bins=histogramBins(observations);
    return observations.length>=2&&bins.length
      ?{intent,available:true,type:'histogram',dataMode:'bins',bins}:unavailable;
  }
  if(intent==='ranking')return categories.length?{
    intent,available:true,type:'bar',dataMode:'distribution',
    barLayout:'vertical',sort:'desc',highlightTop:3
  }:unavailable;
  if(intent==='attainment'){
    const actual=finiteMetric(attainmentValue);
    const target=finiteMetric(targetValue);
    return actual!==null&&actual>=0&&target!==null&&target>0?{
      intent,available:true,type:'attainment',dataMode:'attainment',
      actual,target,ratio:actual/target*100
    }:unavailable;
  }
  if(intent==='funnel'){
    const normalized=normalizeFunnelStages(stages);
    return normalized.length>=2&&normalized[0].value>0?{
      intent,available:true,type:'funnel',dataMode:'stages',stages:normalized
    }:unavailable;
  }
  return unavailable;
}

export function availableStatisticIntents(data={}){
  return STATISTIC_INTENTS.map(([intent])=>intent)
    .filter(intent=>resolveStatisticIntent({...data,intent}).available);
}

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
  // for exclusive source categories; never for overlapping keywords.
  return preferred.filter(type=>possible.has(type)&&
    !(type==='pie'&&categories.length>6))
    .map(type=>[type,possible.get(type)]);
}
