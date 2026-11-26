'use client';

import {useMemo} from 'react';
import {timeRecordHierarchy} from '../../loc/culture/time-record-hierarchy-options.mjs';
import AnchorManagementNavigator from '../AnchorManagementNavigator';

const uid=row=>String(row?.uid||'');
const title=row=>String(row?.title||row?.uid||'未命名紀錄');
const date=row=>String(row?.address||row?.attr?.date||'').slice(0,10);
const dateLabel=row=>[date(row),title(row)].filter(Boolean).join('｜');

export default function TimeAnchorTree({
  rows=[],value='',disabled=false,onSelect,onCreate,children=null
}){
  const hierarchy=useMemo(()=>timeRecordHierarchy(rows),[rows]);
  const selectedRow=rows.find(row=>uid(row)===String(value||''))||null;
  const selectedType=selectedRow?.type==='date'?'anchor':selectedRow?.type||'';
  const findEraForPeriod=periodUid=>hierarchy.eras.find(group=>
    group.periods.some(branch=>uid(branch.row)===periodUid))||null;
  const findPeriodForDate=(groups,dateUid)=>groups.flatMap(group=>group.periods)
    .find(branch=>branch.dates.some(row=>uid(row)===dateUid))||null;
  const selectedPeriod=selectedType==='period'
    ?hierarchy.eras.flatMap(group=>group.periods).find(branch=>uid(branch.row)===uid(selectedRow))
      ||hierarchy.unclassifiedPeriods.find(branch=>uid(branch.row)===uid(selectedRow))
    :selectedType==='anchor'
      ?findPeriodForDate(hierarchy.eras,uid(selectedRow))
        ||findPeriodForDate([{periods:hierarchy.unclassifiedPeriods}],uid(selectedRow))
      :null;
  const selectedEra=selectedType==='era'
    ?hierarchy.eras.find(group=>uid(group.row)===uid(selectedRow))
    :selectedPeriod?findEraForPeriod(uid(selectedPeriod.row)):null;
  const hasUnclassified=Boolean(hierarchy.unclassifiedPeriods.length||hierarchy.unclassifiedDates.length);
  const unclassifiedSelected=Boolean(selectedRow&&!selectedEra)||
    (!selectedRow&&!hierarchy.eras.length&&hasUnclassified);
  const activeEra=selectedEra||(!selectedRow?hierarchy.eras[0]||null:null);
  const unclassifiedPeriods=unclassifiedSelected?hierarchy.unclassifiedPeriods:[];
  const periodBranches=activeEra?.periods||unclassifiedPeriods;
  const dateBranchId='__unclassified_dates__';
  const secondaryItems=[
    ...periodBranches.map(branch=>({
      id:uid(branch.row),label:title(branch.row),
      meta:branch.dates.length+' 個日期定錨點',
      searchText:[title(branch.row),...branch.dates.map(dateLabel)].join(' ')
    })),
    ...(!activeEra&&hierarchy.unclassifiedDates.length?[{
      id:dateBranchId,label:'未歸屬時間定錨',
      meta:hierarchy.unclassifiedDates.length+' 個日期',
      searchText:['未歸屬時間定錨',...hierarchy.unclassifiedDates.map(dateLabel)].join(' ')
    }]:[])
  ];
  const selectedUnclassifiedDates=selectedType==='anchor'&&!selectedPeriod;
  const selectedSecondary=selectedPeriod?uid(selectedPeriod.row):
    selectedUnclassifiedDates?dateBranchId:'';
  const detailRows=selectedType==='anchor'
    ?selectedPeriod?.dates||hierarchy.unclassifiedDates
    :selectedType==='period'?selectedPeriod?.dates||[]:[];
  const detailItems=detailRows.map(row=>({
    id:uid(row),label:title(row),meta:date(row),
    searchText:dateLabel(row)
  }));
  const primaryItems=[
    ...hierarchy.eras.map(group=>({
      id:uid(group.row),label:title(group.row),
      meta:group.periods.length+' 個期間',
      searchText:[title(group.row),...group.periods.flatMap(branch=>[
        title(branch.row),...branch.dates.map(dateLabel)
      ])].join(' ')
    })),
    ...(hasUnclassified?[{
      id:'__unclassified__',label:'未分類',
      meta:hierarchy.unclassifiedPeriods.length+' 個期間 · '+hierarchy.unclassifiedDates.length+' 個定錨點',
      searchText:['未分類',...hierarchy.unclassifiedPeriods.flatMap(branch=>[
        title(branch.row),...branch.dates.map(dateLabel)
      ]),...hierarchy.unclassifiedDates.map(dateLabel)].join(' ')
    }]:[])
  ];
  const selectedPrimary=selectedEra?uid(selectedEra.row):
    unclassifiedSelected?'__unclassified__':(!selectedRow?uid(hierarchy.eras[0]?.row):'');
  const create=type=>()=>onCreate?.(type);
  return <AnchorManagementNavigator
    className="loc-time-anchor-tree"
    label="時間定錨階層管理"
    searchLabel="搜尋時代、期間與時間定錨"
    primaryTitle="時代"
    primaryItems={primaryItems}
    selectedPrimary={selectedPrimary}
    onSelectPrimary={id=>id==='__unclassified__'
      ?onSelect?.(uid(hierarchy.unclassifiedPeriods[0]?.row)||uid(hierarchy.unclassifiedDates[0]))
      :onSelect?.(id)}
    primaryCreateLabel="＋ 新增時代"
    onCreatePrimary={create('era')}
    secondaryTitle={unclassifiedSelected&&!hierarchy.unclassifiedPeriods.length?'未分類時間':unclassifiedSelected?'未分類期間':'期間'}
    secondaryItems={secondaryItems}
    selectedSecondary={selectedSecondary}
    onSelectSecondary={id=>id===dateBranchId
      ?onSelect?.(uid(hierarchy.unclassifiedDates[0]))
      :onSelect?.(id)}
    secondaryCreateLabel="＋ 新增期間"
    onCreateSecondary={create('period')}
    detailTitle="時間定錨與操作"
    detailItems={detailItems}
    selectedDetail={selectedType==='anchor'?uid(selectedRow):''}
    onSelectDetail={id=>onSelect?.(id)}
    detailCreateLabel="＋ 新增時間定錨"
    onCreateDetail={create('anchor')}
    primaryEmpty="目前沒有時代紀錄"
    secondaryEmpty="選擇時代後顯示所屬期間"
    detailEmpty="選擇期間後顯示日期定錨點"
    disabled={disabled}>
    {children}
  </AnchorManagementNavigator>;
}
