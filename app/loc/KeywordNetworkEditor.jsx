'use client';

import {useEffect,useMemo,useRef,useState} from 'react';

function graphOriginGroup(items=[]){
  return String(items.find(row=>row.group_uid)?.group_uid||'');
}

function buildGraph(items=[],className='',classId='',expandedGroup='',expandedItemId='',knownGroups=[]){
  const rows=Array.isArray(items)?items:[];
  const nodes=[];
  const edges=[];
  const meta=new Map();
  const rootId='class:'+String(classId||className||'current');
  nodes.push({id:rootId,label:className?'關鍵字群組科目：'+className:'關鍵字群組科目',level:0,kind:'class',shape:'ellipse'});
  meta.set(rootId,{kind:'class',className,classId});

  const groups=new Map((Array.isArray(knownGroups)?knownGroups:[])
    .filter(group=>group?.uid)
    .map(group=>[String(group.uid),String(group.name||'')]));
  for(const row of rows)if(row.group_uid)
    groups.set(String(row.group_uid),String(row.class_group||groups.get(String(row.group_uid))||''));
  for(const [groupUid,groupName] of groups){
    const id='group:'+groupUid;
    nodes.push({id,label:groupName||'未命名分類群組',level:1,kind:'group',shape:'box'});
    edges.push({id:rootId+'>'+id,from:rootId,to:id});
    meta.set(id,{kind:'group',groupUid});
  }

  // Expand only one Group and one Item at a time; drawing all Keywords at once
  // produces a very large horizontal graph and an unusable canvas.
  rows.filter(row=>String(row.group_uid||'')===expandedGroup).forEach((row,rowIndex)=>{
    const itemId='item:'+String(row.keyword_id||rowIndex);
    const groupId='group:'+String(row.group_uid||'');
    nodes.push({
      id:itemId,
      label:String(row.item_name||'未命名'),
      level:2,
      kind:'item',
      shape:'box',
      title:String(row.principle||'')
    });
    edges.push({id:groupId+'>'+itemId,from:groupId,to:itemId});
    meta.set(itemId,{kind:'item',row});
    if(String(row.keyword_id||'')===expandedItemId)(Array.isArray(row.keywords)?row.keywords:[]).forEach((keyword,index)=>{
      const text=String(keyword||'').trim();
      if(!text)return;
      const id='keyword:'+String(row.keyword_id||rowIndex)+':'+index;
      nodes.push({id,label:text,level:3,kind:'keyword',shape:'text'});
      edges.push({id:itemId+'>'+id,from:itemId,to:id});
      meta.set(id,{kind:'keyword',row,keyword:text});
    });
  });
  return {nodes,edges,meta,rootId};
}

