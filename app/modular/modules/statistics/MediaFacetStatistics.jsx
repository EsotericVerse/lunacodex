'use client';

import {useMemo,useState} from 'react';
import dynamic from 'next/dynamic';
import {useUiCopy,useUiSection} from '../../../i18n/ui-locale';
import UiText,{useUiText} from '../../../i18n/UiText';
import {registerDefaultSection} from '../../../i18n/ui-copy';
import statisticsViewZh from '../../../i18n/sections/uiExtra.statisticsView.zh_tw.js';
import dataErrorsZh from '../../../i18n/sections/uiExtra.dataErrors.zh_tw.js';
import statisticsUIZh from '../../../i18n/sections/uiExtra.statisticsUI.zh_tw.js';
import {StatisticsFacets} from '../../../loc/statistics-facets';
registerDefaultSection('uiExtra.statisticsView',statisticsViewZh);
registerDefaultSection('uiExtra.dataErrors',dataErrorsZh);
registerDefaultSection('uiExtra.statisticsUI',statisticsUIZh);
import {semanticStatisticChartTypes,chartTypeGroups,preferredStatisticChartType,RUNE_RANKING_PAGE_SIZE,OTHER_RANKING_PAGE_SIZE} from './statistics-time-zoom.mjs';
import StatisticsChartFrame from './StatisticsChartFrame';
import StatisticsDetails from './StatisticsDetails';

const StatisticsMultiChart=dynamic(()=>import('./StatisticsMultiChart'),{loading:()=>null});

