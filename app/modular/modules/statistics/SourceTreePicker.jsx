'use client';

import {useMemo} from 'react';

// Choose any level of the ONE LOC SiteAnchor hierarchy. Parent selection
// includes its real From descendants, while the individual From (site) stays
// selectable. A one-child parent is never flattened into a child label.
export default function SourceTreePicker({
  metrics=[],value='',takenIds=new Set(),onChange,label='來源',
  // The general Source selector may allow all four levels. Intersection
  // expressly permits only Galaxy/Domain; Universe and From remain navigation.
  selectableTypes=null
}){
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
  return <section className="scope-source-tree-picker" aria-label={label}>
    <p className="scope-status">來源：Universe → Galaxy → Domain → From（site）</p>
    <ul>{roots.map(nodeView)}
      {unclassified&&!Array.isArray(selectableTypes)?<li className="scope-source-tree-node" key={unclassified.id}>
        {buttonFor(unclassified)}
      </li>:null}
    </ul>
  </section>;
}
