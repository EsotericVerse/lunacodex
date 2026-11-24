'use client';

import {useEffect,useMemo,useRef,useState} from 'react';
import {motion,useReducedMotion} from 'motion/react';
import {searchRelationGroups,relationGraph} from './search-relation-model.mjs';
import {featureNavigationHref} from './routing/feature-navigation';
import {PUBLISHED_SEARCH_PATTERNS} from './published-search-patterns.js';
import {compileKeywordLiteralMatcher} from '../loc/keywords/literal-matcher.mjs';
import {keywordScanText} from '../loc/keywords/content-filter.mjs';

const norm=value=>String(value??'').normalize('NFKC').trim().toLocaleLowerCase('zh-Hant');
export default function SearchRelationNetwork({scopeId,row,onGalaxySelect}){
  const host=useRef(null),network=useRef(null),latest=useRef(null);
  const reduceMotion=useReducedMotion();
  const matcher=useMemo(()=>{
    const words=PUBLISHED_SEARCH_PATTERNS[scopeId]||[];
    return words.length?compileKeywordLiteralMatcher(words.map(norm)):null;
  },[scopeId]);
  const hits=useMemo(()=>matcher&&row.keyword!==false
    ?matcher.countMatches(norm(keywordScanText(row))).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])):null,[matcher,row]);
  const groups=useMemo(()=>searchRelationGroups(row,hits?.length??null),[row,hits]);
  const [expanded,setExpanded]=useState('relation');
  const active=groups.find(g=>g.id===expanded)||null;
  const [failed,setFailed]=useState(false);
  const model=useMemo(()=>relationGraph(groups,expanded,row.title),[groups,expanded,row.title]);
  const act=item=>{
    if(!item?.action)return;
    const action=item.action;
    if(action.kind==='galaxy')onGalaxySelect?.(action.uid);
    else if(action.kind==='feature')window.location.assign(featureNavigationHref(scopeId,action.feature,action.navigation));
    else if(action.kind==='external'&&window.confirm('即將離開 LOC 並開啟外部網站：\n'+action.href))
      window.open(action.href,'_blank','noopener,noreferrer');
  };
  latest.current={model,groups,act,reduceMotion};
  function dataFor(model){
    const css=getComputedStyle(host.current);
    const text=css.getPropertyValue('--loc-text').trim()||'#eef2fa';
    const panel=css.getPropertyValue('--loc-panel').trim()||'#162536';
    const accent=css.getPropertyValue('--loc-accent').trim()||'#84aaff';
    return {nodes:model.nodes.map(node=>({...node,margin:node.kind==='root'?14:8,
      borderWidth:node.kind==='root'?3:1.5,color:{background:panel,border:node.colorKey||accent,
        highlight:{background:panel,border:node.colorKey||accent}},font:{color:text,size:node.kind==='root'?16:12},
      widthConstraint:{maximum:node.kind==='root'?190:150}})),
      edges:model.edges.map(edge=>({...edge,color:{color:edge.colorKey,opacity:.8},
        width:1.8,arrows:{to:{enabled:true,scaleFactor:.45}},smooth:{type:'cubicBezier',forceDirection:'horizontal',roundness:.35}}))};
  }
  useEffect(()=>{
    let disposed=false,instance;
    if(!host.current)return;
    import('vis-network/esnext').then(({Network})=>{
      if(disposed||!host.current)return;
      instance=new Network(host.current,dataFor(latest.current.model),{
        autoResize:true,physics:false,layout:{hierarchical:{enabled:true,
          direction:host.current.clientWidth<500?'UD':'LR',sortMethod:'directed',
          levelSeparation:175,nodeSpacing:82,treeSpacing:95}},
        interaction:{hover:true,dragNodes:false,dragView:true,zoomView:true,
          keyboard:{enabled:true,bindToWindow:false}},manipulation:false});
      network.current=instance;
      instance.on('click',event=>{
        const id=String(event.nodes?.[0]||'');
        if(id.startsWith('branch:'))setExpanded(value=>value===id.slice(7)?'':id.slice(7));
        else if(id==='root')setExpanded('');
        else{
          const item=latest.current.groups.flatMap(group=>group.items).find(item=>item.id===id);
          if(item)latest.current.act(item);
        }
      });
      instance.fit({animation:false});
    }).catch(()=>{if(!disposed)setFailed(true);});
    return()=>{disposed=true;instance?.destroy();if(network.current===instance)network.current=null;};
  },[]);
  useEffect(()=>{
    if(!network.current||!host.current)return;
    network.current.setData(dataFor(model));
    network.current.fit({animation:reduceMotion?false:{duration:230,easingFunction:'easeInOutQuad'}});
  },[model,reduceMotion]);
  if(!groups.length)return null;
  return <section className="loc-search-network" aria-label="文章關聯網絡">
    <h3>關聯網絡</h3>
    <div className="loc-search-network__branches" role="group" aria-label="關聯分支">
      {groups.map(group=><button type="button" key={group.id} className="loc-button"
        aria-pressed={expanded===group.id} style={{borderColor:group.color}}
        onClick={()=>setExpanded(value=>value===group.id?'':group.id)}>{group.label} · {group.items.length}</button>)}
    </div>
    {!failed?<motion.div ref={host} className="loc-search-network__canvas"
      initial={reduceMotion?false:{opacity:0}} animate={{opacity:1}} transition={{duration:.25}}
      role="img" aria-label="本文與各關聯分支的網絡圖"/>:<p role="status" className="scope-status">網絡圖無法載入，仍可使用下方連結。</p>}
    {active?<div className="loc-search-network__links">
      {active.items.map(item=>item.action?<button type="button" key={item.id} className="loc-button"
        onClick={()=>act(item)}>{item.label}</button>:<span key={item.id}>{item.label}</span>)}
      {active.id==='statistics'&&hits?<div className="loc-search-network__distribution">
        <p>本文公開詞彙命中 {hits.length} 種 · {hits.reduce((n,[,count])=>n+count,0)} 次</p>
        {hits.slice(0,8).map(([word,count])=><div key={word} className="loc-search-network__count">
          <span>{word}</span><span className="loc-search-network__bar"><i style={{width:(100*count/hits[0][1])+'%'}}/></span><strong>{count}</strong>
        </div>)}
      </div>:null}
    </div>:null}
  </section>;
}
