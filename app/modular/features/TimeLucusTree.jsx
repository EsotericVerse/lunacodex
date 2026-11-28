'use client';

import {useMemo} from 'react';
import {timeRecordHierarchy} from '../../loc/culture/time-record-hierarchy-options.mjs';

const uid=row=>String(row?.uid||'');
const title=row=>String(row?.title||row?.uid||'未命名紀錄');
const date=row=>String(row?.address||row?.attr?.date||'').slice(0,10);
const dateLabel=row=>[date(row),title(row)].filter(Boolean).join('｜');

export default function TimeLucusTree({
  rows=[],value='',disabled=false,onSelect,onCreate,children=null
}){
  const hierarchy=useMemo(()=>timeRecordHierarchy(rows),[rows]);
  const selectedRow=rows.find(row=>uid(row)===String(value||''))||null;
  const selectedType=selectedRow?.type==='date'?'lucus':selectedRow?.type||'';
  const findEraForPeriod=periodUid=>hierarchy.eras.find(group=>
    group.periods.some(branch=>uid(branch.row)===periodUid))||null;
  const findPeriodForDate=(groups,dateUid)=>groups.flatMap(group=>group.periods)
    .find(branch=>branch.dates.some(row=>uid(row)===dateUid))||null;
  const selectedPeriod=selectedType==='period'
    ?hierarchy.eras.flatMap(group=>group.periods).find(branch=>uid(branch.row)===uid(selectedRow))
      ||hierarchy.unclassifiedPeriods.find(branch=>uid(branch.row)===uid(selectedRow))
    :selectedType==='lucus'
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
  const periodBranches=activeEra?.periods||
    (unclassifiedSelected?hierarchy.unclassifiedPeriods:[]);
  const dateBranchId='__unclassified_dates__';
  const secondaryItems=[
    ...periodBranches.map(branch=>({
      id:uid(branch.row),label:title(branch.row),
      meta:branch.dates.length+' 個日期定錨點',
      searchText:[title(branch.row),...branch.dates.map(dateLabel)].join(' ')
    })),
    ...(!activeEra&&unclassifiedSelected&&hierarchy.unclassifiedDates.length?[{
      id:dateBranchId,label:'未歸屬時間定錨',
      meta:hierarchy.unclassifiedDates.length+' 個日期',
      searchText:['未歸屬時間定錨',...hierarchy.unclassifiedDates.map(dateLabel)].join(' ')
    }]:[])
  ];
  const selectedUnclassifiedDates=selectedType==='lucus'&&!selectedPeriod;
  const selectedSecondary=selectedPeriod?uid(selectedPeriod.row):
    selectedUnclassifiedDates?dateBranchId:'';
  const detailRows=selectedType==='lucus'
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
  const visible=(items,selected)=>items.filter(item=>!selected||item.id===selected);
  const create=type=>()=>onCreate?.(type);
  return <section className="loc-lucus-select-workspace loc-time-lucus-tree"
    aria-label="時間定錨階層管理">
    <div className="loc-lucus-select-workspace__levels">
      <section className="loc-lucus-select-workspace__field">
        <header><h3>時代</h3><span>{hierarchy.eras.length}</span></header>
        <label><span>選擇時代</span>
          <select className="scope-select" value={selectedPrimary||'__none__'} disabled={disabled}
            onChange={event=>{
              const id=event.target.value;
              if(id==='__unclassified__'){
                const first=uid(hierarchy.unclassifiedPeriods[0]?.row)||uid(hierarchy.unclassifiedDates[0]);
                if(first)onSelect?.(first);
              }else if(id!=='__none__')onSelect?.(id);
            }}>
            <option value="__none__">選擇時代</option>
            {visible(primaryItems,selectedPrimary).map(item=>
              <option key={item.id} value={item.id}>{item.label} · {item.meta}</option>)}
          </select>
        </label>
        <button type="button" className="loc-button" disabled={disabled}
          onClick={create('era')}>＋ 新增時代</button>
      </section>
      <section className="loc-lucus-select-workspace__field">
        <header><h3>期間</h3><span>{secondaryItems.length}</span></header>
        <label><span>選擇期間</span>
          <select className="scope-select"
            value={selectedType==='era'?'__era__':selectedSecondary||'__none__'}
            disabled={disabled||(!activeEra&&!unclassifiedSelected)}
            onChange={event=>{
              const id=event.target.value;
              if(id==='__era__'){if(activeEra)onSelect?.(uid(activeEra.row));}
              else if(id===dateBranchId){
                const first=uid(hierarchy.unclassifiedDates[0]);
                if(first)onSelect?.(first);
              }else if(id!=='__none__')onSelect?.(id);
            }}>
            <option value="__none__">選擇期間</option>
            {activeEra?<option value="__era__">整個時代</option>:null}
            {secondaryItems.map(item=>
              <option key={item.id} value={item.id}>{item.label} · {item.meta}</option>)}
          </select>
        </label>
        <button type="button" className="loc-button" disabled={disabled}
          onClick={create('period')}>＋ 新增期間</button>
      </section>
      <section className="loc-lucus-select-workspace__field">
        <header><h3>時間定錨點</h3><span>{detailItems.length}</span></header>
        <label><span>選擇日期定錨點</span>
          <select className="scope-select" value={selectedType==='lucus'?uid(selectedRow):'__none__'}
            disabled={disabled||!detailItems.length}
            onChange={event=>{if(event.target.value!=='__none__')onSelect?.(event.target.value);}}>
            <option value="__none__">選擇時間定錨點</option>
            {detailItems.map(item=><option key={item.id} value={item.id}>
              {item.meta?item.meta+'｜':''}{item.label}
            </option>)}
          </select>
        </label>
        <button type="button" className="loc-button" disabled={disabled}
          onClick={create('lucus')}>＋ 新增時間定錨點</button>
      </section>
    </div>
    {children?<div className="loc-lucus-select-workspace__detail">{children}</div>:null}
  </section>;
}
