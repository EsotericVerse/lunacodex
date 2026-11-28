'use client';

import {useMemo} from 'react';
import {spaceRecordHierarchy} from './space-record-hierarchy.mjs';

const uid=row=>String(row?.uid||'');
const name=row=>String(row?.title||row?.uid||'未命名紀錄');
const pointLabel=row=>[name(row),row?.postal_address||''].filter(Boolean).join('｜');

export default function SpaceLucusTree({
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
  return <section className={['loc-lucus-select-workspace','loc-space-lucus-tree',className].filter(Boolean).join(' ')}
    aria-label="空間定錨階層管理">
    <div className="loc-lucus-select-workspace__levels">
      <section className="loc-lucus-select-workspace__field">
        <header><h3>痕跡</h3><span>{hierarchy.traces.length}</span></header>
        <label><span>選擇痕跡圖</span>
          <select className="scope-select" value={selectedPrimary||'__none__'} disabled={disabled}
            onChange={event=>{
              const id=event.target.value;
              if(id==='__unclassified__'){
                const first=uid(hierarchy.unclassifiedPaths[0]?.row)||uid(hierarchy.unclassifiedPoints[0]);
                if(first)onSelect?.(hierarchy.unclassifiedPaths.length?'path':'point',first);
              }else if(id!=='__none__')onSelect?.('trace',id);
            }}>
            <option value="__none__">選擇痕跡</option>
            {primaryItems.map(item=><option key={item.id} value={item.id}>
              {item.label} · {item.meta}
            </option>)}
          </select>
        </label>
        <button type="button" className="loc-button" disabled={disabled}
          onClick={create('trace')}>＋ 新增痕跡</button>
      </section>
      <section className="loc-lucus-select-workspace__field">
        <header><h3>路徑</h3><span>{secondaryItems.length}</span></header>
        <label><span>選擇路徑圖</span>
          <select className="scope-select" value={selectedSecondary||'__none__'}
            disabled={disabled||(!activeTrace&&!unclassifiedSelected)}
            onChange={event=>{
              const id=event.target.value;
              if(id===directBranchId){
                const first=uid(directPoints[0]);
                if(first)onSelect?.('point',first);
              }else if(id!=='__none__')onSelect?.('path',id);
            }}>
            <option value="__none__">選擇路徑</option>
            {secondaryItems.map(item=><option key={item.id} value={item.id}>
              {item.label} · {item.meta}
            </option>)}
          </select>
        </label>
        <button type="button" className="loc-button" disabled={disabled}
          onClick={create('path')}>＋ 新增路徑</button>
      </section>
      <section className="loc-lucus-select-workspace__field">
        <header><h3>地點</h3><span>{detailItems.length}</span></header>
        <label><span>選擇空間定錨點</span>
          <select className="scope-select" value={selectedType==='point'?selectedUid:'__none__'}
            disabled={disabled||!detailItems.length}
            onChange={event=>{if(event.target.value!=='__none__')onSelect?.('point',event.target.value);}}>
            <option value="__none__">選擇地點</option>
            {detailItems.map(item=><option key={item.id} value={item.id}>
              {item.label}{item.meta?'｜'+item.meta:''}
            </option>)}
          </select>
        </label>
        <button type="button" className="loc-button" disabled={disabled}
          onClick={create('point')}>＋ 新增地點</button>
      </section>
    </div>
    {children?<div className="loc-lucus-select-workspace__detail">{children}</div>:null}
  </section>;
}