export default function MediaFacetStatistics({rankingType,rows=[],mediaRows=[],treeRows=[],onRequestRawStyles=null,rawStyleLoading=false,rawStyleError=null,chartType='auto',onChartTypeChange,range={},scopeId,foldBlank=false,zoomLevel=0,onZoomLevelChange,rowsInWindow,facetTotals,facetTrend}){
  useUiSection('uiExtra.statisticsView');
  useUiSection('uiExtra.dataErrors');
  useUiSection('uiExtra.statisticsUI');
  const UI_COPY=useUiCopy();
  const t=useUiText();
  const [selectedTag,setSelectedTag]=useState('all');
  const [rankingPage,setRankingPage]=useState(1);
  const [styleLevel,setStyleLevel]=useState('tags');
  const [styleClass,setStyleClass]=useState('');
  const classes=useMemo(()=>StatisticsFacets.style.styleTreeClasses(treeRows),[treeRows]);
  const effectiveRows=useMemo(()=>rankingType==='media_style'&&styleLevel!=='tags'
    ?StatisticsFacets.style.mediaStyleTreeDaily(mediaRows,treeRows,styleLevel,styleClass):rows,
    [rankingType,styleLevel,styleClass,rows,mediaRows,treeRows]);
  const window=useMemo(()=>rowsInWindow(effectiveRows,range),[effectiveRows,range]);
  // No NOT/exclusion list; count all existing Meta Tags.
  const facetRows=window.rows;
  const totals=useMemo(()=>facetTotals(facetRows),[facetRows]);
  const chosen=totals.find(row=>row.term===selectedTag)?selectedTag:'all';
  const displayed=chosen==='all'?totals:totals.filter(row=>row.term===chosen);
  const pageSize=scopeId==='lrunes'?RUNE_RANKING_PAGE_SIZE:OTHER_RANKING_PAGE_SIZE;
  const pages=Math.max(1,Math.ceil(displayed.length/pageSize));
  const currentPage=Math.max(1,Math.min(pages,rankingPage));
  const chartCategories=chosen==='all'?totals.slice(0,4).map(row=>row.term):[chosen];
  const chartRows=useMemo(()=>facetTrend(facetRows,window,chartCategories),[facetRows,window.startDate,window.endDate,window.bucket,chartCategories.join('\u0000')]);
  const bars=(chosen==='all'?totals.slice(0,15):displayed).map(row=>({term:row.term,value:row.item_count}));
  const supported=semanticStatisticChartTypes({
    purpose:'media',rows:chartRows,series:chartCategories.map(category=>({key:category,label:category})),
    distribution:bars.map(row=>({name:row.term,value:row.value}))
  });
  const chosenChartType=preferredStatisticChartType({purpose:'media',available:supported,requested:chartType});
  const chartGroups=chartTypeGroups(supported,['bar','line','stacked']);
  return <>
    {rankingType==='media_style'&&scopeId==='lo3rwang'&&classes.length?<div className="scope-stat-controls">
      <label><span><UiText id="uiExtra.statisticsUI.mediaStyle"/></span><select className="scope-select" value={styleLevel} onChange={event=>{const next=event.target.value;setStyleLevel(next);setSelectedTag('all');setRankingPage(1);if(next!=='tags')onRequestRawStyles?.();}}>
        <option value="tags"><UiText id="uiExtra.statisticsView.facetTags"/></option>
        <option value="class"><UiText id="uiExtra.statisticsView.facetClass"/></option>
        <option value="group"><UiText id="uiExtra.statisticsView.facetGroup"/></option>
        <option value="item"><UiText id="uiExtra.statisticsView.facetItem"/></option>
      </select></label>
      {styleLevel!=='tags'?<label><span><UiText id="uiExtra.statisticsView.facetClass"/></span><select className="scope-select" value={styleClass} onChange={event=>{setStyleClass(event.target.value);setSelectedTag('all');setRankingPage(1);}}>
        <option value=""><UiText id="uiExtra.statisticsView.facetAllClasses"/></option>
        {classes.map(name=><option key={name} value={name}>{name}</option>)}
      </select></label>:null}
    </div>:null}
    {rankingType==='media_style'&&styleLevel!=='tags'&&rawStyleLoading?<p className="scope-status"><UiText id="uiExtra.statisticsUI.loadingMediaTags"/></p>:null}
    {rankingType==='media_style'&&styleLevel!=='tags'&&rawStyleError?<p className="scope-status scope-error">{String(rawStyleError?.message||rawStyleError)}</p>:null}
    <div className="scope-stat-controls">
      <label><span><UiText id={rankingType==='media_style'?'uiExtra.statisticsView.selectMeta':'uiExtra.statisticsView.selectItem'}/></span>
        <select className="scope-select" value={chosen} onChange={event=>{setSelectedTag(event.target.value);setRankingPage(1);}}>
          <option value="all"><UiText id="uiExtra.statisticsView.allItems"/></option>
          {totals.map(row=><option key={row.term} value={row.term}>{row.term}（{row.item_count.toLocaleString()}）</option>)}
        </select>
      </label>
      <label><span><UiText id="statistics.chart"/></span>
        <select className="scope-select" value={chosenChartType} onChange={event=>onChartTypeChange?.(event.target.value)}>
          {chartGroups.primary.length?<optgroup label={t('uiExtra.statisticsView.chartPrimary')}>
  {chartGroups.primary.map(([value,label])=><option key={value} value={value}>{t(label)}</option>)}
</optgroup>:null}
{chartGroups.advanced.length?<optgroup label={t('uiExtra.statisticsView.chartAdvanced')}>
  {chartGroups.advanced.map(([value,label])=><option key={value} value={value}>{t(label)}</option>)}
</optgroup>:null}{!supported.length?<option value="line"><UiText id="uiExtra.statisticsView.noVisual"/></option>:null}
        </select>
      </label>
    </div>
    {!totals.length?<StatisticsChartFrame level={zoomLevel} onChange={onZoomLevelChange} range={range} idPrefix="scope-stat">
      <p className="scope-status">{UI_COPY.uiExtra.dataErrors.empty}</p>
    </StatisticsChartFrame>:<>
      {chosen==='all'&&totals.length>chartCategories.length?<p className="scope-status">
        {t('uiExtra.statisticsView.chartTopN',{count:chartCategories.length})}
      </p>:null}
      <StatisticsChartFrame level={zoomLevel} onChange={onZoomLevelChange} range={range} idPrefix="scope-stat">
        <StatisticsMultiChart type={chosenChartType}
          rows={chartRows}
          series={chartCategories.map(category=>({key:category,label:category}))}
          distribution={bars.map(row=>({name:row.term,value:row.value}))}
          foldBlank={foldBlank}
          barLayout={chosenChartType==='bar'?'vertical':'horizontal'}
          height={chosenChartType==='bar'?Math.max(340,Math.min(15,bars.length)*38+75):420}
        />
      </StatisticsChartFrame>
      <StatisticsDetails>{()=><>
      <div className="scope-ranking">
        {displayed.slice((currentPage-1)*pageSize,currentPage*pageSize).map(row=><div key={row.term}><strong>{row.term}</strong><span>{row.item_count.toLocaleString()}</span></div>)}
      </div>
      {pages>1?<nav className="scope-stat-controls" aria-label={t('uiExtra.statisticsView.pageNav')}>
        <button type="button" className="loc-button" disabled={currentPage===1} onClick={()=>setRankingPage(currentPage-1)}><UiText id="uiExtra.statisticsView.previous"/></button>
        <span>{currentPage} / {pages}</span>
        <button type="button" className="loc-button" disabled={currentPage===pages} onClick={()=>setRankingPage(currentPage+1)}><UiText id="uiExtra.statisticsView.next"/></button>
      </nav>:null}
      </>}</StatisticsDetails>
    </>}
  </>;
}


