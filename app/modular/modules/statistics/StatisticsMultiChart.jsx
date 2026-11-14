'use client';

import {cloneElement,useMemo,useState} from 'react';
import {motion,useReducedMotion} from 'motion/react';
import {useAsyncResource} from '../../../../zenstack/client-queries';
import {UI_COPY,registerDefaultSection} from '../../../i18n/ui-copy';
import {RUNE_RANKING_PAGE_SIZE,availableStatisticChartTypes,semanticStatisticChartTypes,preferredStatisticChartType,nonemptySeries,normalizeDistribution,movingAverage,scatterPair,radarPeriodComparison,activePeriodCoverage,number,color,pointColor} from './statistics-time-zoom.mjs';
export {STAT_VISUAL_TYPES,availableStatisticChartTypes} from './statistics-time-zoom.mjs';
import {useUiLocale,useUiSection} from '../../../i18n/ui-locale';
import UiText,{useUiText} from '../../../i18n/UiText';
import StatisticsDetails from './StatisticsDetails';
import statisticsViewZh from '../../../i18n/sections/uiExtra.statisticsView.zh_tw.js';
import chartLabelsZh from '../../../i18n/sections/uiExtra.chartLabels.zh_tw.js';
registerDefaultSection('uiExtra.statisticsView',statisticsViewZh);
registerDefaultSection('uiExtra.chartLabels',chartLabelsZh);
import {
  Area,AreaChart,Bar,BarChart,Brush,CartesianGrid,Cell,ComposedChart,
  Legend,Line,LineChart,Pie,PieChart,PolarAngleAxis,PolarGrid,
  PolarRadiusAxis,Radar,RadarChart,RadialBar,RadialBarChart,
  ResponsiveContainer,Scatter,ScatterChart,Tooltip,Treemap,XAxis,YAxis
} from 'recharts';

const CHART_ACCENT='var(--loc-accent)';
const CHART_TEXT='var(--loc-text)';
const CHART_GRID='var(--loc-line)';
const CHART_TOOLTIP={background:'var(--loc-panel)',border:'1px solid var(--loc-line)',color:'var(--loc-text)',borderRadius:'8px'};

