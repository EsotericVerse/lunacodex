'use client';

import {useMemo,useState} from 'react';
import {motion,useReducedMotion} from 'motion/react';
import ManagementSectionNav from './ManagementSectionNav';
import ManagementVisNetwork from './ManagementVisNetwork';

const nodeId=(id,value)=>String(id)+':'+String(value);

export default function ManagementNetworkNav({
  id,title,panelId,items,value,onChange,showDescriptions=false,hideHeading=false
}){
  const [state,setState]=useState('loading');
  const [error,setError]=useState('');
  const selected=items.find(item=>item.value===value)||items[0];
  const graph=useMemo(()=>{
    const middle=(items.length-1)/2;
    const rowGap=Math.min(88,Math.max(62,340/Math.max(1,items.length)));
    const nodes=[{id:nodeId(id,'root'),label:title,level:0,x:0,y:0,fixed:true,
      widthConstraint:{maximum:200}}];
    const edges=[];
    items.forEach((item,index)=>{
      const key=nodeId(id,item.value);
      nodes.push({id:key,label:item.shortLabel||item.label,level:1,
        x:250,
        y:(index-middle)*rowGap,fixed:true,widthConstraint:{maximum:210}});
      edges.push({id:nodeId(id,'edge:'+item.value),from:nodeId(id,'root'),to:key});
    });
    return {nodes,edges};
  },[id,title,items]);
  const reduceMotion=useReducedMotion();
  const change=next=>{
    if(next&&next!==selected?.value)onChange?.(next);
  };

  if(items.length<2)return <ManagementSectionNav id={id} title={title} panelId={panelId}
    items={items} value={value} onChange={onChange} showDescriptions={showDescriptions}
    hideHeading={hideHeading}/>;

  if(state==='error')return <>
    <p className="scope-status management-network-nav__fallback-message" role="status">
      圖譜目前無法載入，已提供文字導覽。{error}</p>
    <ManagementSectionNav id={id} title={title} panelId={panelId}
      items={items} value={value} onChange={onChange} showDescriptions={showDescriptions}
      hideHeading={hideHeading}/>
  </>;

  return <section className="management-network-nav" aria-label={hideHeading?title:undefined}>
    {!hideHeading?<header className="management-network-nav__heading">
      <h2>{title}</h2><span>{items.length} 個管理面向</span>
    </header>:null}
    <ManagementVisNetwork nodes={graph.nodes} edges={graph.edges}
      selectedId={selected?nodeId(id,selected.value):''} onSelect={key=>{
        const picked=items.find(item=>nodeId(id,item.value)===key);
        if(picked)change(picked.value);
      }} ariaLabel={title+'功能圖譜'} className="management-network-nav__canvas"
      onStatusChange={(next,message)=>{
        setState(next==='error'?'error':next);
        if(next==='error')setError(message);
      }}/>
    <motion.div key={selected?.value} className="management-network-nav__selection"
      initial={reduceMotion?false:{opacity:0,y:5}} animate={{opacity:1,y:0}}
      transition={reduceMotion?{duration:0}:{duration:.2,ease:'easeOut'}} aria-live="polite">
      <strong id={id+'-selected-title'}>{selected?.label}</strong>
      {showDescriptions&&selected?.description?<span>{selected.description}</span>:null}
    </motion.div>
    <details className="management-network-nav__choices">
      <summary>功能清單與鍵盤操作</summary>
      <div className="management-network-nav__choice-list" role="tablist" aria-label={title}>
        {items.map((item,index)=><button type="button" role="tab" key={item.value}
          id={id+'-option-'+item.value} aria-selected={item.value===selected?.value}
          aria-controls={panelId} tabIndex={item.value===selected?.value?0:-1}
          onKeyDown={event=>{
            const next=event.key==='ArrowRight'||event.key==='ArrowDown'?index+1
              :event.key==='ArrowLeft'||event.key==='ArrowUp'?index-1
                :event.key==='Home'?0:event.key==='End'?items.length-1:-1;
            if(next<0)return;
            event.preventDefault();
            const target=items[Math.max(0,Math.min(items.length-1,next))];
            change(target.value);
            document.getElementById(id+'-option-'+target.value)?.focus();
          }}
          onClick={()=>change(item.value)}>{item.label}</button>)}
      </div>
    </details>
    {state==='loading'?<span className="management-network-nav__loading" role="status">正在準備功能圖譜…</span>:null}
  </section>;
}
