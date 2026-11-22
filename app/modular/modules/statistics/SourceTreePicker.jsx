'use client';

import {useMemo} from 'react';
import {sourceIntersectionOutline} from '../../../loc/statistics/source-tree-measures.mjs';

// Choose any level of the ONE LOC SiteAnchor hierarchy. Parent selection
// includes its real From descendants, while the individual From (site) stays
// selectable. A one-child parent is never flattened into a child label.
export default function SourceTreePicker({
  metrics=[],value='',takenIds=new Set(),onChange,label='來源',
  // The general Source selector may allow all four levels. Intersection
  // displays Universe headings and Galaxy/Domain choices, with no From rows.
  selectableTypes=null
}){
  // In intersections Universe is a heading; only Galaxy and Domain are
  // choices. From participates in the rollup, but is not rendered here.
  const groupedIntersection=Array.isArray(selectableTypes)&&selectableTypes.length===2&&
    ['galaxy','domain'].every(type=>selectableTypes.includes(type));
  const sourceGroups=useMemo(()=>groupedIntersection
    ?sourceIntersectionOutline(metrics):[],[metrics,groupedIntersection]);
  const {children,roots,unclassified}=useMemo(()=>{
    const children=new Map(),roots=[];
    let unclassified=null;
    for(const item of metrics){
      if(item.kind==='source_unclassified'){unclassified=item;continue;}
      if(item.kind!=='source_tree')continue;
      if(!item.parentUid)roots.push(item);
      else {
        if(!children.has(item.parentUid))children.set(item.parentUid,[]);
        children.get(item.parentUid).push(item);
      }
    }
    return {children,roots,unclassified};
  },[metrics]);
  const chosen=metrics.find(item=>item.id===value);
  const selectedPath=chosen?.path||[];
  const eligible=item=>!Array.isArray(selectableTypes)||
    selectableTypes.includes(item.type);
  const buttonFor=(item,whole=false)=>eligible(item)
    ?<button type="button" className="scope-source-tree-choice loc-button"
      aria-pressed={item.id===value} disabled={takenIds.has(item.id)||item.total<=0}
      onClick={()=>onChange(item.id)}>
      {whole?'選擇整個 '+item.name:item.name}
      <span className="scope-source-tree-count">（{item.total.toLocaleString()}）</span>
    </button>
    :<span className="scope-source-tree-leaf-label">
      {item.name} <span className="scope-source-tree-count">（{item.total.toLocaleString()}）</span>
    </span>;
  function nodeView(item){
    const descendants=children.get(item.uid)||[];
    return <li key={item.id} className="scope-source-tree-node">
      {descendants.length?<details
        defaultOpen={selectedPath.includes(item.uid)}
        className="scope-source-tree-branch">
        <summary>{item.name} <span className="scope-source-tree-count">（{item.total.toLocaleString()}）</span></summary>
        {buttonFor(item,true)}
        <ul>{descendants.map(nodeView)}</ul>
      </details>:buttonFor(item)}
    </li>;
  }
  if(groupedIntersection)return <section className="scope-source-tree-picker" aria-label={label}>
    <p className="scope-status">依 Universe 分組，選擇 Galaxy 或展開 Domain。</p>
    <ul>{sourceGroups.map(universe=><li className="scope-source-tree-node" key={universe.uid}>
      <h4 className="scope-source-tree-universe">{universe.name}</h4>
      {universe.uid==='__unclassified__'&&universe.galaxies.length
        ?<strong className="scope-source-tree-subgroup">未分類 Galaxy</strong>:null}
      <ul>{universe.galaxies.map(galaxy=><li className="scope-source-tree-node" key={galaxy.uid}>
        {buttonFor(galaxy)}
        {galaxy.domains.length?<details
          defaultOpen={selectedPath.includes(galaxy.uid)}
          className="scope-source-tree-branch">
          <summary>Domain（{galaxy.domains.length}）</summary>
          <ul>{galaxy.domains.map(domain=><li
            className="scope-source-tree-node" key={domain.uid}>
            {buttonFor(domain)}
          </li>)}</ul>
        </details>:null}
      </li>)}</ul>
      {universe.domains?.length?<div className="scope-source-tree-subgroup">
        <strong>未分類 Domain</strong>
        <ul>{universe.domains.map(domain=><li key={domain.uid}
          className="scope-source-tree-node">{buttonFor(domain)}</li>)}</ul>
      </div>:null}
    </li>)}</ul>
  </section>;
  return <section className="scope-source-tree-picker" aria-label={label}>
    <p className="scope-status">來源：Universe → Galaxy → Domain → From（site）</p>
    <ul>{roots.map(nodeView)}
      {unclassified&&!Array.isArray(selectableTypes)?<li className="scope-source-tree-node" key={unclassified.id}>
        {buttonFor(unclassified)}
      </li>:null}
    </ul>
  </section>;
}