const TOOLTIP={background:'var(--loc-panel)',border:'1px solid var(--loc-line)',color:'var(--loc-text)',borderRadius:'8px'};
const GRID='var(--loc-line)',TEXT='var(--loc-text)',DAY=86400000;

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
  type='line',rows=[],series=[],distribution=[],totalKey='',height=380,foldBlank=false,
  barLayout='horizontal',onCategoryClick=null,onSeriesClick=null
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
  const usable=availableStatisticChartTypes({rows:time,series:fields,distribution:categories,totalKey});
  const actual=usable.some(([id])=>id===type)?type:(usable[0]?.[0]||'line');
  const timeFields=totalKey?[{key:totalKey,label:t('uiExtra.chartLabels.total')}]:fields;
  const {rows:display,gaps}=useMemo(()=>foldBlank&&['line','bar','area','stacked','composed'].includes(actual)
    ?foldEmptyTimeBuckets(time,timeFields,units):{rows:time,gaps:[]},[foldBlank,actual,time,timeFields,locale]);
  const margin={top:16,right:18,bottom:44,left:0};
  const axes=(<><CartesianGrid stroke={GRID} strokeDasharray="3 3"/>
    <XAxis dataKey="period" tick={{fill:TEXT,fontSize:11}} angle={-20} textAnchor="end" height={64} interval="preserveStartEnd" stroke={GRID}/>
    <YAxis tick={{fill:TEXT,fontSize:11}} allowDecimals={false} stroke={GRID}/>
    <Tooltip contentStyle={TOOLTIP}/>
    {display.length>32?<Brush dataKey="period" height={24} travellerWidth={9} stroke={CHART_ACCENT}/>:null}
    {fields.length>1&&!['bar','composed'].includes(actual)?<Legend wrapperStyle={{fontSize:12}}/>:null}
  </>);
  const colored=categories.map((item,i)=>({...item,fill:item.fill||pointColor(i)}));
  const comparison=useMemo(()=>radarPeriodComparison(time,fields),[time,fields]);
  const coverage=useMemo(()=>activePeriodCoverage(time,fields),[time,fields]);
  const paired=useMemo(()=>scatterPair(time,fields),[time,fields]);
  // Calculate averages on the original, complete timeline before shortening gaps.
  const composed=useMemo(()=>{
    const full=movingAverage(time,fields,totalKey);
    return foldBlank?foldEmptyTimeBuckets(full,timeFields,units).rows:full;
  },[time,fields,totalKey,foldBlank,timeFields,locale]);
  let chart=null;
  if(actual==='pie')chart=<PieChart>
    <Tooltip contentStyle={TOOLTIP}/><Legend wrapperStyle={{fontSize:11}}/>
    <Pie data={colored} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius="73%">
      {colored.map(item=><Cell key={item.name} fill={item.fill}/>)}
    </Pie>
  </PieChart>;
  else if(actual==='treemap')chart=<Treemap data={colored.map(item=>({...item,size:item.value}))}
    dataKey="size" nameKey="name" stroke="var(--loc-bg)" fill={pointColor(0)}
    colorPanel={colored.map(item=>item.fill)} aspectRatio={4/3}>
      <Tooltip contentStyle={TOOLTIP}/>
    </Treemap>;
  else if(actual==='radar'&&comparison)chart=<RadarChart data={comparison} outerRadius="67%">
    <PolarGrid stroke={GRID}/><PolarAngleAxis dataKey="name" tick={{fill:TEXT,fontSize:11}}/>
    <PolarRadiusAxis domain={[0,100]} tick={{fill:TEXT,fontSize:10}}/>
    <Radar name={t('uiExtra.chartLabels.firstHalf')} dataKey="early" stroke={color(0)} fill={color(0)} strokeWidth={3} fillOpacity={.10}/>
    <Radar name={t('uiExtra.chartLabels.lastHalf')} dataKey="late" stroke={color(3)} fill={color(3)} strokeDasharray="7 4" strokeWidth={3} fillOpacity={.10}/>
    <Legend/><Tooltip contentStyle={TOOLTIP} formatter={v=>Number(v).toFixed(1)+'%'}/>
  </RadarChart>;
  else if(actual==='radial'&&coverage)chart=<RadialBarChart data={coverage} innerRadius="16%" outerRadius="82%" startAngle={90} endAngle={-270}>
    <RadialBar dataKey="value" background cornerRadius={4}/>
    <Legend layout="vertical" verticalAlign="middle" align="right" wrapperStyle={{fontSize:11}}/>
    <Tooltip contentStyle={TOOLTIP} formatter={v=>Number(v).toFixed(1)+'%'}/>
  </RadialBarChart>;
  else if(actual==='scatter'&&paired)chart=<ScatterChart margin={{top:20,right:20,bottom:45,left:20}}>
    <CartesianGrid stroke={GRID} strokeDasharray="3 3"/>
    <XAxis type="number" dataKey="x" name={paired.x.label} tick={{fill:TEXT,fontSize:11}} stroke={GRID}
      label={{value:paired.x.label||paired.x.key,position:'insideBottom',offset:-16,fill:TEXT}}/>
    <YAxis type="number" dataKey="y" name={paired.y.label} tick={{fill:TEXT,fontSize:11}} stroke={GRID}
      label={{value:paired.y.label||paired.y.key,angle:-90,position:'insideLeft',fill:TEXT}}/>
    <Tooltip contentStyle={TOOLTIP} cursor={{strokeDasharray:'3 3'}}
      content={({active,payload})=>active&&payload?.length?<div style={TOOLTIP}>
        <div>{payload[0]?.payload?.period}</div>
        <div>{paired.x.label}: {payload[0]?.payload?.x}</div>
        <div>{paired.y.label}: {payload[0]?.payload?.y}</div>
      </div>:null}/>
    <Scatter name={paired.x.label+' × '+paired.y.label} data={paired.data} fill={pointColor(0)}>
      {paired.data.map((row,i)=><Cell key={row.period||i} fill={pointColor(i)}/>)}
    </Scatter>
  </ScatterChart>;
  else if(actual==='composed')chart=<ComposedChart data={composed} margin={margin}>
    <CartesianGrid stroke={GRID} strokeDasharray="3 3"/>
    <XAxis dataKey="period" tick={{fill:TEXT,fontSize:11}} angle={-20} textAnchor="end" height={64} interval="preserveStartEnd" stroke={GRID}/>
    <YAxis tick={{fill:TEXT,fontSize:11}} allowDecimals={false} stroke={GRID}/>
    <Tooltip contentStyle={TOOLTIP}/><Legend/>
    {composed.length>32?<Brush dataKey="period" height={24} travellerWidth={9} stroke={CHART_ACCENT}/>:null}
    <Bar dataKey="__stat_total" name={t('uiExtra.chartLabels.periodTotal')} fill={color(0)} opacity={.8} maxBarSize={30}>
      {composed.map((_,i)=><Cell key={i} fill={pointColor(i)}/>)}
    </Bar>
    <Line dataKey="__stat_average" name={t('uiExtra.chartLabels.movingAverage')} stroke={color(3)} strokeWidth={3} strokeDasharray="8 4" dot={false} connectNulls={false}/>
  </ComposedChart>;
  else if(actual==='stacked')chart=<AreaChart data={display} margin={margin}>
    {axes}{fields.map((f,i)=><Area key={f.key} type="linear" dataKey={f.key} name={f.label} stackId="parts"
      stroke={color(i)} fill={color(i)} fillOpacity={.65} connectNulls={false} isAnimationActive={false}/>)}
  </AreaChart>;
  else if(actual==='area')chart=<AreaChart data={display} margin={margin}>
    {axes}{timeFields.map((f,i)=><Area key={f.key} type="linear" dataKey={f.key} name={f.label}
      stroke={color(i)} fill={color(i)} fillOpacity={.25} connectNulls={false} isAnimationActive={false}/>)}
  </AreaChart>;
  else if(actual==='bar'&&barLayout==='vertical'&&categories.length)chart=<BarChart data={colored}
    layout="vertical" margin={{top:10,right:20,bottom:14,left:6}}>
    <CartesianGrid strokeDasharray="3 3" stroke={GRID}/>
    <XAxis type="number" allowDecimals={false} tick={{fill:TEXT}}/>
    <YAxis dataKey="name" type="category" width={150} tick={{fill:TEXT,fontSize:11}}
      tickFormatter={value=>String(value).length>12?String(value).slice(0,11)+'…':String(value)}/>
    <Tooltip contentStyle={TOOLTIP}/>
    <Bar dataKey="value" fill="var(--loc-accent)" maxBarSize={28}
      cursor={onCategoryClick?'pointer':undefined}
      onClick={onCategoryClick?(_,index)=>onCategoryClick(colored[index]?.key):undefined}>
      {colored.map(item=><Cell key={item.key} fill={item.fill}/>)}
    </Bar>
  </BarChart>;
  else if(actual==='bar')chart=<BarChart data={display} margin={margin}>
    {axes}{timeFields.map((f,i)=><Bar key={f.key} dataKey={f.key} name={f.label} fill={color(i)} maxBarSize={32}>
      {display.map((_,j)=><Cell key={j} fill={pointColor(j*timeFields.length+i)}/>)}
    </Bar>)}
  </BarChart>;
  else chart=<LineChart data={display} margin={margin}>
    {axes}{timeFields.map((f,i)=><Line key={f.key} type="linear" dataKey={f.key} name={f.label}
      stroke={color(i)} strokeWidth={2.5} dot={display.length<25} connectNulls={false}
      activeDot={onSeriesClick?{onClick:()=>onSeriesClick(f.key)}:undefined}
      isAnimationActive={false}/>)}
  </LineChart>;
  if(!usable.length)return <p className="scope-status">{t('uiExtra.chartLabels.noComparable')}</p>;
  return <div className="scope-multichart" role="group" aria-label={t('uiExtra.chartLabels.chartAria')}>
    {/* Recharts owns SVG geometry, data animation and hit targets. Motion only
        fades the stable-size chart surface when its visualization type changes.
        No overlapping ResponsiveContainers or layout measurements. */}
    <motion.div key={actual} className="scope-multichart-motion-surface"
      initial={reduceMotion?false:{opacity:0,y:6}}
      animate={{opacity:1,y:0}}
      transition={{duration:reduceMotion?0:.22,ease:'easeOut'}}
      style={{height:barLayout==='vertical'?height:`min(${height}px, max(300px, 85vw))`}}>
      {actual==='treemap'
        ?<ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer>
        :cloneElement(chart,{responsive:true,style:{width:'100%',height:'100%'}})}
    </motion.div>
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
  const [chartType,setChartType]=useState('bar');
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
      const {keywordService}=await import('../../../loc/keyword-service-client.mjs');
      const {keywordTreeCatalog}=await import('../../../loc/keyword-tree-report.mjs');
      const result=await keywordService('catalog',{scopeId,classUid:meta.class_uid});
      if(!result.class_uid)return [];
      const tree=keywordTreeCatalog(result.rows,result.class_uid);
      return tree.groups.flatMap(group=>group.items.map(item=>({
        uid:item.uid,group_uid:group.uid,class_group:group.name
      })));
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
        fill:color(combinedDistribution.length)
      });
      lastGroupId=groupId;
    }
    combinedDistribution.push({
      key:'item:'+item.uid,
      name:(group&&Number(group.document_count||0)<=0?
        classLabel(group.group,t)+'｜':'　↳ ')+groupLabel(item.label,t),
      value:Number(item.document_count)||0,
      fill:color(combinedDistribution.length)
    });
  }
  const trend=keywordGroupTrend(data.classifications,classRows,range?.bucket||'month');
  const trendSeries=classRows.map(row=>({key:'class_'+row.group_uid,label:classLabel(row.group,t)}));
  const renderGroup=shown==='group'||shown==='both';
  const renderItems=shown==='item'||shown==='both';
  const distribution=shown==='both'?combinedDistribution:shown==='group'?groupDistribution:itemDistribution;
  // The mixed Class/Item view must retain its hierarchy, which a pie or
  // unrelated slices cannot express. Standalone views retain chart switching.
  const trendRows=shown==='group'?trend:[];
  const series=shown==='group'?trendSeries:[];
  const options=semanticStatisticChartTypes({purpose:'keyword',rows:trendRows,series,distribution})
    .filter(([kind])=>shown==='both'?kind==='bar'
      :shown==='group'&&trendRows.length>0||['bar','pie','treemap'].includes(kind));
  const actualChart=preferredStatisticChartType({purpose:'keyword',available:options,requested:chartType});
  if(!data.staticstime)return null;
  if(!data.statisticsEnabled)return <div className="scope-ranking">
    <div><strong>{setLabel}</strong><span>{globalCount.toLocaleString()} / {minDocuments.toLocaleString()}</span></div>
  </div>;
  const typePicker=(id,selected,onSelect,options)=><label>
    <span>{t('uiExtra.statisticsView.chart')}</span>
    <select className="scope-select" aria-label={id} value={selected} onChange={event=>onSelect(event.target.value)}>
      {options.map(([kind,label])=><option key={kind} value={kind}>{t(label)}</option>)}
    </select>
  </label>;
  return <section className="scope-rune66-summary scope-card">
    <h3>關鍵詞分佈統計</h3>
    <div className="scope-stat-controls">
      <label><span>顯示內容</span>
        <select className="scope-select" value={shown} onChange={event=>{setShown(event.target.value);setPage(1);}}>
          <option value="group">{t('uiExtra.statisticsView.classRuneTitle')}</option>
          <option value="item">{t('uiExtra.statisticsView.runeRankTitle')}</option>
          <option value="both">群組＋項目（同圖）</option>
        </select>
      </label>
      {options.length?typePicker('關鍵詞統計圖型',actualChart,setChartType,options):null}
    </div>
    {shown==='both'&&groupCatalog.isPending?<p className="scope-status" role="status">正在載入關鍵詞項目的 Class 歸屬…</p>:null}
    {shown==='both'&&groupCatalog.error?<p className="scope-status scope-error" role="alert">群組對應讀取失敗：{String(groupCatalog.error?.message||groupCatalog.error)}</p>:null}
    {shown==='both'&&!groupCatalog.isSuccess?null:
      distribution.length?<StatisticsMultiChart type={actualChart}
        rows={trendRows} series={series} distribution={distribution}
        barLayout="vertical" height={Math.max(340,Math.min(24,distribution.length)*36+85)}/>:
        <p className="scope-status">{t('uiExtra.statisticsView.noVisual')}</p>}
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
          {classRows.map(row=><div key={row.group}><strong>{groupDisplay(row.group)}</strong>
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
