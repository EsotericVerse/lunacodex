'use client';

import {useMemo} from 'react';
import {spaceRecordHierarchy} from './space-record-hierarchy.mjs';
import AnchorManagementNavigator from '../../modular/AnchorManagementNavigator';

const uid=row=>String(row?.uid||'');
const name=row=>String(row?.title||row?.uid||'未命名紀錄');
const pointLabel=row=>[name(row),row?.postal_address||''].filter(Boolean).join('｜');

export default function SpaceAnchorTree({
  spatial,scopeId,value='',disabled=false,onSelect,onCreate,children=null,
  className='loc-unified-spatial-manager'
}){
  const hierarchy=useMemo(()=>spaceRecordHierarchy(spatial,scopeId),[spatial,scopeId]);
  const [selectedType='',selectedUid='']=String(value||'').split(':',2);
  const traceForPath=hierarchy.traces.find(group=>
    group.paths.some(branch=>uid(branch.row)===selectedUid))||null;
  const traceForPoint=hierarchy.traces.find(group=>
    group.directPoints.some(row=>uid(row)===selectedUid)||
    group.paths.some(branch=>branch.points.some(row=>uid(row)===selectedUid)))||null;
  const selectedTrace=selectedType==='trace'
    ?hierarchy.traces.find(group=>uid(group.row)===selectedUid)||null
    :traceForPath||traceForPoint;
  const selectedPath=selectedType==='path'
    ?(selectedTrace?.paths.find(branch=>uid(branch.row)===selectedUid)||
      hierarchy.unclassifiedPaths.find(branch=>uid(branch.row)===selectedUid)||null)
    :selectedType==='point'
      ?selectedTrace?.paths.find(branch=>branch.points.some(row=>uid(row)===selectedUid))||
        hierarchy.unclassifiedPaths.find(branch=>branch.points.some(row=>uid(row)===selectedUid))||null
      :null;
  const selectedDirectPoint=selectedType==='point'&&Boolean(
    selectedTrace?.directPoints.some(row=>uid(row)===selectedUid));
  const unclassifiedSelected=Boolean(selectedType&&!selectedTrace)||
    (!selectedType&&!hierarchy.traces.length&&
      Boolean(hierarchy.unclassifiedPaths.length||hierarchy.unclassifiedPoints.length));
  const activeTrace=selectedTrace||(!unclassifiedSelected?hierarchy.traces[0]||null:null);
  const pathBranches=activeTrace?.paths||
    (unclassifiedSelected?hierarchy.unclassifiedPaths:[]);
  const directPoints=activeTrace?.directPoints||
    (unclassifiedSelected?hierarchy.unclassifiedPoints:[]);
  const directBranchId=unclassifiedSelected?'__unclassified_points__':'__direct_points__';
  const secondaryItems=[
    ...pathBranches.map(branch=>({
      id:uid(branch.row),label:name(branch.row)+(branch.row.invisible?'（已隱藏）':''),
      meta:branch.points.length+' 個地點',
      searchText:[name(branch.row),...branch.points.map(pointLabel)].join(' ')
    })),
    ...(directPoints.length?[{
      id:directBranchId,
      label:unclassifiedSelected?'未歸屬地點':'直接地點',
      meta:directPoints.length+' 個地點',
      searchText:[unclassifiedSelected?'未歸屬地點':'直接地點',...directPoints.map(pointLabel)].join(' ')
    }]:[])
  ];
  const selectedSecondary=selectedPath?uid(selectedPath.row):
    selectedDirectPoint||selectedType==='point'&&unclassifiedSelected?directBranchId:'';
  const detailRows=selectedPath?.points||
    (selectedDirectPoint||selectedType==='trace'?directPoints:
      (unclassifiedSelected&&selectedType==='point'?hierarchy.unclassifiedPoints:[]));
  const detailItems=detailRows.map(row=>({
    id:uid(row),label:name(row)+(row.invisible?'（已隱藏）':''),
    meta:row.postal_address||'',
    searchText:pointLabel(row)
  }));
  const hasUnclassified=Boolean(hierarchy.unclassifiedPaths.length||hierarchy.unclassifiedPoints.length);
  const primaryItems=[
    ...hierarchy.traces.map(group=>({
      id:uid(group.row),label:name(group.row)+(group.row.invisible?'（已隱藏）':''),
      meta:group.paths.length+' 條路徑 · '+group.directPoints.length+' 個直接地點',
      searchText:[name(group.row),...group.paths.flatMap(branch=>[
        name(branch.row),...branch.points.map(pointLabel)
      ]),...group.directPoints.map(pointLabel)].join(' ')
    })),
    ...(hasUnclassified?[{
      id:'__unclassified__',label:'未歸屬',
      meta:hierarchy.unclassifiedPaths.length+' 條路徑 · '+hierarchy.unclassifiedPoints.length+' 個地點',
      searchText:['未歸屬',...hierarchy.unclassifiedPaths.flatMap(branch=>[
        name(branch.row),...branch.points.map(pointLabel)
      ]),...hierarchy.unclassifiedPoints.map(pointLabel)].join(' ')
    }]:[])
  ];
  const selectedPrimary=selectedTrace?uid(selectedTrace.row):
    unclassifiedSelected?'__unclassified__':(!selectedType?uid(hierarchy.traces[0]?.row):'');
  const create=type=>()=>onCreate?.(type);
  return <AnchorManagementNavigator
    className={['loc-space-lucus-tree',className].filter(Boolean).join(' ')}
    label="空間定錨階層管理"
    searchLabel="搜尋痕跡、路徑與地點"
    searchPlaceholder="依名稱、地址或 UID 搜尋"
    primaryTitle="痕跡"
    primaryItems={primaryItems}
    selectedPrimary={selectedPrimary}
    onSelectPrimary={id=>id==='__unclassified__'
      ?onSelect?.(hierarchy.unclassifiedPaths.length?'path':'point',
        uid(hierarchy.unclassifiedPaths[0]?.row)||uid(hierarchy.unclassifiedPoints[0]))
      :onSelect?.('trace',id)}
    primaryCreateLabel="＋ 新增痕跡"
    onCreatePrimary={create('trace')}
    secondaryTitle={unclassifiedSelected&&!hierarchy.unclassifiedPaths.length?'未歸屬地點':unclassifiedSelected?'未歸屬路徑':'路徑'}
    secondaryItems={secondaryItems}
    selectedSecondary={selectedSecondary}
    onSelectSecondary={id=>id===directBranchId
      ?onSelect?.('point',uid(directPoints[0]))
      :onSelect?.('path',id)}
    secondaryCreateLabel="＋ 新增路徑"
    onCreateSecondary={create('path')}
    detailTitle="地點與操作"
    detailItems={detailItems}
    selectedDetail={selectedType==='point'?selectedUid:''}
    onSelectDetail={id=>onSelect?.('point',id)}
    detailCreateLabel="＋ 新增地點"
    onCreateDetail={create('point')}
    primaryEmpty="目前沒有痕跡紀錄"
    secondaryEmpty="選擇痕跡後顯示所屬路徑"
    detailEmpty="選擇路徑後顯示所屬地點"
    disabled={disabled}>
    {children}
  </AnchorManagementNavigator>;
}
