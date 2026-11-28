'use client';

import {useState} from 'react';
import dynamic from 'next/dynamic';
import {galaxyInterNetEdges} from '../../packages/zenstack/galaxy-inter-net.mjs';

// Second-level Lucus resolver is loaded only when a user opens its branch.
const GalaxyLucusInterNet=dynamic(()=>import('./GalaxyLucusInterNet'),{loading:()=>null});
import {featureNavigationHref,galaxyIdentityHref} from './routing/feature-navigation';

// One small, collapsed branch per relationship family. No additional queries:
// every edge is derived solely from the article detail already authorized by
// the normal reader. Following an edge uses the existing Scope navigation and
// performs that destination's normal access/visibility checks.
const TYPES=Object.freeze([
  {id:'relation',label:'文章關聯'},
  {id:'space',label:'空間定錨'},
  {id:'time',label:'時間定錨'},
  {id:'source',label:'資料來源與連結'}
]);
const fieldName=Object.freeze({
  source_id:'來源文章',ref_id:'參考資料',target_id:'關聯文章',
  media_link:'媒體',place_id:'地點',location:'位置',
  date:'日期',site:'來源'
});
function destination(scope,edge,{federated=false,managementMode=false}={}){
  // An external Galaxy UID is not the same identity as the primary Scope UID.
  if(federated)return '';
  if(edge.kind==='url')return /^https?:\/\//i.test(String(edge.value||''))?edge.value:'';
  if(edge.kind==='point'&&edge.resolved!==true)return '';
  if(edge.kind==='galaxy')return galaxyIdentityHref(scope,edge.value);
  if(edge.kind==='point')return featureNavigationHref(scope,'trace',{place:edge.value});
  if(edge.kind==='date')return featureNavigationHref(scope,'culture',{
    from:edge.value,to:edge.value
  });
  // Free-text source/location is not a UID. Do not pretend its label is a
  // saved Source/Point Lucus; this requires an explicit authorized resolver.
  return '';
}
export default function GalaxyInterNetBranches({scopeId,row,managementMode=false}){
  const [expanded,setExpanded]=useState([]);
  if(!row?.uid)return null;
  const graph=galaxyInterNetEdges(row,{
    place:row.trace_place,
    relatedTitles:row.relation_titles,
    federated:row.inter_net_federated===true
  });
  const groups=TYPES.map(group=>({
    ...group,edges:graph.branches[group.id]
  })).filter(group=>group.edges.length);
  if(!groups.length)return null;
  return <section className="loc-inter-net" aria-label="文章關聯網絡">
    <details>
      <summary className="loc-inter-net__summary">
        <span className="loc-inter-net__spark" aria-hidden="true"/>
        關聯網絡 <small>{groups.length} 個分支</small>
      </summary>
      <div className="loc-inter-net__branches">
        {groups.map(group=><details key={group.id} className="loc-inter-net__branch"
          onToggle={event=>{
            // Nested disclosure events must not change their parent branch.
            if(event.target!==event.currentTarget)return;
            const open=event.currentTarget.open;
            setExpanded(previous=>open
              ?previous.includes(group.id)?previous:[...previous,group.id]
              :previous.filter(id=>id!==group.id));
          }}>
          <summary>{group.label} <small>{group.edges.length}</small></summary>
          <ul>
            {group.edges.map((edge,index)=>{
              const href=destination(scopeId,edge,{federated:row.inter_net_federated===true,managementMode});
              // Avoid displaying an unresolved place UID from this Scope.
              const unresolved=edge.kind==='point'&&edge.resolved!==true;
              const label=unresolved?'尚未確認的關聯':edge.label||edge.value;
              return <li key={edge.field+':'+edge.value+':'+index}>
                <span className="loc-inter-net__field">{fieldName[edge.field]||edge.field}</span>
                {href?<a href={href}>{label}</a>:<span>{label}</span>}
                {edge.resolved===null&&!unresolved&&edge.kind==='galaxy'?
                  <small title="目的節點是否存在需在展開後確認">未確認</small>:null}
              </li>;
            })}
          </ul>
          {expanded.includes(group.id)&&['source','time','space'].includes(group.id)?
            <GalaxyLucusInterNet key={group.id+':'+row.uid}
              family={group.id} scopeId={scopeId} row={row}/>:null}
        </details>)}
      </div>
    </details>
  </section>;
}
