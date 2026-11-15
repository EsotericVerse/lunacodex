'use client';

import {useEffect,useRef,useState} from 'react';
import {anchorInterNetChildren,sourceInterNetSelection} from '../../packages/zenstack/anchor-inter-net.mjs';
import {featureNavigationHref} from './routing/feature-navigation';

const UID=/^[A-Za-z0-9]{8}$/;
const LABELS=Object.freeze({
  universe:'Universe',galaxy:'Galaxy',domain:'Domain',from:'From',
  era:'Era',period:'Period',date:'Date',trace:'Trace',path:'Path',point:'Point'
});
const TITLE=type=>LABELS[type]||type;

function SourceNode({row,indexed,selectedPath,depth=0}){
  const children=depth<4?(indexed.get(row.uid)||[]):[];
  return <li className={selectedPath.has(row.uid)?'is-current':''}>
    {children.length?
      <details>
        <summary>{TITLE(row.type)} · {row.title}{selectedPath.has(row.uid)?' ◇':''}</summary>
        <ul>{children.map(child=><SourceNode key={child.uid}
          row={child} indexed={indexed} selectedPath={selectedPath} depth={depth+1}/>)}</ul>
      </details>
      :<span>{TITLE(row.type)} · {row.title}{selectedPath.has(row.uid)?' ◇':''}</span>}
  </li>;
}

function SourceAnchorBranch({site}){
  const [state,setState]=useState({status:'loading'});
  useEffect(()=>{
    let active=true;
    import('../loc/source-catalog-public.mjs')
      .then(module=>module.readPublicSourceTaxonomy())
      .then(taxonomy=>{if(active)setState(sourceInterNetSelection(site,taxonomy));})
      .catch(()=>{if(active)setState({status:'error'});});
    return ()=>{active=false;};
  },[site]);
  if(state.status==='loading')return <p className="scope-status" role="status">讀取來源分類…</p>;
  if(state.status==='error')return <p role="alert">來源分類讀取失敗。</p>;
  if(state.status==='unmatched')return <p className="scope-status">此來源尚未對應公開的 Source Anchor，保留原始 site：{site}</p>;
  if(state.status==='ambiguous')return <p className="scope-status">來源對應多個 Anchor，無法在未確認前選擇節點。</p>;
  const indexed=new Map();
  for(const node of state.tree){
    if(!node.parentUid)continue;
    if(!indexed.has(node.parentUid))indexed.set(node.parentUid,[]);
    indexed.get(node.parentUid).push(node);
  }
  const selectedPath=new Set(state.path.map(node=>node.uid));
  const roots=state.tree.filter(node=>node.type==='universe'&&!node.parentUid);
  return <div className="loc-inter-net__anchor-detail">
    <p className="scope-status">已連接：{state.path.map(node=>node.title).join(' → ')}</p>
    <ul className="loc-inter-net__anchor-tree">
      {roots.map(root=><SourceNode key={root.uid} row={root}
        indexed={indexed} selectedPath={selectedPath}/>)}
    </ul>
  </div>;
}

