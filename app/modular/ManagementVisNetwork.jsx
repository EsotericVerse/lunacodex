'use client';

import {useEffect,useRef} from 'react';
import {useReducedMotion} from 'motion/react';
import {LOC_MOTION} from '../motion-tokens.mjs';

function themeTokens(){
  const css=getComputedStyle(document.documentElement);
  const token=(name,fallback)=>css.getPropertyValue(name).trim()||fallback;
  const text=css.color||'currentColor';
  const panel=css.backgroundColor||'transparent';
  const line=token('--loc-line',token('--loc-line-soft',text));
  return {
    text:token('--loc-text',text),
    muted:token('--loc-muted',text),
    accent:token('--loc-accent',text),
    panel:token('--loc-panel',panel),
    soft:token('--loc-panel-2',token('--loc-surface-soft',panel)),
    line,
    edge:token('--loc-graph-edge',token('--loc-line-soft',line)),
    selected:token('--loc-accent-surface-strong',token('--loc-accent-surface',panel))
  };
}

function graphData(model,theme){
  const nodes=model.nodes.map(node=>{
    const root=Number(node.level)===0;
    const selected=String(node.id)===String(model.selectedId||'');
    const background=root?theme.soft:selected?theme.selected:theme.panel;
    const border=selected?theme.accent:root?theme.line:theme.line;
    return {...node,shape:node.shape||'box',borderWidth:selected?2:1,
      shapeProperties:{borderRadius:root?19:15,...node.shapeProperties},
      shadow:node.shadow||{enabled:true,color:theme.edge,size:selected?11:7,x:0,y:3},
      color:{background,border,highlight:{background,border:theme.accent},
        hover:{background:theme.soft,border:theme.accent}},
      font:{color:root?theme.text:selected?theme.accent:theme.text,
        face:'system-ui',size:root?17:selected?15:14,...node.font},
      margin:node.margin||{top:12,right:17,bottom:12,left:17},
      widthConstraint:node.widthConstraint||{maximum:210}
    };
  });
  const edges=model.edges.map(edge=>({
    ...edge,color:{color:theme.edge,highlight:theme.accent,hover:theme.accent},
    width:String(edge.to)===String(model.selectedId||'')?2:1,
    selectionWidth:1.5,hoverWidth:1.2,
    smooth:{enabled:true,type:'cubicBezier',forceDirection:'horizontal',roundness:.3,...edge.smooth}
  }));
  return {nodes,edges};
}

/** Small theme-aware canvas used by management navigation and home-block editing. */
export default function ManagementVisNetwork({
  nodes=[],edges=[],selectedId='',onSelect,ariaLabel='管理關係圖',
  className='',onStatusChange,fitKey=''
}){
  const host=useRef(null),network=useRef(null),latest=useRef({});
  const reduceMotion=useReducedMotion();
  const modelKey=JSON.stringify([nodes,edges]);
  latest.current={nodes,edges,selectedId,onSelect,onStatusChange,reduceMotion,fitKey};

  useEffect(()=>{
    let cancelled=false,instance=null,observer=null,resizer=null;
    const apply=({fit=false}={})=>{
      if(!instance||!host.current)return;
      const view={position:instance.getViewPosition(),scale:instance.getScale()};
      const tokens=themeTokens();
      const data=graphData(latest.current,tokens);
      instance.setData(data);
      instance.setOptions({
        nodes:{font:{face:'system-ui',color:tokens.text},chosen:true},
        edges:{color:{color:tokens.edge,highlight:tokens.accent,hover:tokens.accent},
          selectionWidth:1.5,hoverWidth:1.2}
      });
      const active=latest.current.nodes.some(node=>String(node.id)===String(latest.current.selectedId));
      instance.selectNodes(active?[latest.current.selectedId]:[]);
      if(fit){
        instance.fit({animation:latest.current.reduceMotion?false:
          {duration:LOC_MOTION.standard*1000,easingFunction:'easeInOutQuad'},maxZoomLevel:1.15});
      }else if(view.position&&Number.isFinite(view.scale)){
        instance.moveTo({position:view.position,scale:view.scale,animation:false});
      }
    };
    if(!host.current)return undefined;
    latest.current.onStatusChange?.('loading','');
    import('vis-network/esnext').then(({Network})=>{
      if(cancelled||!host.current)return;
      instance=new Network(host.current,{nodes:[],edges:[]},{
        autoResize:true,physics:false,layout:{improvedLayout:false},
        interaction:{hover:true,dragNodes:false,dragView:true,zoomView:true,
          selectable:true,selectConnectedEdges:false,keyboard:{enabled:true,bindToWindow:false}},
        nodes:{shape:'box',chosen:true},edges:{smooth:{enabled:true}},manipulation:false
      });
      network.current=instance;
      instance.on('selectNode',params=>{
        const id=String(params?.nodes?.[0]||'');
        if(id&&latest.current.nodes.some(node=>String(node.id)===id))
          latest.current.onSelect?.(id);
      });
      apply({fit:true});
      observer=new MutationObserver(()=>apply());
      observer.observe(document.documentElement,{attributes:true,
        attributeFilter:['style','data-theme-id','data-scheme']});
      if(typeof ResizeObserver!=='undefined'){
        resizer=new ResizeObserver(()=>apply({fit:true}));
        resizer.observe(host.current);
      }
      latest.current.onStatusChange?.('ready','');
    }).catch(reason=>{
      if(cancelled)return;
      latest.current.onStatusChange?.('error',String(reason?.message||reason||'vis-network 載入失敗。'));
    });
    return()=>{
      cancelled=true;observer?.disconnect();resizer?.disconnect();
      if(network.current===instance)network.current=null;
      instance?.destroy();
    };
  },[]);

  useEffect(()=>{
    if(!network.current)return;
    const tokens=themeTokens();
    const view={position:network.current.getViewPosition(),scale:network.current.getScale()};
    network.current.setData(graphData(latest.current,tokens));
    network.current.selectNodes(nodes.some(node=>String(node.id)===String(selectedId))?[selectedId]:[]);
    if(fitKey)network.current.fit({animation:reduceMotion?false:
      {duration:LOC_MOTION.fast*1000,easingFunction:'easeInOutQuad'},maxZoomLevel:1.15});
    else if(view.position&&Number.isFinite(view.scale))
      network.current.moveTo({position:view.position,scale:view.scale,animation:false});
  },[modelKey,selectedId,fitKey,reduceMotion]);

  return <div ref={host} className={['management-vis-network',className].filter(Boolean).join(' ')}
    aria-hidden="true" data-network-label={ariaLabel}/>;
}
