'use client';

import {useMemo,useState} from 'react';
import {motion,useReducedMotion} from 'motion/react';
import ManagementVisNetwork from './ManagementVisNetwork';

const normalize=value=>String(value||'').normalize('NFKC').toLocaleLowerCase('zh-Hant').trim();
const PANE_STAGGER_LIMIT=8;
const PANE_MOTION_ITEM_LIMIT=48;

function Pane({
  level,title,items=[],selected='',onSelect,createLabel,onCreate,createDisabled=false,
  emptyLabel='目前沒有項目',disabled=false,transitionKey='',children=null
}){
  const reduceMotion=useReducedMotion();
  const key=String(transitionKey||level);
  // Keep selection changes expressive for short panes without animating a
  // potentially large keyword or anchor list all at once.
  const animatePane=!reduceMotion&&items.length<=PANE_MOTION_ITEM_LIMIT;
  const initial=animatePane?{opacity:0,y:8}:false;
  const animate={opacity:1,y:0};
  const transition={duration:reduceMotion?0:.26,ease:[.22,1,.36,1]};
  return <section className={'loc-anchor-management__pane loc-anchor-management__pane--'+level}
    aria-label={title}>
    <header className="loc-anchor-management__pane-heading">
      <div><h3>{title}</h3><span>{items.length.toLocaleString('zh-TW')}</span></div>
      {onCreate&&createLabel?<button type="button" className="loc-button loc-anchor-management__create"
        disabled={disabled||createDisabled} onClick={onCreate}>{createLabel}</button>:null}
    </header>
    <motion.div key={key} className="loc-anchor-management__items"
      initial={initial} animate={animate} transition={transition}
      role="group" aria-label={title}>
      {items.map((item,index)=>{
        const props={key:String(item.id),type:'button',className:'loc-anchor-management__item',
          'aria-pressed':String(item.id)===String(selected),
          disabled:disabled||item.disabled===true,onClick:()=>onSelect?.(item.id)};
        const content=<><strong>{item.label}</strong>{item.meta?<small>{item.meta}</small>:null}</>;
        return animatePane&&index<PANE_STAGGER_LIMIT
          ?<motion.button {...props} initial={{opacity:0,y:5}} animate={{opacity:1,y:0}}
            transition={{duration:.2,delay:index*.022,ease:'easeOut'}}>{content}</motion.button>
          :<button {...props}>{content}</button>;
      })}
      {!items.length?<p className="scope-status loc-anchor-management__empty">{emptyLabel}</p>:null}
    </motion.div>
    {children?<motion.div key={key+':detail'} className="loc-anchor-management__detail-content"
      initial={initial} animate={animate} transition={{...transition,delay:reduceMotion?0:.04}}>
      {children}
    </motion.div>:null}
  </section>;
}