function TypedAnchorNode({scopeId,family,node,depth=0,ancestors=[]}){
  const [state,setState]=useState({status:'unread',row:null,children:[]});
  const pending=useRef(false),controller=useRef(null);
  useEffect(()=>()=>controller.current?.abort(),[]);
  const read=async()=>{
    if(pending.current||state.status==='ready'||depth>=3)return;
    pending.current=true;
    controller.current?.abort();
    const abort=new AbortController();
    controller.current=abort;
    setState(prev=>({...prev,status:'loading'}));
    try{
      const [{selectRows},{defaultScopeData}]=await Promise.all([
        import('../loc/db-query.mjs'),import('../loc/scope-data')
      ]);
      if(abort.signal.aborted)return;
      const scope=defaultScopeData(scopeId);
      if(!scope?.anchor)throw Error('Scope Anchor unavailable');
      const {rows=[]}=await selectRows(scope.anchor,{
        columns:'uid,type,title,attr,invisible',
        filters:[
          {column:'uid',operator:'eq',value:node.uid},
          {column:'type',operator:'eq',value:node.type},
          {column:'invisible',operator:'eq',value:false}
        ],
        limit:1,signal:abort.signal
      });
      if(abort.signal.aborted)return;
      const row=rows[0];
      if(!row){setState({status:'missing',row:null,children:[]});return;}
      const children=anchorInterNetChildren(row,family)
        .filter(child=>!ancestors.includes(child.uid)&&child.uid!==node.uid)
        .slice(0,100);
      setState({status:'ready',row,children});
    }catch(error){
      if(!abort.signal.aborted)setState({status:'error',row:null,children:[]});
    }finally{pending.current=false;}
  };
  const label=state.row?.title||node.title||TITLE(node.type);
  const date=state.row?.type==='date'
    ?String(state.row?.attr?.date||'').slice(0,10):'';
  const dateHref=/^\d{4}-\d{2}-\d{2}$/.test(date)
    ?featureNavigationHref(scopeId,'culture',{from:date,to:date}):'';
  const pointHref=state.row?.type==='point'
    ?featureNavigationHref(scopeId,'trace',{place:node.uid}):'';
  return <li>
    <details onToggle={event=>{if(event.currentTarget.open)void read();}}>
      <summary>{TITLE(node.type)} · {label}</summary>
      {state.status==='loading'?<small role="status">讀取此節點…</small>:null}
      {state.status==='missing'?<small>此節點未公開或不存在，未繼續展開</small>:null}
      {state.status==='error'?<button type="button" className="loc-button"
        onClick={()=>{setState({status:'unread',row:null,children:[]});void read();}}>重試讀取</button>:null}
      {state.status==='ready'?<div className="loc-inter-net__anchor-detail">
        {dateHref?<a href={dateHref}>查看這一天的文化時間長河</a>:null}
        {pointHref?<a href={pointHref}>在痕跡地圖查看地點</a>:null}
        {state.children.length?<ul className="loc-inter-net__anchor-tree">
          {state.children.map(child=><TypedAnchorNode
            key={child.uid} scopeId={scopeId} family={family} depth={depth+1}
            node={child} ancestors={[...ancestors,node.uid]}/>)}
        </ul>:<small>此節點沒有可再展開的子關聯</small>}
      </div>:null}
    </details>
  </li>;
}

export default function GalaxyAnchorInterNet({family,scopeId,row}){
  if(family==='source')return row?.site?
    <SourceAnchorBranch site={String(row.site)}/>:null;
  if(row?.inter_net_federated)return null;
  const anchors=family==='time'
    ?[['era',row?.related_time?.eras],['period',row?.related_time?.periods],['date',row?.related_time?.anchors]]
    :family==='space'
      ?[['trace',row?.related_space?.traces],['path',row?.related_space?.routes],['point',row?.related_space?.place?[row.related_space.place]:[]]]
      :[];
  const seen=new Set(),nodes=[];
  for(const [type,entries] of anchors){
    for(const entry of Array.isArray(entries)?entries:[]){
      if(!UID.test(String(entry?.uid||''))||seen.has(entry.uid))continue;
      seen.add(entry.uid);
      nodes.push({uid:entry.uid,type,title:String(entry.title||'')});
    }
  }
  return nodes.length?<div className="loc-inter-net__anchor-detail">
    <small>沿已確認的 Anchor UID 逐節點展開；每次只讀取所選節點。</small>
    <ul className="loc-inter-net__anchor-tree">
      {nodes.slice(0,100).map(node=><TypedAnchorNode key={node.uid}
        scopeId={scopeId} family={family} node={node}/>)}
    </ul>
  </div>:<p className="scope-status">目前沒有可展開的公開 Anchor。</p>;
}
