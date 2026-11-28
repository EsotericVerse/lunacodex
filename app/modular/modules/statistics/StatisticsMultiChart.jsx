'use client';

import {cloneElement,useMemo,useState} from 'react';
import {motion,useReducedMotion} from 'motion/react';
import {useAsyncResource} from '../../../../packages/zenstack/client-queries';
import {UI_COPY} from '../../../i18n/ui-copy';
import {RUNE_RANKING_PAGE_SIZE,availableStatisticChartTypes,nonemptySeries,normalizeDistribution,movingAverage,scatterPair,recordScatterPair,compositionTrendRows,resolveStatisticIntent,radarPeriodComparison,activePeriodCoverage,number,color as baseColor,pointColor as basePointColor} from './statistics-time-zoom.mjs';
import {themedDataColor} from '../../visual-palette.mjs';
export {STAT_VISUAL_TYPES,availableStatisticChartTypes} from './statistics-time-zoom.mjs';
import {useUiLocale,useUiSection} from '../../../i18n/ui-locale';
import UiText,{useUiText} from '../../../i18n/UiText';
import StatisticsDetails from './StatisticsDetails';
import {
  Area,AreaChart,Bar,BarChart,Brush,CartesianGrid,Cell,ComposedChart,
  Funnel,FunnelChart,LabelList,Legend,Line,LineChart,Pie,PieChart,PolarAngleAxis,PolarGrid,
  PolarRadiusAxis,Radar,RadarChart,RadialBar,RadialBarChart,ReferenceLine,
  ResponsiveContainer,Scatter,ScatterChart,Tooltip,Treemap,XAxis,YAxis
} from 'recharts';

const CHART_ACCENT='var(--loc-accent)';
const CHART_TEXT='var(--loc-text)';
const CHART_GRID='var(--loc-line)';
const GRID='var(--loc-line)',TEXT='var(--loc-text)',DAY=86400000;
const color=i=>themedDataColor(baseColor(i));
const pointColor=i=>themedDataColor(basePointColor(i));
function ThemedChartTooltip({active,payload=[],label,suffix='',multiplier=1}){
  if(!active||!payload.length)return null;
  const entries=payload.filter(entry=>entry?.value!==undefined&&entry?.value!==null);
  if(!entries.length)return null;
  const heading=label||entries[0]?.payload?.period||'';
  return <div className="scope-multichart-tooltip">
    {heading?<strong>{heading}</strong>:null}
    {entries.map((entry,index)=><div className="scope-multichart-tooltip__row"
      key={String(entry.dataKey||entry.name||index)}
      style={{'--chart-tip-color':entry.color||entry.fill||pointColor(index)}}>
      <span>{entry.name||entry.dataKey||'數值'}</span>
      <b>{typeof entry.value==='number'?(entry.value*multiplier).toLocaleString(undefined,{maximumFractionDigits:1})+suffix:String(entry.value)}</b>
    </div>)}
  </div>;
}
function StatTreemapCell({x,y,width,height,depth,index,fill,name}){
  if(!depth||width<=0||height<=0)return null;
  const label=String(name||'');
  return <g><rect x={x} y={y} width={width} height={height} rx={2}
    fill={fill||pointColor(index||0)} stroke="var(--loc-panel)" strokeWidth={1.5}/>
    {width>=70&&height>=23?<text x={x+width/2} y={y+height/2}
      textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={600}
      fill="var(--loc-text)" stroke="var(--loc-panel)" strokeWidth={2.5} paintOrder="stroke">
      {label.slice(0,Math.max(3,Math.floor(width/12)))}</text>:null}
    <title>{label}</title></g>;
}

