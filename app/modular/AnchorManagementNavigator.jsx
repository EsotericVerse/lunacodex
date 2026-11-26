'use client';

import {useMemo,useState} from 'react';
import {motion,useReducedMotion} from 'motion/react';

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
  return <section className={['loc-anchor-management',className].filter(Boolean).join(' ')}
    aria-label={label}>
    <label className="loc-anchor-management__search">
      <span>{searchLabel}</span>
      <input type="search" className="scope-search-input" value={query}
        onChange={event=>setQuery(event.target.value)} placeholder={searchPlaceholder}/>
    </label>
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
