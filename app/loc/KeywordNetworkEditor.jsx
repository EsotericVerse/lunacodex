'use client';

import {useEffect,useMemo,useRef,useState} from 'react';

function graphOriginGroup(items=[]){
  return String(items.find(row=>row.group_uid)?.group_uid||'');
}

function buildGraph(items=[],groups=[],className='',classId='',expandedGroup='',expandedItemId=''){
  const rows=Array.isArray(items)?items:[];
  const nodes=[];
  const edges=[];
  const meta=new Map();
  const rootId='class:'+String(classId||className||'current');
  nodes.push({id:rootId,label:className?'關鍵字群組科目：'+className:'關鍵字群組科目',level:0,kind:'class',shape:'ellipse'});
  meta.set(rootId,{kind:'class',className,classId});

  const namedGroups=new Map(groups.map(row=>[String(row.uid),String(row.name||'')]));
  // Preserve empty Groups: an editor must be able to add its first Item.
  for(const row of rows)if(row.group_uid&&!namedGroups.has(String(row.group_uid)))
    namedGroups.set(String(row.group_uid),String(row.class_group||''));
  for(const [groupUid,groupName] of namedGroups){
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
  const handlersRef=useRef({onSelectItem,onSelectGroup,onNewItem,onDeleteItem,onDeleteKeyword,onDeleteGroup,onMessage});
  const [error,setError]=useState('');
  const [fullscreen,setFullscreen]=useState(false);
  const [themeRevision,setThemeRevision]=useState(0);
  // Recreate colors only when the application's actual theme changes.
  // Ordinary graph interactions must not watch the entire document subtree.
  useEffect(()=>{
    const observer=new MutationObserver(()=>setThemeRevision(value=>value+1));
    const options={attributes:true,attributeFilter:['class','style','data-theme','data-loc-theme']};
    observer.observe(document.documentElement,options);
    if(document.body)observer.observe(document.body,options);
    return ()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    if(!fullscreen)return undefined;
    const onKeyDown=event=>{if(event.key==='Escape')setFullscreen(false);};
    window.addEventListener('keydown',onKeyDown);
    return ()=>window.removeEventListener('keydown',onKeyDown);
  },[fullscreen]);
  const graph=useMemo(()=>buildGraph(items,groups,className,classId,expandedGroup,expandedItemId),[items,groups,className,classId,expandedGroup,expandedItemId]);
  useEffect(()=>{
    const row=items.find(item=>String(item.keyword_id)===String(selectedId));
    if(row){
      setExpandedGroup(String(row.group_uid||''));
      setExpandedItemId(String(row.keyword_id||''));
    }
  },[selectedId,items]);

  useEffect(()=>{handlersRef.current={onSelectItem,onSelectGroup,onNewItem,onDeleteItem,onDeleteKeyword,onDeleteGroup,onMessage}},[onSelectItem,onSelectGroup,onNewItem,onDeleteItem,onDeleteKeyword,onDeleteGroup,onMessage]);

  useEffect(()=>{
    let cancelled=false;
    let network=null;
    setError('');
    if(!containerRef.current||!graph.nodes.length)return undefined;
    import('vis-network/standalone').then(({Network})=>{
      if(cancelled||!containerRef.current)return;
      const styles=getComputedStyle(containerRef.current);
      const text=styles.getPropertyValue('--loc-text').trim()||'#dfe8f2';
      const muted=styles.getPropertyValue('--loc-muted').trim()||'#9ca8b5';
      const accent=styles.getPropertyValue('--loc-accent').trim()||'#7c9bbd';
      const panel=styles.getPropertyValue('--loc-panel-2').trim()||'#162536';
      const line=styles.getPropertyValue('--loc-line').trim()||'#526272';
      const nodes=graph.nodes.map(node=>({
        ...node,
        borderWidth:node.kind==='class'?3:node.kind==='group'?2:1,
        margin:node.kind==='keyword'?2:8,
        color:{background:panel,border:node.kind==='class'?accent:line,highlight:{background:panel,border:accent}},
        font:{color:node.kind==='keyword'?muted:text,size:node.kind==='class'?16:node.kind==='group'?14:12,face:'inherit'},
        widthConstraint:node.kind==='keyword'?{maximum:150}:{maximum:220}
      }));
      const edges=graph.edges.map(edge=>({...edge,color:{color:line,highlight:accent,hover:accent},arrows:'to',smooth:{type:'cubicBezier',forceDirection:'horizontal',roundness:.35}}));
      const metaOf=id=>graph.meta.get(String(id||''))||null;
      const selectMeta=meta=>{
        if(!meta)return;
        if(meta.kind==='item'||meta.kind==='keyword')handlersRef.current.onSelectItem?.(meta.row);
      };

      network=new Network(containerRef.current,{nodes,edges},{
        autoResize:true,
        physics:false,
        // vis-network manipulation uses 'en' as its fallback locale.
        // Replacing the locale map with only 'zh-tw' left fallback undefined
        // and crashed while reading the manipulation toolbar 'close' label.
        locale:'en',
        locales:{en:{
          edit:'編輯',del:'刪除所選',back:'返回',close:'關閉',addNode:'新增節點',addEdge:'新增關係',
          editNode:'編輯節點',editEdge:'編輯關係',addDescription:'點圖面放置新節點。',
          edgeDescription:'拖曳建立關係。',editEdgeDescription:'拖曳調整關係。',
          createEdgeError:'無法建立此關係。',deleteClusterError:'無法刪除群集。',editClusterError:'無法編輯群集。'
        }},
        layout:{hierarchical:{enabled:true,
          direction:window.matchMedia('(max-width: 760px)').matches?'UD':'LR',
          sortMethod:'directed',levelSeparation:170,nodeSpacing:110,treeSpacing:145}},
        interaction:{hover:true,navigationButtons:false,keyboard:{enabled:true,bindToWindow:false},dragNodes:false,dragView:true,zoomView:true,tooltipDelay:500},
        manipulation:{
          enabled:false,
          initiallyActive:false,
          addEdge:false,
          editEdge:false,
          addNode:(nodeData,callback)=>{
            const selected=metaOf(selectedNodeRef.current);
            const groupUid=selected?.kind==='group'
              ?selected.groupUid
              :(selected?.kind==='item'||selected?.kind==='keyword')?String(selected.row?.group_uid||''):'';
            handlersRef.current.onNewItem?.(groupUid);
            callback(null);
          },
          editNode:(nodeData,callback)=>{
            const meta=metaOf(nodeData?.id);
            selectMeta(meta);
            if(meta?.kind==='class'||meta?.kind==='group')handlersRef.current.onMessage?.('請在群組對應調整頁編輯名稱與內容。');
            callback(null);
          },
          deleteNode:(selection,callback)=>{
            const ids=Array.isArray(selection?.nodes)?selection.nodes:[];
            const metas=ids.map(metaOf).filter(Boolean);
            Promise.all(metas.map(meta=>{
              if(meta.kind==='keyword')return handlersRef.current.onDeleteKeyword?.(meta.row,meta.keyword);
              if(meta.kind==='item')return handlersRef.current.onDeleteItem?.(meta.row);
              if(meta.kind==='group')return handlersRef.current.onDeleteGroup?.(meta.groupUid);
              handlersRef.current.onMessage?.('請在群組對應調整頁管理關鍵字群組。');
              return false;
            })).then(results=>{
              if(results.every(Boolean))callback(selection);
              else callback(null);
            }).catch(()=>callback(null));
          }
        },
        nodes:{chosen:true},
        edges:{selectionWidth:2,hoverWidth:1.5}
      });
      networkRef.current=network;
      const retainedSelection=selectedNodeRef.current;
      const previousView=viewportRef.current;
      if(previousView?.classId===classId){
        network.moveTo({position:previousView.position,scale:previousView.scale,animation:false});
      }else{
        const originId='group:'+graphOriginGroup(items);
        if(graph.meta.has(originId)){
          selectedNodeRef.current=originId;
          network.selectNodes([originId]);
          network.focus(originId,{scale:1.05,animation:false});
        }else network.fit({animation:false});
      }
      network.on('selectNode',event=>{
        const id=String(event.nodes?.[0]||'');
        selectedNodeRef.current=id;
        const meta=metaOf(id);
        if(meta?.kind==='group'){
          setExpandedGroup(meta.groupUid);
          setExpandedItemId('');
          handlersRef.current.onSelectGroup?.(meta.groupUid);
        }else if(meta?.kind==='item'){
          setExpandedGroup(String(meta.row?.group_uid||''));
          setExpandedItemId(String(meta.row?.keyword_id||''));
        }
        selectMeta(meta);
      });
      network.on('deselectNode',()=>{selectedNodeRef.current='';});
      network.on('doubleClick',event=>{
        const id=String(event.nodes?.[0]||'');
        if(!id)return;
        selectedNodeRef.current=id;
        network.selectNodes([id]);
        network.editNode();
      });

      if(retainedSelection&&graph.meta.has(retainedSelection)){
        network.selectNodes([retainedSelection]);
      }
      if(selectedId){
        const itemNode='item:'+String(selectedId);
        if(graph.meta.has(itemNode)){
          selectedNodeRef.current=itemNode;
          network.selectNodes([itemNode]);
        }
      }
    }).catch(reason=>{if(!cancelled)setError(reason?.message||'vis-network 載入失敗。');});
    return()=>{
      cancelled=true;
      if(network){
        viewportRef.current={classId,position:network.getViewPosition(),scale:network.getScale()};
        if(networkRef.current===network)networkRef.current=null;
        network.destroy();
      }
    };
  },[graph,classId,themeRevision]);
  useEffect(()=>{
    const itemNode='item:'+String(selectedId||'');
    if(selectedId&&graph.meta.has(itemNode)&&networkRef.current){
      networkRef.current.selectNodes([itemNode]);
    }
  },[selectedId,graph]);

  return <section className={'scope-keyword-network'+(fullscreen?' is-fullscreen':'')} aria-label="關鍵詞階層圖">
    <div className="scope-keyword-network-help">
      <strong>關鍵字群組科目 → 關鍵字分類群組 → 關鍵詞分類 → 判斷詞列表</strong>
      <span>點選節點即可在圖旁編輯。拖曳空白處移動畫布，雙指縮放；按 Esc 退出全螢幕。</span>
    </div>
    <div className="scope-stat-controls" role="group" aria-label="關鍵詞圖譜觸控操作">
      <button type="button" className="loc-button" onClick={()=>{
        const network=networkRef.current;
        const selected=network?.getSelectedNodes()?.[0];
        const meta=graph.meta.get(String(selected||''));
        if(meta?.kind==='group')handlersRef.current.onSelectGroup?.(meta.groupUid);
        else if(meta?.kind==='item'||meta?.kind==='keyword')handlersRef.current.onSelectItem?.(meta.row);
        else handlersRef.current.onMessage?.('先點選分類群組或關鍵詞節點。');
      }}>編輯選取</button>
      <button type="button" className="loc-button" onClick={()=>{
        const selected=networkRef.current?.getSelectedNodes()?.[0];
        const meta=graph.meta.get(String(selected||''));
        const groupUid=meta?.kind==='group'?meta.groupUid:
          (meta?.kind==='item'||meta?.kind==='keyword')?String(meta.row?.group_uid||''):'';
        if(groupUid)handlersRef.current.onNewItem?.(groupUid);
        else handlersRef.current.onMessage?.('請先選擇分類群組，再新增關鍵詞分類。');
      }}>＋新增關鍵詞</button>
      <button type="button" className="loc-button" onClick={()=>networkRef.current?.fit({animation:false})}>重置視野</button>
      <button type="button" className="loc-button" aria-pressed={fullscreen}
        onClick={()=>setFullscreen(value=>!value)}>{fullscreen?'退出全螢幕':'全螢幕'}</button>
    </div>
    {error?<p className="scope-status scope-error">{error}</p>:null}
    <div ref={containerRef} className="scope-graph-canvas scope-keyword-network-canvas" role="application" aria-label={className+' 關鍵詞 vis-network 編輯器'}/>
  </section>;
}