// Display-only compression: one marked gap, never an invented zero-count data point.
export function foldEmptyTimeBuckets(rows=[],series=[],units={}){
  const dayUnit=units.dayUnit??UI_COPY.uiExtra.chartLabels.dayUnit;
  const periodUnit=units.periodUnit??UI_COPY.uiExtra.chartLabels.periodUnit;
  const list=Array.isArray(rows)?rows:[],out=[],gaps=[];
  for(let i=0;i<list.length;){
    if(series.some(s=>number(list[i]?.[s.key])>0)){out.push(list[i]);i++;continue;}
    let j=i;while(j<list.length&&!series.some(s=>number(list[j]?.[s.key])>0))j++;
    if(i===0||j===list.length||j-i<3){out.push(...list.slice(i,j));i=j;continue;}
    const begin=String(list[i].start_date||'').slice(0,10);
    const end=String(list[j-1].end_date||list[j-1].start_date||'').slice(0,10);
    const from=Date.parse(begin),to=Date.parse(end);
    const days=Number.isFinite(from)&&Number.isFinite(to)?Math.max(1,Math.round((to-from)/DAY)+1):null;
    out.push({period:'∥ '+(days?days+' '+dayUnit:(j-i)+' '+periodUnit),start_date:begin,end_date:end,folded:true,
      ...Object.fromEntries(series.map(s=>[s.key,null]))});
    gaps.push({start:begin,end,days,buckets:j-i});
    i=j;
  }
  return {rows:out,gaps};
}
export default function StatisticsMultiChart({
  type='line',intent='legacy',rows=[],series=[],distribution=[],totalKey='',height=380,foldBlank=false,
  barLayout:legacyBarLayout='horizontal',records=[],recordFields=[],values=[],
  targetValue=null,attainmentValue=null,attainmentLabel='達成率',funnelStages=[],
  mutuallyExclusive=false,seriesExclusive=false,
  onCategoryClick=null,onSeriesClick=null,onPeriodClick=null,onDatumClick=null,
  selectedPeriodKey='',activeCategoryKey=''
}){
  useUiSection('uiExtra.statisticsView');
  useUiSection('uiExtra.chartLabels');
  const {locale}=useUiLocale();
  const reduceMotion=useReducedMotion();
  const t=useUiText();
  const units={dayUnit:t('uiExtra.chartLabels.dayUnit'),periodUnit:t('uiExtra.chartLabels.periodUnit')};
  const time=Array.isArray(rows)?rows:[];
  const fields=useMemo(()=>nonemptySeries(time,series),[time,series]);
  const categories=useMemo(()=>normalizeDistribution(distribution,time,fields),[distribution,time,fields]);
  const intentConfig=useMemo(()=>intent==='legacy'?null:resolveStatisticIntent({
    intent,rows:time,series:fields,distribution:categories,mutuallyExclusive,seriesExclusive,
    records,recordFields,values,targetValue,attainmentValue,stages:funnelStages,totalKey
  }),[intent,time,fields,categories,mutuallyExclusive,records,recordFields,values,
    targetValue,attainmentValue,funnelStages,seriesExclusive,totalKey]);
  const usable=availableStatisticChartTypes({rows:time,series:fields,distribution:categories,totalKey});
  const actual=intentConfig
    ?(intentConfig.available?intentConfig.type:'')
    :(usable.some(([id])=>id===type)?type:(usable[0]?.[0]||'line'));
  const renderMode=intentConfig?.dataMode||'legacy';
  const barLayout=intentConfig?.barLayout||legacyBarLayout;
  const displayCategories=useMemo(()=>{
    const output=[...categories];
    if(intentConfig?.sort==='desc')
      output.sort((a,b)=>b.value-a.value||a.name.localeCompare(b.name));
    return output;
  },[categories,intentConfig?.sort]);
  const animateData=!reduceMotion&&time.length*Math.max(1,fields.length)<=600&&displayCategories.length<=100;
  const animation={isAnimationActive:animateData,animationDuration:480,animationEasing:'ease-out'};
  const timeFields=totalKey?[{key:totalKey,label:t('uiExtra.chartLabels.total')}]:fields;
  const scatterFields=intent==='relationship'?(Array.isArray(recordFields)?recordFields:[]):fields;
  const [scatterAxisKeys,setScatterAxisKeys]=useState({x:'',y:''});
  const defaultPair=useMemo(()=>intent==='relationship'
    ?(intentConfig?.pair||recordScatterPair(records,scatterFields))
    :scatterPair(time,fields),[intent,intentConfig?.pair,records,scatterFields,time,fields]);
  const scatterX=scatterFields.find(field=>field.key===scatterAxisKeys.x)||defaultPair?.x||scatterFields[0]||null;
  const scatterY=scatterFields.find(field=>field.key===scatterAxisKeys.y&&field.key!==scatterX?.key)
    ||(defaultPair?.y?.key!==scatterX?.key?defaultPair?.y:null)
    ||scatterFields.find(field=>field.key!==scatterX?.key)||null;
  const paired=useMemo(()=>intent==='relationship'
    ?(scatterX&&scatterY?recordScatterPair(records,scatterFields,scatterX.key,scatterY.key):null)
    :(scatterX&&scatterY?scatterPair(time,fields,scatterX.key,scatterY.key):null),
    [intent,records,scatterFields,scatterX?.key,scatterY?.key,time,fields]);
  const axisLabel=field=>[field?.label||field?.key,field?.unit].filter(Boolean).join(' · ');
  const foldSeries=actual==='compositionTrend'?(Array.isArray(series)?series:[]):timeFields;
  const {rows:display,gaps}=useMemo(()=>foldBlank&&
    ['line','bar','area','stacked','composed','compositionTrend'].includes(actual)
      ?foldEmptyTimeBuckets(time,foldSeries,units):{rows:time,gaps:[]},
    [foldBlank,actual,time,foldSeries,timeFields,locale]);
  const margin={top:16,right:18,bottom:44,left:0};
  const axes=(<><CartesianGrid stroke={GRID} strokeDasharray="3 3"/>
    <XAxis dataKey="period" tick={{fill:TEXT,fontSize:11}} angle={-20} textAnchor="end"
      height={64} interval="preserveStartEnd" stroke={GRID}/>
    <YAxis tick={{fill:TEXT,fontSize:11}} allowDecimals={false} stroke={GRID}/>
    {selectedPeriodKey?<ReferenceLine x={selectedPeriodKey} stroke={CHART_ACCENT}
      strokeWidth={2.5} strokeDasharray="5 3"
      label={{value:'已選時段',position:'insideTopRight',fill:TEXT,fontSize:10}}/>:null}
    <Tooltip content={<ThemedChartTooltip/>}/>
    {display.length>32?<Brush dataKey="period" height={24} travellerWidth={9} stroke={CHART_ACCENT}/>:null}
    {fields.length>1&&!['bar','composed','compositionTrend'].includes(actual)
      ?<Legend wrapperStyle={{fontSize:12}}/>:null}
  </>);
  const selectedCategoryKeys=new Set(Array.isArray(activeCategoryKey)
    ?activeCategoryKey.map(String):activeCategoryKey?[String(activeCategoryKey)]:[]);
  const timeComparison=useMemo(()=>time.map((row,index)=>({
    key:String(row.period||index),name:String(row.period||index),
    value:totalKey?number(row[totalKey]):fields.reduce((sum,field)=>sum+number(row[field.key]),0),
    period:row.period,start_date:row.start_date,end_date:row.end_date,raw:row
  })).filter(row=>row.value>0).sort((a,b)=>b.value-a.value||a.name.localeCompare(b.name)),
    [time,fields,totalKey]);
  const comparisonCategories=renderMode==='time-comparison'?timeComparison:displayCategories;
  const colored=comparisonCategories.map((item,i)=>({...item,
    fill:item.fill?themedDataColor(item.fill):pointColor(i),
    active:selectedCategoryKeys.has(String(item.key))}));
  const comparison=useMemo(()=>radarPeriodComparison(time,fields),[time,fields]);
  const coverage=useMemo(()=>activePeriodCoverage(time,fields),[time,fields]);
  // Calculate averages on the original, complete timeline before shortening gaps.
  const composed=useMemo(()=>{
    const full=movingAverage(time,fields,totalKey);
    return foldBlank?foldEmptyTimeBuckets(full,timeFields,units).rows:full;
  },[time,fields,totalKey,foldBlank,timeFields,locale]);
  const distributionData=useMemo(()=>colored.map((item,index)=>({
    ...item,__index:index
  })),[colored]);
  const compositionFields=useMemo(()=>{
    const total=colored.reduce((sum,item)=>sum+item.value,0);
    return colored.map((item,index)=>({
      ...item,dataKey:'__composition_'+index,
      percent:total>0?item.value/total*100:0
    }));
  },[colored]);
  const compositionRow=useMemo(()=>Object.fromEntries([
    ['period','全部'],...compositionFields.map(item=>[item.dataKey,item.percent])
  ]),[compositionFields]);
  const compositionTrend=useMemo(()=>compositionTrendRows(display,series),
    [display,series]);
  const histogram=intentConfig?.bins||[];
  const funnel=intentConfig?.stages||[];
  const isDistribution=renderMode==='distribution'||renderMode==='time-comparison'||
    (intent==='legacy'&&actual==='bar'&&legacyBarLayout==='vertical'&&categories.length>0);
  const highlightTop=Number(intentConfig?.highlightTop||0);
  const [selectedDatum,setSelectedDatum]=useState(null);
  const emitDatum=(datum)=>{
    if(!datum)return;
    if(['record','bin','attainment','stage','other-categories'].includes(datum.kind))
      setSelectedDatum(datum);
    else setSelectedDatum(null);
    onDatumClick?.(datum);
  };
  const categoryClick=item=>{
    if(!item)return;
    if(renderMode==='time-comparison'&&item.raw){
      onPeriodClick?.(item.raw);
      emitDatum({intent,kind:'period',...item.raw});
      return;
    }
    onCategoryClick?.(item.key);
    emitDatum({intent,kind:'category',...item});
  };
  const seriesClick=key=>{
    onSeriesClick?.(key);
    emitDatum({intent,kind:'series',key});
  };
  const periodInteractive=Boolean(onPeriodClick&&
    ['line','bar','area','stacked','composed','compositionTrend','scatter'].includes(actual)&&
    !isDistribution&&intent!=='relationship');
  const handleChartClick=event=>{
    const row=event?.activePayload?.find(entry=>entry?.payload)?.payload;
    if(row&&!row.folded&&periodInteractive){
      onPeriodClick?.(row);
      emitDatum({intent,kind:'period',...row});
    }
  };
  const barClick=(index)=>{
    const item=distributionData[index];
    categoryClick(item);
  };
  const handleCompositionSegment=(field,event,index)=>{
    const row=event?.payload||display[index]||{};
    if(field.aggregated){
      const items=field.sourceKeys.map(key=>{
        const source=(Array.isArray(series)?series:[]).find(item=>item.key===key);
        return {key,name:source?.label||key,value:number(row[key])};
      }).filter(item=>item.value>0);
      emitDatum({intent,kind:'other-categories',period:row.period,items});
      return;
    }
    seriesClick(field.key);
  };
  const selectedDatumTitle=selectedDatum?.kind==='record'?'單筆紀錄':
    selectedDatum?.kind==='bin'?'分布區間明細':
    selectedDatum?.kind==='attainment'?'達成率明細':
    selectedDatum?.kind==='stage'?'流程階段明細':'其他分類明細';
  const selectedDatumRows=selectedDatum?.kind==='record'?[
    ['紀錄',selectedDatum.title||selectedDatum.recordId],
    ['日期',selectedDatum.date||'—'],['來源',selectedDatum.source||'—'],
    ['地點',selectedDatum.place||'—']
  ]:selectedDatum?.kind==='bin'?[
    ['區間',selectedDatum.name],['下界',selectedDatum.from],
    ['上界',selectedDatum.to],['筆數',selectedDatum.count]
  ]:selectedDatum?.kind==='attainment'?[
    ['實際值',selectedDatum.actual],['目標值',selectedDatum.target],
    ['達成率',Number(selectedDatum.ratio||0).toFixed(1)+'%'],
    ['差額',Number(selectedDatum.actual||0)-Number(selectedDatum.target||0)]
  ]:selectedDatum?.kind==='stage'?[
    ['階段',selectedDatum.name],['筆數',selectedDatum.value],
    ['相較前一階段',Number(selectedDatum.conversionRate||0).toFixed(1)+'%'],
    ['相較起始階段',Number(selectedDatum.overallRate||0).toFixed(1)+'%'],
    ['流失數',Number(selectedDatum.dropOff||0)]
  ]:[];

  let chart=null;
  if(actual==='pie')chart=<PieChart>
    <Tooltip content={<ThemedChartTooltip/>}/><Legend wrapperStyle={{fontSize:11}}/>
    <Pie {...animation} data={colored} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius="73%">
      {colored.map(item=><Cell key={item.key} fill={item.fill}
        onClick={()=>categoryClick(item)}/>)}
    </Pie>
  </PieChart>;
  else if(actual==='treemap')chart=<Treemap data={colored.map(item=>({...item,size:item.value}))}
    dataKey="size" nameKey="name" stroke="var(--loc-bg)"
    content={props=><StatTreemapCell {...props}
      fill={colored[props.index]?.fill||pointColor(props.index||0)}/>}
    aspectRatio={4/3}>
      <Tooltip content={<ThemedChartTooltip/>}/>
    </Treemap>;
  else if(actual==='radar'&&comparison)chart=<RadarChart data={comparison} outerRadius="67%">
    <PolarGrid stroke={GRID}/><PolarAngleAxis dataKey="name" tick={{fill:TEXT,fontSize:11}}/>
    <PolarRadiusAxis domain={[0,100]} tick={{fill:TEXT,fontSize:10}}/>
    <Radar {...animation} name={t('uiExtra.chartLabels.firstHalf')} dataKey="early" stroke={color(0)} fill={color(0)} strokeWidth={3} fillOpacity={.10}/>
    <Radar {...animation} name={t('uiExtra.chartLabels.lastHalf')} dataKey="late" stroke={color(3)} fill={color(3)} strokeDasharray="7 4" strokeWidth={3} fillOpacity={.10}/>
    <Legend/><Tooltip content={<ThemedChartTooltip suffix="%"/>} formatter={v=>Number(v).toFixed(1)+'%'}/>
  </RadarChart>;
  else if(actual==='radial'&&coverage)chart=<RadialBarChart data={coverage.map((row,i)=>({...row,fill:color(i)}))} innerRadius="16%" outerRadius="82%" startAngle={90} endAngle={-270}>
    <RadialBar {...animation} dataKey="value" background={{fill:'var(--loc-panel-2)'}} cornerRadius={4}>
      {coverage.map((row,i)=><Cell key={row.name} fill={color(i)}/>)}
    </RadialBar>
    <Legend layout="vertical" verticalAlign="middle" align="right" wrapperStyle={{fontSize:11}}/>
    <Tooltip content={<ThemedChartTooltip suffix="%"/>} formatter={v=>Number(v).toFixed(1)+'%'}/>
  </RadialBarChart>;
  else if(actual==='composition')chart=<BarChart data={[compositionRow]} layout="vertical"
    stackOffset="expand" margin={{top:22,right:18,bottom:20,left:18}}>
    <CartesianGrid stroke={GRID} strokeDasharray="3 3"/>
    <XAxis type="number" domain={[0,100]} tickFormatter={value=>Math.round(Number(value))+'%'}
      tick={{fill:TEXT,fontSize:11}} stroke={GRID}/>
    <YAxis dataKey="period" type="category" width={72} tick={{fill:TEXT,fontSize:11}} stroke={GRID}/>
    <Tooltip content={<ThemedChartTooltip suffix="%"/>}/>
    <Legend wrapperStyle={{fontSize:11}}/>
    {compositionFields.map((item,index)=><Bar key={item.key} {...animation}
      dataKey={item.dataKey} name={item.name} stackId="composition" fill={color(index)}
      onClick={()=>categoryClick(item)}>
      <Cell fill={color(index)}/>
    </Bar>)}
  </BarChart>;
  else if(actual==='compositionTrend')chart=<BarChart data={compositionTrend.rows} margin={margin}>
    <CartesianGrid stroke={GRID} strokeDasharray="3 3"/>
    <XAxis dataKey="period" tick={{fill:TEXT,fontSize:11}} angle={-20} textAnchor="end"
      height={64} interval="preserveStartEnd" stroke={GRID}/>
    <YAxis type="number" domain={[0,100]} tickFormatter={value=>Math.round(Number(value))+'%'}
      tick={{fill:TEXT,fontSize:11}} stroke={GRID}/>
    <Tooltip content={<ThemedChartTooltip suffix="%"/>}/>
    <Legend wrapperStyle={{fontSize:11}}/>
    {compositionTrend.fields.map((field,index)=><Bar key={field.key} {...animation}
      dataKey={field.dataKey} name={field.label} stackId="composition" fill={color(index)}
      onClick={(event,entryIndex)=>handleCompositionSegment(field,event,entryIndex)}/>)}
  </BarChart>;
  else if(actual==='scatter'&&paired)chart=<ScatterChart margin={{top:20,right:20,bottom:45,left:20}}>
    <CartesianGrid stroke={GRID} strokeDasharray="3 3"/>
    <XAxis type="number" dataKey="x" name={axisLabel(paired.x)} tick={{fill:TEXT,fontSize:11}} stroke={GRID}
      label={{value:axisLabel(paired.x),position:'insideBottom',offset:-16,fill:TEXT}}/>
    <YAxis type="number" dataKey="y" name={axisLabel(paired.y)} tick={{fill:TEXT,fontSize:11}} stroke={GRID}
      label={{value:axisLabel(paired.y),angle:-90,position:'insideLeft',fill:TEXT}}/>
    <Tooltip cursor={{strokeDasharray:'3 3'}} content={({active,payload})=>{
      const point=payload?.[0]?.payload;
      return active&&point?<div className="scope-multichart-tooltip">
        <strong>{point.title||point.period||point.recordId||'單筆紀錄'}</strong>
        <div className="scope-multichart-tooltip__row" style={{'--chart-tip-color':color(0)}}>
          <span>{axisLabel(paired.x)}</span><b>{point.x.toLocaleString()} {paired.x.unit||''}</b>
        </div>
        <div className="scope-multichart-tooltip__row" style={{'--chart-tip-color':color(3)}}>
          <span>{axisLabel(paired.y)}</span><b>{point.y.toLocaleString()} {paired.y.unit||''}</b>
        </div>
      </div>:null;
    }}/>
    <Scatter {...animation} name={axisLabel(paired.x)+' × '+axisLabel(paired.y)} data={paired.data} fill={pointColor(0)}>
      {paired.data.map((row,i)=><Cell key={row.recordId||row.period||i} fill={pointColor(i)}
        onClick={()=>emitDatum({intent,kind:intent==='relationship'?'record':'period',...row})}/>)}
    </Scatter>
  </ScatterChart>;
  else if(actual==='histogram')chart=<BarChart data={histogram} margin={margin} barCategoryGap={0}>
    <CartesianGrid stroke={GRID} strokeDasharray="3 3"/>
    <XAxis dataKey="name" tick={{fill:TEXT,fontSize:10}} interval="preserveStartEnd" stroke={GRID}/>
    <YAxis allowDecimals={false} tick={{fill:TEXT,fontSize:11}} stroke={GRID}/>
    <Tooltip content={<ThemedChartTooltip/>}/>
    <Bar {...animation} dataKey="count" name="筆數" fill={color(0)}
      onClick={(_,index)=>emitDatum({intent,kind:'bin',...histogram[index]})}>
      {histogram.map((bin,index)=><Cell key={bin.key} fill={color(0)} opacity={.9-index*.015}/>)}
    </Bar>
  </BarChart>;
  else if(actual==='attainment'&&intentConfig)chart=<BarChart
    data={[{name:attainmentLabel,value:intentConfig.actual}]} layout="vertical"
    margin={{top:24,right:28,bottom:20,left:18}}>
    <CartesianGrid stroke={GRID} strokeDasharray="3 3"/>
    <XAxis type="number" domain={[0,Math.max(intentConfig.target,intentConfig.actual)*1.12]}
      tick={{fill:TEXT,fontSize:11}} stroke={GRID}/>
    <YAxis dataKey="name" type="category" width={92} tick={{fill:TEXT,fontSize:11}} stroke={GRID}/>
    <Tooltip content={<ThemedChartTooltip/>}/>
    <ReferenceLine x={intentConfig.target} stroke={color(3)} strokeWidth={2.5}
      strokeDasharray="5 3" label={{value:'目標',position:'insideTopRight',fill:TEXT,fontSize:11}}/>
    <Bar {...animation} dataKey="value" name="實際值" fill={color(0)} maxBarSize={34}
      onClick={()=>emitDatum({intent,kind:'attainment',actual:intentConfig.actual,
        target:intentConfig.target,ratio:intentConfig.ratio})}/>
  </BarChart>;
  else if(actual==='funnel'&&funnel.length)chart=<FunnelChart>
    <Tooltip content={<ThemedChartTooltip/>}/>
    <Funnel {...animation} dataKey="value" nameKey="name" data={funnel}>
      {funnel.map((stage,index)=><Cell key={stage.key} fill={color(index)}
        onClick={()=>emitDatum({intent,kind:'stage',...stage})}/>)}
      <LabelList dataKey="name" position="right" content={props=>{
        const {x=0,y=0,payload={}}=props||{};
        const conversion=Number(payload.conversionRate||0).toFixed(1);
        return <text x={x} y={y} dx={5} dy={4} fill={TEXT} fontSize={11}>
          {String(payload.name||'')} · {Number(payload.value||0).toLocaleString()} · {conversion}%
        </text>;
      }}/>
    </Funnel>
  </FunnelChart>;
  else if(actual==='composed')chart=<ComposedChart data={composed} margin={margin}>
    <CartesianGrid stroke={GRID} strokeDasharray="3 3"/>
    <XAxis dataKey="period" tick={{fill:TEXT,fontSize:11}} angle={-20} textAnchor="end" height={64} interval="preserveStartEnd" stroke={GRID}/>
    <YAxis tick={{fill:TEXT,fontSize:11}} allowDecimals={false} stroke={GRID}/>
    <Tooltip content={<ThemedChartTooltip/>}/><Legend/>
    {composed.length>32?<Brush dataKey="period" height={24} travellerWidth={9} stroke={CHART_ACCENT}/>:null}
    <Bar {...animation} dataKey="__stat_total" name={t('uiExtra.chartLabels.periodTotal')} fill={color(0)} opacity={.8} maxBarSize={30}>
      {composed.map((_,i)=><Cell key={i} fill={pointColor(i)}/>)}
    </Bar>
    <Line {...animation} dataKey="__stat_average" name={t('uiExtra.chartLabels.movingAverage')} stroke={color(3)} strokeWidth={3} strokeDasharray="8 4" dot={false} connectNulls={false}/>
  </ComposedChart>;
  else if(actual==='stacked')chart=<AreaChart data={display} margin={margin}>
    {axes}{fields.map((f,i)=><Area key={f.key} type="linear" dataKey={f.key} name={f.label} stackId="parts"
      stroke={color(i)} fill={color(i)} fillOpacity={.65} connectNulls={false} {...animation}/>)}
  </AreaChart>;
  else if(actual==='area')chart=<AreaChart data={display} margin={margin}>
    {axes}{timeFields.map((f,i)=><Area key={f.key} type="linear" dataKey={f.key} name={f.label}
      stroke={color(i)} fill={color(i)} fillOpacity={.25} connectNulls={false} {...animation}/>)}
  </AreaChart>;
  else if(actual==='bar'&&isDistribution&&barLayout==='vertical')chart=<BarChart data={distributionData}
    layout="vertical" margin={{top:10,right:20,bottom:14,left:6}}>
    <CartesianGrid strokeDasharray="3 3" stroke={GRID}/>
    <XAxis type="number" allowDecimals={false} tick={{fill:TEXT}}/>
    <YAxis dataKey="name" type="category" width={150} tick={{fill:TEXT,fontSize:11}}
      tickFormatter={value=>String(value).length>12?String(value).slice(0,11)+'…':value}/>
    <Tooltip content={<ThemedChartTooltip/>}/>
    <Bar {...animation} dataKey="value" name="數量" maxBarSize={28}
      cursor={onCategoryClick||onDatumClick?'pointer':undefined}
      onClick={(_,index)=>barClick(index)}>
      {distributionData.map((item,index)=><Cell key={item.key}
        fill={highlightTop?(index<highlightTop?'var(--loc-heading)':'var(--loc-muted)'):item.fill}
        opacity={activeCategoryKey&&!item.active?0.42:1}
        stroke={item.active?'var(--loc-heading)':'var(--loc-panel)'}
        strokeWidth={item.active?2.5:1}/>)}
    </Bar>
  </BarChart>;
  else if(actual==='bar'&&isDistribution)chart=<BarChart data={distributionData} margin={{top:14,right:18,bottom:52,left:0}}>
    <CartesianGrid stroke={GRID} strokeDasharray="3 3"/>
    <XAxis dataKey="name" tick={{fill:TEXT,fontSize:11}}
      angle={distributionData.length>6?-20:0} textAnchor="end"
      height={distributionData.length>6?64:34} interval="preserveStartEnd" stroke={GRID}/>
    <YAxis type="number" allowDecimals={false} tick={{fill:TEXT,fontSize:11}} stroke={GRID}/>
    <Tooltip content={<ThemedChartTooltip/>}/>
    <Bar {...animation} dataKey="value" name="數量" fill={color(0)} maxBarSize={38}
      cursor={onCategoryClick||onDatumClick?'pointer':undefined}
      onClick={(_,index)=>barClick(index)}>
      {distributionData.map((item,index)=><Cell key={item.key}
        fill={highlightTop?(index<highlightTop?'var(--loc-heading)':'var(--loc-muted)'):item.fill}
        opacity={activeCategoryKey&&!item.active?0.42:1}
        stroke={item.active?'var(--loc-heading)':'var(--loc-panel)'}
        strokeWidth={item.active?2.5:1}/>)}
    </Bar>
  </BarChart>;
  else if(actual==='bar')chart=<BarChart data={display} margin={margin}>
    {axes}{timeFields.map((f,i)=><Bar {...animation} key={f.key} dataKey={f.key} name={f.label} fill={color(i)} maxBarSize={32}
      cursor={onSeriesClick?'pointer':undefined} onClick={()=>seriesClick(f.key)}>
      {display.map((_,j)=><Cell key={j} fill={timeFields.length===1?pointColor(j):color(i)}/>)}
    </Bar>)}
  </BarChart>;
  else chart=<LineChart data={display} margin={margin}>
    {axes}{timeFields.map((f,i)=><Line key={f.key} type="linear" dataKey={f.key} name={f.label}
      stroke={color(i)} strokeWidth={2.5}
      dot={display.length<25?{r:3,fill:color(i),stroke:'var(--loc-panel)',strokeWidth:1}:false} connectNulls={false}
      activeDot={onSeriesClick?{onClick:()=>seriesClick(f.key)}:undefined}
      {...animation}/>)}
  </LineChart>;
  const canRender=intent==='legacy'?Boolean(usable.length):Boolean(intentConfig?.available);
  if(!canRender||!chart)return <p className="scope-status">{t('uiExtra.chartLabels.noComparable')}</p>;
  const relationshipControls=actual==='scatter'&&scatterFields.length>1&&paired;
  const usesResponsiveContainer=['treemap','funnel'].includes(actual);
  return <div className="scope-multichart" role="group" aria-label={t('uiExtra.chartLabels.chartAria')}>
    {relationshipControls?<div className="scope-multichart-axis-controls" role="group" aria-label="散佈圖座標單位">
      <label>X 軸
        <select className="scope-select" value={scatterX?.key||''} onChange={event=>{
          const key=event.target.value;
          setScatterAxisKeys(current=>({x:key,y:current.y===key
            ?scatterFields.find(field=>field.key!==key)?.key||'':current.y}));
        }}>
          {scatterFields.map(field=><option key={field.key} value={field.key}>{axisLabel(field)}</option>)}
        </select>
      </label>
      <label>Y 軸
        <select className="scope-select" value={scatterY?.key||''} onChange={event=>{
          const key=event.target.value;
          setScatterAxisKeys(current=>({x:current.x===key
            ?scatterFields.find(field=>field.key!==key)?.key||'':current.x,y:key}));
        }}>
          {scatterFields.map(field=><option key={field.key} value={field.key} disabled={field.key===scatterX?.key}>{axisLabel(field)}</option>)}
        </select>
      </label>
    </div>:null}
    {/* Recharts owns SVG geometry, data animation and hit targets. Motion only
        fades the stable-size chart surface when its visualization type changes.
        No overlapping ResponsiveContainers or layout measurements. */}
    <motion.div key={actual} className="scope-multichart-motion-surface"
      data-linkable={periodInteractive||onCategoryClick||onSeriesClick||onDatumClick?'true':undefined}
      initial={reduceMotion?false:{opacity:0,y:6}}
      animate={{opacity:1,y:0}}
      transition={{duration:reduceMotion?0:.22,ease:'easeOut'}}
      style={{height}}>
      {usesResponsiveContainer
        ?<ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer>
        :cloneElement(chart,{responsive:true,style:{width:'100%',height:'100%'},
          ...(periodInteractive?{onClick:handleChartClick}:{})})}
    </motion.div>
    {selectedDatum?<section className="scope-self-intersection-selected" aria-live="polite">
      <header className="statistics-dashboard__panel-heading">
        <h4>{selectedDatumTitle}</h4>
        <button type="button" className="loc-button loc-button--small"
          onClick={()=>setSelectedDatum(null)}>清除選取</button>
      </header>
      {selectedDatum.period?<p className="scope-status">{selectedDatum.period}</p>:null}
      {selectedDatumRows.length?<div className="scope-ranking">
        {selectedDatumRows.map(([label,value])=><div key={label}>
          <strong>{label}</strong><span>{value??'—'}</span>
        </div>)}
      </div>:null}
      {selectedDatum.kind==='record'?<div className="scope-ranking">
        <div><strong>X · {axisLabel(paired?.x)}</strong><span>{selectedDatum.x?.toLocaleString?.()??selectedDatum.x}</span></div>
        <div><strong>Y · {axisLabel(paired?.y)}</strong><span>{selectedDatum.y?.toLocaleString?.()??selectedDatum.y}</span></div>
      </div>:null}
      {selectedDatum.items?.length?<div className="scope-ranking">
        {selectedDatum.items.slice(0,30).map(item=><div key={item.recordId||item.key||item.label}>
          <strong>{item.name||item.label||item.title||item.recordId}</strong>
          <span>{item.value??item.date??''}</span>
        </div>)}
      </div>:null}
    </section>:null}
    {intent==='relationship'?<p className="scope-status" role="note">
      每個點代表一筆紀錄；散布圖呈現數值關聯，不代表因果關係。
    </p>:null}
    {foldBlank&&gaps.length?<p className="scope-status" role="note">
      {t('uiExtra.chartLabels.gapLabel')}{gaps.map(g=>g.start+'～'+g.end+'（'+(g.days||g.buckets)+' '+(g.days?units.dayUnit:units.periodUnit)+'）').join(t('uiExtra.chartLabels.gapSeparator'))}
    </p>:null}
  </div>;
}

