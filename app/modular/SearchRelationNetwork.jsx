'use client';

import {useEffect,useMemo,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {motion,useReducedMotion} from 'motion/react';
import {searchRelationGroups,relationGraph} from './search-relation-model.mjs';
import {mixVisualRgb,themedDataColor,visualColor} from './visual-palette.mjs';
import {featureNavigationHref} from './routing/feature-navigation';
import {PUBLISHED_SEARCH_PATTERNS} from './published-search-patterns.js';
import {compileKeywordLiteralMatcher} from '../loc/keywords/literal-matcher.mjs';
import {keywordScanText} from '../loc/keywords/content-filter.mjs';
import {useFeatureFocus} from './feature-focus';

const norm=value=>String(value??'').normalize('NFKC').trim().toLocaleLowerCase('zh-Hant');
export default function SearchRelationNetwork({scopeId,row,onGalaxySelect}){
  const host=useRef(null),network=useRef(null),latest=useRef(null),dataRef=useRef(null);
  const router=useRouter();
  const {selectFocus}=useFeatureFocus(scopeId);
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
    selectFocus({feature:'search',kind:action.kind||'relation',
      id:String(item.id||action.uid||item.label||row.uid),
      label:String(item.label||row.title||'搜尋關聯')});
    if(action.kind==='galaxy')onGalaxySelect?.(action.uid);
    else if(action.kind==='feature')router.push(featureNavigationHref(scopeId,action.feature,action.navigation));
    else if(action.kind==='external'&&window.confirm('即將離開 LOC 並開啟外部網站：\n'+action.href))
      window.open(action.href,'_blank','noopener,noreferrer');
  };
  const chooseGroup=group=>{
    setExpanded(value=>value===group.id?'':group.id);
    selectFocus({feature:'search',kind:'relation-group',id:group.id,label:group.label});
  };
  const chooseRoot=()=>{
    setExpanded('');
    selectFocus({feature:'search',kind:'article',id:String(row.uid),label:String(row.title||row.uid)});
  };
  latest.current={model,groups,act,reduceMotion,chooseGroup,chooseRoot};
  function dataFor(model){
    const css=getComputedStyle(host.current);
    const text=css.getPropertyValue('--loc-text').trim()||'#eef2fa';
    const panel=css.getPropertyValue('--loc-panel').trim()||'#162536';
    const accent=css.getPropertyValue('--loc-accent').trim()||'#84aaff';
    const branchColor=base=>base?mixVisualRgb(base,accent):accent;
    return {nodes:model.nodes.map(node=>{
      const border=branchColor(node.colorKey);
      const background=node.colorKey?mixVisualRgb(node.colorKey,panel,.12):panel;
      return {...node,shape:'box',shapeProperties:{borderRadius:node.kind==='root'?18:13},
        shadow:{enabled:true,color:'rgba(0,0,0,.16)',size:10,x:0,y:4},
        margin:node.kind==='root'?14:9,borderWidth:node.kind==='root'?2.5:1.25,
        color:{background,border,
          hover:{background:mixVisualRgb(background,accent,.18),border:accent},
          highlight:{background:mixVisualRgb(background,accent,.12),border:accent}},
        font:{color:text,size:node.kind==='root'?16:12},
        widthConstraint:{maximum:node.kind==='root'?190:150}};
      }),
      edges:model.edges.map(edge=>({...edge,color:{color:branchColor(edge.colorKey),opacity:.85},
        width:1.8,arrows:{to:{enabled:true,scaleFactor:.45}},smooth:{type:'cubicBezier',forceDirection:'horizontal',roundness:.35}}))};
  }
  const hasGroups=groups.length>0;
  useEffect(()=>{
    let disposed=false,instance,observer;
    if(!host.current)return;
    Promise.all([import('vis-network/esnext'),import('vis-data/esnext')]).then(([{Network},{DataSet}])=>{
      if(disposed||!host.current)return;
      const initial=dataFor(latest.current.model);
      const data={nodes:new DataSet(initial.nodes),edges:new DataSet(initial.edges)};
      dataRef.current=data;
      instance=new Network(host.current,data,{
        autoResize:true,physics:false,layout:{hierarchical:{enabled:true,
          direction:host.current.clientWidth<500?'UD':'LR',sortMethod:'directed',
          levelSeparation:175,nodeSpacing:82,treeSpacing:95}},
        interaction:{hover:true,dragNodes:false,dragView:true,zoomView:true,
          keyboard:{enabled:true,bindToWindow:false}},manipulation:false});
      network.current=instance;
      instance.on('click',event=>{
        const id=String(event.nodes?.[0]||'');
        if(id.startsWith('branch:')){
          const group=latest.current.groups.find(item=>item.id===id.slice(7));
          if(group)latest.current.chooseGroup(group);
        }
        else if(id==='root')latest.current.chooseRoot();
        else{
          const item=latest.current.groups.flatMap(group=>group.items).find(item=>item.id===id);
          if(item)latest.current.act(item);
        }
      });
      instance.fit({animation:false});
      observer=new MutationObserver(()=>{
        if(disposed||!host.current||dataRef.current!==data)return;
        const next=dataFor(latest.current.model);
        data.nodes.update(next.nodes.map(({id,color,font})=>({id,color,font})));
        data.edges.update(next.edges.map(({id,color})=>({id,color})));
      });
      observer.observe(document.documentElement,{attributes:true,
        attributeFilter:['data-theme-id','data-theme-signature','data-theme','style']});
    }).catch(()=>{if(!disposed)setFailed(true);});
    return()=>{disposed=true;observer?.disconnect();instance?.destroy();
      if(network.current===instance){network.current=null;dataRef.current=null;}};
  },[hasGroups]);
  useEffect(()=>{
    if(!network.current||!host.current||!dataRef.current)return;
    const next=dataFor(model),data=dataRef.current;
    const nodeIds=new Set(next.nodes.map(n=>n.id)),edgeIds=new Set(next.edges.map(e=>e.id));
    data.edges.remove(data.edges.getIds().filter(id=>!edgeIds.has(id)));
    data.nodes.remove(data.nodes.getIds().filter(id=>!nodeIds.has(id)));
    data.nodes.update(next.nodes);data.edges.update(next.edges);
    network.current.fit({animation:reduceMotion?false:{duration:230,easingFunction:'easeInOutQuad'}});
  },[model,reduceMotion]);
  if(!groups.length)return null;
  const motionTransition=reduceMotion?{duration:0}:{type:'spring',stiffness:380,damping:30};
  return <section className="loc-search-network" aria-label="文章關聯網絡">
    <h3>關聯網絡</h3>
    <div className="loc-search-network__branches" role="group" aria-label="關聯分支">
      {groups.map(group=><motion.button layout type="button" key={group.id} className="loc-button"
        aria-pressed={expanded===group.id} style={{borderColor:themedDataColor(group.color)}}
        transition={motionTransition}
        whileHover={reduceMotion?undefined:{y:-2}}
        whileTap={reduceMotion?undefined:{scale:.97}}
        onClick={()=>chooseGroup(group)}>{group.label} · {group.items.length}</motion.button>)}
    </div>
    {!failed?<motion.div ref={host} className="loc-search-network__canvas"
      initial={reduceMotion?false:{opacity:0}} animate={{opacity:1}} transition={{duration:.25}}
      role="img" aria-label="本文與各關聯分支的網絡圖"/>:<p role="status" className="scope-status">網絡圖無法載入，仍可使用下方連結。</p>}
    {active?<div className="loc-search-network__links">
      {active.items.map(item=>item.action?<motion.button layout type="button" key={item.id} className="loc-button"
        transition={motionTransition}
        whileHover={reduceMotion?undefined:{y:-1}}
        whileTap={reduceMotion?undefined:{scale:.98}}
        onClick={()=>act(item)}>{item.label}</motion.button>:<motion.span layout key={item.id}
          transition={motionTransition}>{item.label}</motion.span>)}
      {active.id==='statistics'&&hits?<div className="loc-search-network__distribution">
        <p>本文公開詞彙命中 {hits.length} 種 · {hits.reduce((n,[,count])=>n+count,0)} 次</p>
        {hits.slice(0,8).map(([word,count],index)=><div key={word} className="loc-search-network__count">
          <span>{word}</span><span className="loc-search-network__bar"><i style={{width:(100*count/hits[0][1])+'%',background:visualColor(index)}}/></span><strong>{count}</strong>
        </div>)}
      </div>:null}
    </div>:null}
  </section>;
}