/** Shared two-column / three-level navigator for LOC's authored Anchor trees. */
export default function AnchorManagementNavigator({
  label='定錨管理',className='',searchLabel='搜尋分類與定錨資料',
  searchPlaceholder='依名稱、日期或地址搜尋',
  primaryTitle='第一層',primaryItems=[],selectedPrimary='',onSelectPrimary,
  primaryCreateLabel='',onCreatePrimary=null,primaryCreateDisabled=false,
  secondaryTitle='第二層',secondaryItems=[],selectedSecondary='',onSelectSecondary,
  secondaryCreateLabel='',onCreateSecondary=null,secondaryCreateDisabled=false,
  detailTitle='定錨資料與操作',detailItems=[],selectedDetail='',onSelectDetail,
  detailCreateLabel='',onCreateDetail=null,detailCreateDisabled=false,
  primaryEmpty='目前沒有第一層分類',secondaryEmpty='請先選擇第一層分類',
  detailEmpty='請先選擇第二層分類',disabled=false,children=null
}){
  const [query,setQuery]=useState('');
  const needle=normalize(query);
  const filter=items=>needle
    ?items.filter(item=>normalize(item.searchText||[item.label,item.meta].join(' ')).includes(needle))
    :items;
  const primary=useMemo(()=>filter(primaryItems),[primaryItems,needle]);
  const secondary=useMemo(()=>filter(secondaryItems),[secondaryItems,needle]);
  const detail=useMemo(()=>filter(detailItems),[detailItems,needle]);
  const graph=useMemo(()=>{
    const rootId='anchor-root:'+label;
    const nodes=[{id:rootId,label,level:0,x:0,y:0,fixed:true,widthConstraint:{maximum:180}}];
    const edges=[];
    const addPane=(items,level,parentId,selectedId)=>{
      const visible=items.slice(0,level===3?24:40);
      const x=level===1?230:level===2?490:750;
      const gap=level===3?58:76;
      const center=(visible.length-1)/2;
      for(const [index,item] of visible.entries()){
        const id='anchor-'+level+':'+String(item.id);
        nodes.push({id,label:String(item.label||item.id).slice(0,42),level,
          x,y:(index-center)*gap,fixed:true,widthConstraint:{maximum:190}});
        edges.push({id:parentId+'>'+id,from:parentId,to:id});
      }
      if(selectedId&&visible.some(item=>String(item.id)===String(selectedId)))
        return 'anchor-'+level+':'+String(selectedId);
      return '';
    };
    const selectedPrimaryNode=addPane(primary,1,rootId,selectedPrimary);
    const selectedSecondaryNode=selectedPrimaryNode
      ?addPane(secondary,2,selectedPrimaryNode,selectedSecondary):'';
    const selectedDetailNode=selectedSecondaryNode
      ?addPane(detail,3,selectedSecondaryNode,selectedDetail):'';
    return {nodes,edges,selectedId:selectedDetailNode||selectedSecondaryNode||selectedPrimaryNode};
  },[label,primary,secondary,detail,selectedPrimary,selectedSecondary,selectedDetail]);
  const [networkState,setNetworkState]=useState('loading');
  const [networkError,setNetworkError]=useState('');
  return <section className={['loc-anchor-management',className].filter(Boolean).join(' ')}
    aria-label={label}>
    <label className="loc-anchor-management__search">
      <span>{searchLabel}</span>
      <input type="search" className="scope-search-input" value={query}
        onChange={event=>setQuery(event.target.value)} placeholder={searchPlaceholder}/>
    </label>
    <div className="loc-anchor-management__graph-shell">
      <ManagementVisNetwork nodes={graph.nodes} edges={graph.edges}
        selectedId={graph.selectedId} className="loc-anchor-management__graph"
        ariaLabel={label+'階層圖'} onStatusChange={(state,message)=>{
          setNetworkState(state);
          if(state==='error')setNetworkError(message);
        }} onSelect={id=>{
          const [level,...parts]=String(id).split(':');
          const selectedId=parts.join(':');
          if(level==='anchor-1')onSelectPrimary?.(selectedId);
          else if(level==='anchor-2')onSelectSecondary?.(selectedId);
          else if(level==='anchor-3')onSelectDetail?.(selectedId);
        }}/>
      {networkState==='loading'?<p className="scope-status" role="status">正在整理定錨層級…</p>:null}
      {networkState==='error'?<p className="scope-status scope-error" role="status">
        階層圖目前無法載入，仍可使用下方清單。{networkError}</p>:null}
      {(primary.length>40||secondary.length>40||detail.length>24)
        ?<p className="scope-status">圖上顯示目前分層的前段項目；完整清單仍列於下方。</p>:null}
    </div>
    <div className="loc-anchor-management__grid">
      <Pane level="primary" title={primaryTitle} items={primary}
        selected={selectedPrimary} onSelect={onSelectPrimary}
        createLabel={primaryCreateLabel} onCreate={onCreatePrimary} createDisabled={primaryCreateDisabled}
        emptyLabel={primaryEmpty} disabled={disabled} transitionKey={selectedPrimary}/>
      <div className="loc-anchor-management__right">
        <Pane level="secondary" title={secondaryTitle} items={secondary}
          selected={selectedSecondary} onSelect={onSelectSecondary}
          createLabel={secondaryCreateLabel} onCreate={onCreateSecondary} createDisabled={secondaryCreateDisabled}
          emptyLabel={secondaryEmpty} disabled={disabled} transitionKey={selectedPrimary}/>
        <Pane level="detail" title={detailTitle} items={detail}
          selected={selectedDetail} onSelect={onSelectDetail}
          createLabel={detailCreateLabel} onCreate={onCreateDetail} createDisabled={detailCreateDisabled}
          emptyLabel={detailEmpty} disabled={disabled}
          transitionKey={selectedSecondary||selectedPrimary}>
          {children}
        </Pane>
      </div>
    </div>
  </section>;
}