// Saved keyword classifications are sufficient to build group trends.
// Item totals have no dated breakdown in this response; never fabricate one.
function keywordGroupTrend(classifications=[],groups=[],bucket='month'){
  const known=new Set(groups.map(row=>String(row.group_uid)));
  const dates=new Map();
  for(const row of classifications){
    const day=String(row?.date||'').slice(0,10);
    const id=String(row?.group_uid??'');
    const count=Number(row?.count)||0;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!known.has(id)||count<=0)continue;
    const key=bucket==='day'?day:bucket==='year'?day.slice(0,4):bucket==='week'
      ?(()=>{const d=new Date(day+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);})()
      :day.slice(0,7);
    if(!dates.has(key))dates.set(key,{period:key});
    const result=dates.get(key);
    result['class_'+id]=(result['class_'+id]||0)+count;
  }
  return [...dates.values()].sort((a,b)=>a.period.localeCompare(b.period));
}
function classLabel(value,t){
  const text=String(value||'').trim();
  const suffix=t('uiExtra.statisticsView.groupSuffix');
  return !text?'':text.endsWith(suffix)||text.endsWith(UI_COPY.uiExtra.statisticsView.groupSuffix)?text:text+' '+suffix;
}
function groupLabel(value,t){
  const text=String(value||'').trim();
  const suffix=t('uiExtra.statisticsView.runeSuffix');
  return !text?'':text.endsWith(suffix)||text.endsWith(UI_COPY.uiExtra.statisticsView.runeSuffix)?text:text+suffix;
}
export function Rune66Summary({analysis,range={},scopeId=''}){
  useUiSection('uiExtra.statisticsView');
  const t=useUiText();
  const [page,setPage]=useState(1);
  const [shown,setShown]=useState('group');
  const [chartIntent,setChartIntent]=useState('ranking');
  const [selectedKey,setSelectedKey]=useState('');
  const data=analysis||{};
  const meta=data.keywordMeta||{};
  const className=String(meta.class_name||'').trim();
  const setLabel=className?'關鍵詞組：'+className:t('uiExtra.statisticsView.classFallback');
  const groupDisplay=group=>[className,classLabel(group,t)].filter(Boolean).join(' ');
  const globalCount=Math.max(0,Number(data.keywordDocumentCount||0));
  const minDocuments=Math.max(0,Number(data.keywordMinDocuments||0));
  const classRows=[...(data.groupTotals||[])]
    .sort((a,b)=>Number(b.document_count||0)-Number(a.document_count||0)
      ||String(a.group_uid).localeCompare(String(b.group_uid)));
  const groupRows=[...(data.runeRanking||[])]
    .filter(row=>Number(row.count||0)>0);
  const classifiedTotal=Math.max(0,Number(data.classifiedCount||0));
  const groupHitTotal=groupRows.reduce((sum,row)=>sum+Number(row.count||0),0);
  // The original item ranking is paginated; show a page of bars, not only
  // page one while quietly hiding the other items in a details block.
  const standalonePageSize=RUNE_RANKING_PAGE_SIZE;
  const combinedPageSize=10;
  const groupCatalog=useAsyncResource({
    queryKey:['statistics-keyword-item-class-map',scopeId,String(meta.class_uid||'')],
    enabled:shown==='both'&&Boolean(scopeId&&meta.class_uid&&data.staticstime),
    queryFn:async()=>{
      const {keywordService}=await import('../../../loc/keywords/service-client.mjs');
      const {keywordClassCatalog}=await import('../../../loc/keywords/tree.mjs');
      const result=await keywordService('catalog',{scopeId,classUid:meta.class_uid});
      if(!result.class_uid)return [];
      const {catalog}=keywordClassCatalog(result.rows,result.class_uid);
      return catalog.map(item=>({
        uid:item.uid,group_uid:item.group_uid,class_group:item.class_group
      }));
    }
  });
  // UID is the identity: two Groups can have the same visible name.
  const classByItem=new Map((groupCatalog.data||[])
    .filter(row=>row.class_enable!==false)
    .map(row=>[String(row.uid),String(row.group_uid||'')])
    .filter(([id,groupUid])=>Boolean(id&&groupUid)));
  const groupsWithItems=classRows.map(row=>({
    row,items:groupRows.filter(item=>classByItem.get(String(item.uid))===String(row.group_uid))
      .sort((a,b)=>Number(b.count||0)-Number(a.count||0)
        ||Number(b.document_count||0)-Number(a.document_count||0)
        ||Number(a.order||0)-Number(b.order||0))
  }));
  const ungrouped=groupRows.filter(item=>!classByItem.has(String(item.uid)));
  const orderedItems=groupsWithItems.flatMap(group=>group.items.map(item=>({
    ...item,classification:group.row
  })));
  // An unknown catalog mapping must never be silently attributed to a
  // different Class. Keep it visible as "unassigned" in the final group.
  const allRanked=[...orderedItems,...ungrouped.map(item=>({...item,classification:null}))];
  const pageSize=shown==='both'?combinedPageSize:standalonePageSize;
  const totalItems=shown==='both'?allRanked.length:groupRows.length;
  const pages=Math.max(1,Math.ceil(totalItems/pageSize));
  const activePage=Math.min(page,pages);
  const offset=(activePage-1)*pageSize;
  const visibleGroupRows=groupRows.slice(offset,offset+pageSize);
  const visibleCombined=allRanked.slice(offset,offset+combinedPageSize);
  const groupDistribution=classRows.filter(row=>Number(row.document_count||0)>0).map(row=>({
    key:String(row.group_uid),name:classLabel(row.group,t),value:Number(row.document_count)||0
  }));
  const itemDistribution=visibleGroupRows.map(row=>({
    key:String(row.uid),name:groupLabel(row.label,t),value:Number(row.count)||0
  }));
  const combinedDistribution=[];
  let lastGroupId=null;
  for(const item of visibleCombined){
    const group=item.classification;
    const groupId=group?String(group.group_uid):'unassigned';
    if(lastGroupId!==groupId){
      combinedDistribution.push({
        key:'class:'+groupId,
        name:group?classLabel(group.group,t):'未歸類',
        value:group?Number(group.document_count||0):0,
        fill:baseColor(combinedDistribution.length)
      });
      lastGroupId=groupId;
    }
    combinedDistribution.push({
      key:'item:'+item.uid,
      name:(group&&Number(group.document_count||0)<=0?
        classLabel(group.group,t)+'｜':'　↳ ')+groupLabel(item.label,t),
      value:Number(item.document_count)||0,
      fill:baseColor(combinedDistribution.length)
    });
  }
  const trend=keywordGroupTrend(data.classifications,classRows,range?.bucket||'month');
  const trendSeries=classRows.map(row=>({key:'class_'+row.group_uid,label:classLabel(row.group,t)}));
  const renderGroup=shown==='group'||shown==='both';
  const renderItems=shown==='item'||shown==='both';
  const distribution=shown==='both'?combinedDistribution:shown==='group'?groupDistribution:itemDistribution;
  // The mixed Class/Item view must retain its hierarchy, which a pie or
  // unrelated slices cannot express. Standalone views retain chart switching.
  const activeGroupId=shown==='group'&&classRows.some(row=>String(row.group_uid)===selectedKey)
    ?selectedKey:'';
  const trendRows=shown==='group'?trend:[];
  const series=shown==='group'
    ?trendSeries.filter(field=>!activeGroupId||field.key==='class_'+activeGroupId):[];
  const intentOptions=shown==='group'&&trendRows.length
    ?['ranking','trend']:shown==='item'?['ranking']:[];
  const effectiveIntent=intentOptions.includes(chartIntent)?chartIntent:'ranking';
  const mixedHierarchy=shown==='both';
  const chooseKeywordCategory=key=>{
    const value=String(key||'');
    setSelectedKey(current=>current===value?'':value);
    if(shown==='group'&&classRows.some(row=>String(row.group_uid)===value))
      setChartIntent('trend');
  };
  if(!data.staticstime)return null;
  if(!data.statisticsEnabled)return <div className="scope-ranking">
    <div><strong>{setLabel}</strong><span>{globalCount.toLocaleString()} / {minDocuments.toLocaleString()}</span></div>
  </div>;
  return <section className="scope-rune66-summary scope-card">
    <h3>關鍵詞分佈統計</h3>
    <div className="scope-stat-controls">
      <label><span>顯示內容</span>
        <select className="scope-select" value={shown} onChange={event=>{
          setShown(event.target.value);setPage(1);setChartIntent('ranking');setSelectedKey('');
        }}>
          <option value="group">{t('uiExtra.statisticsView.classRuneTitle')}</option>
          <option value="item">{t('uiExtra.statisticsView.runeRankTitle')}</option>
          <option value="both">群組＋項目（同圖）</option>
        </select>
      </label>
      {intentOptions.length>1?<label><span>分析意圖</span>
        <select className="scope-select" value={effectiveIntent} onChange={event=>{
          setChartIntent(event.target.value);
          if(event.target.value==='ranking')setSelectedKey('');
        }}>
          {intentOptions.map(value=><option key={value} value={value}>
            {value==='trend'?'看趨勢':'看排名'}
          </option>)}
        </select>
      </label>:null}
      {effectiveIntent==='trend'?<button type="button" className="loc-button loc-button--small"
        onClick={()=>{setChartIntent('ranking');setSelectedKey('');}}>返回排名</button>:null}
    </div>
    {shown==='both'&&groupCatalog.isPending?<p className="scope-status" role="status">正在載入關鍵詞項目的 Class 歸屬…</p>:null}
    {shown==='both'&&groupCatalog.error?<p className="scope-status scope-error" role="alert">群組對應讀取失敗：{String(groupCatalog.error?.message||groupCatalog.error)}</p>:null}
    {shown==='both'&&!groupCatalog.isSuccess?null:
      distribution.length?<StatisticsMultiChart
        intent={mixedHierarchy?'legacy':effectiveIntent}
        type="bar" rows={trendRows} series={series} distribution={distribution}
        barLayout="vertical" height={Math.max(340,Math.min(24,distribution.length)*36+85)}
        activeCategoryKey={selectedKey} onCategoryClick={chooseKeywordCategory}/>:
        <p className="scope-status">{t('uiExtra.statisticsView.noVisual')}</p>}
    {selectedKey?<p className="scope-status" role="status">
      已選擇：{distribution.find(item=>String(item.key)===selectedKey)?.name||selectedKey}
    </p>:null}
    {shown==='both'?<p className="scope-status" role="note">
      依 Class 分組，各組內依關鍵詞命中排行；每頁最多 10 個項目。父群組與子項目皆以涉及作品篇數呈現，不可相加視為不同作品總數。
    </p>:null}
    {renderItems&&pages>1?<nav className="scope-stat-controls" aria-label={t('uiExtra.statisticsView.groupPageNav')}>
      <button type="button" className="loc-button" disabled={activePage===1} onClick={()=>setPage(activePage-1)}><UiText id="uiExtra.statisticsView.previous"/></button>
      <span className="scope-status" aria-live="polite"><UiText id="uiExtra.statisticsView.pageTotal" params={{page:activePage,pages,total:totalItems.toLocaleString()}}/></span>
      <button type="button" className="loc-button" disabled={activePage===pages} onClick={()=>setPage(activePage+1)}><UiText id="uiExtra.statisticsView.next"/></button>
    </nav>:null}
    {shown==='group'?<div className="scope-stat-section">
      <h4><UiText id="uiExtra.statisticsView.classRuneTitle"/></h4>
      <StatisticsDetails>{()=><>
        <div className="scope-ranking"><div><strong>{setLabel}</strong><span>{t('uiExtra.statisticsView.classifiedCount',{total:Number(data.documentCount||0).toLocaleString(),classified:classifiedTotal.toLocaleString(),unclassified:Number(data.unclassifiedCount||0).toLocaleString()})}</span></div></div>
        <div className="scope-ranking">
          {classRows.map(row=><div key={row.group_uid} data-selected={selectedKey===String(row.group_uid)?'true':undefined}><strong>{groupDisplay(row.group)}</strong>
            <span>{t('uiExtra.statisticsView.groupWorks',{count:Number(row.document_count||0).toLocaleString(),ratio:(classifiedTotal>0?100*Number(row.document_count||0)/classifiedTotal:0).toFixed(1)})}</span>
          </div>)}
        </div>
      </>}</StatisticsDetails>
    </div>:null}
    {shown==='both'&&groupCatalog.isSuccess?<StatisticsDetails>{()=><div className="scope-ranking">
      {visibleCombined.map((item,index)=>{
        const group=item.classification;
        const previous=visibleCombined[index-1]?.classification;
        const isStart=index===0||String(group?.group_uid||'')!==String(previous?.group_uid||'');
        return <div key={'keyword-detail:'+item.uid}>
          {isStart?<strong>{group?classLabel(group.group,t):'未歸類'}</strong>:null}
          <span>　↳ {groupLabel(item.label,t)} · {Number(item.count||0).toLocaleString()} 次</span>
        </div>;
      })}
    </div>}</StatisticsDetails>:null}
    {shown==='item'?<div className="scope-stat-section">
      <h4><UiText id="uiExtra.statisticsView.runeRankTitle"/></h4>
      <StatisticsDetails>{()=><>
        <div className="scope-ranking">
          {(shown==='both'?visibleCombined:visibleGroupRows).map(row=><div key={row.uid}><strong>{row.classification?classLabel(row.classification.group,t)+'｜':''}{groupLabel(row.label,t)}</strong>
            <span>{t('uiExtra.statisticsView.runeHits',{count:Number(row.count||0).toLocaleString(),ratio:(groupHitTotal>0?100*Number(row.count||0)/groupHitTotal:0).toFixed(1)})}</span>
          </div>)}
        </div>

      </>}</StatisticsDetails>
    </div>:null}
  </section>;
}