export default function KeywordNetworkEditor({
  items=[],
  groups=[],
  className='',
  classId='',
  selectedId='',
  onSelectItem=null,
  onSelectGroup=null,
  onSelectClass=null,
  onNewGroup=null,
  onNewItem=null,
  onDeleteItem=null,
  onDeleteKeyword=null,
  onDeleteGroup=null,
  onMessage=null
}){
  const containerRef=useRef(null);
  const networkRef=useRef(null);
  const viewportRef=useRef(null);
  const selectedNodeRef=useRef('');
  const [expandedGroup,setExpandedGroup]=useState(()=>graphOriginGroup(items));
  const [expandedItemId,setExpandedItemId]=useState('');
  const handlersRef=useRef({onSelectItem,onSelectGroup,onSelectClass,onNewGroup,onNewItem,onMessage});
  const [error,setError]=useState('');
  const [selectionLabel,setSelectionLabel]=useState('');
  const graph=useMemo(()=>buildGraph(items,className,classId,expandedGroup,expandedItemId,groups),[items,className,classId,expandedGroup,expandedItemId,groups]);
  const graphRef=useRef(graph);
  graphRef.current=graph;
  useEffect(()=>{
    const row=items.find(item=>String(item.keyword_id)===String(selectedId));
    if(row){
      setExpandedGroup(String(row.group_uid||''));
      setExpandedItemId(String(row.keyword_id||''));
    }
  },[selectedId,items]);

  useEffect(()=>{handlersRef.current={onSelectItem,onSelectGroup,onSelectClass,onNewGroup,onNewItem,onMessage}},[onSelectItem,onSelectGroup,onSelectClass,onNewGroup,onNewItem,onMessage]);

  // Canvas styling is resolved from the active LOC Theme. vis-network renders
  // on canvas, so CSS custom properties need to be read again when Theme changes.
  const themeData=model=>{
    const styles=getComputedStyle(containerRef.current);
    const text=styles.getPropertyValue('--loc-text').trim()||'#dfe8f2';
    const muted=styles.getPropertyValue('--loc-muted').trim()||'#9ca8b5';
    const accent=styles.getPropertyValue('--loc-accent').trim()||'#7c9bbd';
    const panel=styles.getPropertyValue('--loc-panel').trim()||'#162536';
    const line=styles.getPropertyValue('--loc-line').trim()||'#526272';
    return {
      nodes:model.nodes.map(node=>({
        ...node,borderWidth:node.kind==='class'?3:node.kind==='group'?2:1,
        margin:node.kind==='keyword'?3:10,
        color:{background:panel,border:node.kind==='class'?accent:line,
          highlight:{background:panel,border:accent}},
        font:{color:node.kind==='keyword'?muted:text,
          size:node.kind==='class'?16:node.kind==='group'?14:13,face:'inherit'},
        widthConstraint:node.kind==='keyword'?{maximum:150}:{maximum:220}
      })),
      edges:model.edges.map(edge=>({...edge,color:{color:line,highlight:accent,hover:accent},
        arrows:'to',smooth:{type:'cubicBezier',forceDirection:'horizontal',roundness:.35}}))
    };
  };
  const refreshGraph=network=>{
    if(!network||!containerRef.current)return;
    const position=network.getViewPosition(),scale=network.getScale();
    network.setData(themeData(graphRef.current));
    network.moveTo({position,scale,animation:false});
    const current=selectedNodeRef.current;
    if(current&&graphRef.current.meta.has(current))network.selectNodes([current]);
  };
  // Keep the Network instance alive across Group/Item expansion. Recreating
  // the canvas on every tap made mobile editing lose position and selection.
  useEffect(()=>{
    let cancelled=false;
    let network=null;
    let observer=null;
    setError('');
    if(!containerRef.current)return undefined;
    import('vis-network/standalone').then(({Network})=>{
      if(cancelled||!containerRef.current)return;
      const compact=containerRef.current.clientWidth<680;
      network=new Network(containerRef.current,themeData(graphRef.current),{
        autoResize:true,physics:false,
        layout:{hierarchical:{enabled:true,direction:compact?'UD':'LR',
          sortMethod:'directed',levelSeparation:compact?135:190,
          nodeSpacing:compact?115:110,treeSpacing:compact?110:170}},
        interaction:{hover:!compact,navigationButtons:false,
          keyboard:{enabled:true,bindToWindow:false},
          dragNodes:false,dragView:true,zoomView:true},
        manipulation:false,
        nodes:{chosen:true},
        edges:{selectionWidth:2,hoverWidth:1.5}
      });
      networkRef.current=network;
      const previousView=viewportRef.current;
      if(previousView?.classId===classId){
        network.moveTo({position:previousView.position,scale:previousView.scale,animation:false});
      }else{
        const firstGroup=graphRef.current.nodes.find(node=>node.kind==='group');
        if(firstGroup)network.focus(firstGroup.id,{scale:compact?.8:1.05,animation:false});
        else network.fit({animation:false});
      }
      network.on('selectNode',event=>{
        const id=String(event.nodes?.[0]||'');
        selectedNodeRef.current=id;
        const meta=graphRef.current.meta.get(id);
        if(!meta)return;
        const row=meta.row;
        setSelectionLabel(meta.kind==='class'?className:
          meta.kind==='group'?graphRef.current.nodes.find(node=>node.id===id)?.label||'':
          meta.kind==='keyword'?meta.keyword:String(row?.item_name||''));
        if(meta.kind==='class')handlersRef.current.onSelectClass?.();
        else if(meta.kind==='group'){
          setExpandedGroup(meta.groupUid);
          setExpandedItemId('');
          handlersRef.current.onSelectGroup?.(meta.groupUid);
        }else if(meta.kind==='item'||meta.kind==='keyword'){
          setExpandedGroup(String(row?.group_uid||''));
          setExpandedItemId(String(row?.keyword_id||''));
          handlersRef.current.onSelectItem?.(row);
        }
      });
      network.on('deselectNode',()=>{
        selectedNodeRef.current='';
        setSelectionLabel('');
      });
      // Theme can be applied on the Scope container, body or root. Only
      // observe ancestor attributes; no polling, DB reads or extra libraries.
      observer=new MutationObserver(()=>refreshGraph(network));
      for(let element=containerRef.current;element;element=element.parentElement)
        observer.observe(element,{attributes:true,attributeFilter:['class','data-theme','style']});
    }).catch(reason=>{if(!cancelled)setError(reason?.message||'vis-network 載入失敗。');});
    return()=>{
      cancelled=true;
      observer?.disconnect();
      if(network){
        viewportRef.current={classId,position:network.getViewPosition(),scale:network.getScale()};
        if(networkRef.current===network)networkRef.current=null;
        network.destroy();
      }
    };
  },[classId]);

  useEffect(()=>{if(networkRef.current)refreshGraph(networkRef.current);},[graph]);

  useEffect(()=>{
    const itemNode='item:'+String(selectedId||'');
    if(selectedId&&graph.meta.has(itemNode)&&networkRef.current){
      networkRef.current.selectNodes([itemNode]);
    }
  },[selectedId,graph]);

  const selectedMeta=graph.meta.get(selectedNodeRef.current);
  const addChild=()=>{
    if(selectedMeta?.kind==='class')handlersRef.current.onNewGroup?.();
    else if(selectedMeta?.kind==='group')handlersRef.current.onNewItem?.(selectedMeta.groupUid);
    else handlersRef.current.onMessage?.('請先選擇科目或分類群組，再新增下層。');
  };
  const zoom=multiplier=>{
    const network=networkRef.current;
    if(!network)return;
    network.moveTo({scale:Math.max(.25,Math.min(3,network.getScale()*multiplier)),animation:false});
  };
  return <section className="scope-keyword-network" aria-label="關鍵詞階層圖">
    <div className="scope-keyword-network-help">
      <strong>科目 → 群組 → 分類 → 判斷詞</strong>
      <span>點選節點展開並在旁邊編輯；拖動空白處移動視野，雙指縮放。</span>
    </div>
    <div className="scope-stat-controls scope-keyword-network-controls" role="group" aria-label="關鍵詞圖譜觸控操作">
      <button type="button" className="loc-button" onClick={addChild}>新增下層</button>
      <button type="button" className="loc-button" onClick={()=>zoom(1.3)} aria-label="放大關聯圖">放大</button>
      <button type="button" className="loc-button" onClick={()=>zoom(1/1.3)} aria-label="縮小關聯圖">縮小</button>
      <button type="button" className="loc-button" onClick={()=>networkRef.current?.fit({animation:false})}>全圖</button>
    </div>
    {selectionLabel?<p className="scope-status" role="status">已選取：{selectionLabel}</p>:null}
    {error?<p className="scope-status scope-error" role="alert">{error}</p>:null}
    <div ref={containerRef} className="scope-graph-canvas scope-keyword-network-canvas" role="application"
      aria-label={className+' 關鍵詞關聯圖'}/>
  </section>;
}
