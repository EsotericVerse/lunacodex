'use client';

import {useEffect,useRef,useState} from 'react';
import {motion,useReducedMotion} from 'motion/react';
import {createPortal} from 'react-dom';
import EffekseerStage,{WaitingEffekseerStage,RuneMistBackdrop} from './effekseer/EffekseerStage';
import {navigationHref} from '../modular/scope-registry.js';
import useNativeNavigation from '../modular/use-native-navigation';
import ScopeLink from '../modular/ScopeLink';
import {selectRows} from '../loc/db-query.mjs';
import {realMoonPhase} from '../loc/model/moon-phase';
import {randomIndex,loadDrawCards,buildFixedReading} from './rune-draw-core.mjs';
import {runeImage,runeName,RUNE_CARD_BACK_IMAGE} from './rune-directory.mjs';
import {runeDrawGroup,runeDrawMotion,runeDrawOrbitGlyphs} from './rune-draw-motion.mjs';
import RuneCardInfo from './RuneCardInfo';
import {lRunes66ColumnString} from '../../zenstack/lrunes-read-model.mjs';
import './skin-lab.css';
import './effekseer/effekseer-stage.css';

const DIRECTIONS=['正位','半正位','半逆位','逆位'];
const DAILY_FIELDS=[['sit_q','狀況形容'],['sit_a','狀況表達'],['daily_r','每日占卜提醒'],['daily_g','每日占卜引導'],['daily_b','每日占卜祝福']];
const GROUP_COLUMNS='group_id,english_name,desc,quality,style,runeslist';
const RUNE_COLUMNS=lRunes66ColumnString('rune_id','rune_name','english_name','totem','group_name','moon_phase','card_attr','rune_description','archetype','char_action','positive_keywords','negative_keywords');
const GROUP_NAMES=['靈魂','連結','生命','自然','礦物','元素','秩序','無序','特殊'];
const MODES=[['duel','抽牌'],['daily','每日符文'],['list','符文圖鑑']];

function ResultDialog({title,children,onClose}){
  const dialogRef=useRef(null);
  const closeRef=useRef(onClose);
  closeRef.current=onClose;
  useEffect(()=>{
    const previousFocus=document.activeElement;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    dialogRef.current?.querySelector('button')?.focus();
    const handleKey=event=>{
      if(event.key==='Escape'){
        event.preventDefault();
        closeRef.current();
        return;
      }
      if(event.key!=='Tab'||!dialogRef.current)return;
      const dialog=dialogRef.current;
      const focusable=Array.from(dialog.querySelectorAll(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
      )).filter(element=>element.getClientRects().length>0);
      if(!focusable.length){
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first=focusable[0],last=focusable[focusable.length-1];
      if(event.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){
        event.preventDefault();
        last.focus();
      }else if(!event.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown',handleKey);
    return()=>{
      document.removeEventListener('keydown',handleKey);
      document.body.style.overflow=previousOverflow;
      if(previousFocus instanceof HTMLElement&&previousFocus.isConnected)previousFocus.focus();
    };
  },[]);
  // The canonical LOC content frame owns .loc-panel p theme colors.
  // Overlay dialogs must portal out of that frame to retain their dedicated
  // dark-surface text contrast (as the original-art rune dialogs already do).
  if(typeof document==='undefined')return null;
  return createPortal(<div className="rune-3d-modal-backdrop" role="presentation" onClick={onClose}>
    <section ref={dialogRef} tabIndex={-1} className="rune-3d-modal" role="dialog" aria-modal="true" aria-label={title} onClick={event=>event.stopPropagation()}>
      <header className="rune-3d-modal-head">
        <h2>{title}</h2>
        <button type="button" className="rune-skin-btn" onClick={onClose}>× 關閉</button>
      </header>
      <div className="rune-3d-daily-modal-fields">{children}</div>
    </section>
  </div>,document.body);
}
function readDaily(item){
  return DAILY_FIELDS.map(([key,label])=>({
    label,text:String(item.card?.rune_etc?.[key]?.[item.directionIndex+1]||'').trim()
  })).filter(field=>field.text);
}

export default function Rune3DPreview({mode='duel',presentationSwitcher=null}){
  const native=useNativeNavigation();
  const [items,setItems]=useState([]);
  const [groups,setGroups]=useState([]);
  const [group,setGroup]=useState(null);
  const [runes,setRunes]=useState([]);
  const [selected,setSelected]=useState(null);
  const [reading,setReading]=useState('');
  const [resultOpen,setResultOpen]=useState(false);
  const [finished,setFinished]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [moon,setMoon]=useState(()=>realMoonPhase());
  const [sample,setSample]=useState(null);
  const [focusedRune,setFocusedRune]=useState(null);
  const [ceremonySubject,setCeremonySubject]=useState('glyph');
  const [textureQuality,setTextureQuality]=useState('original');
  // Opt-in QA only: ?fog_preview=1 exposes native fog loading/alpha readings.
  const [diagnoseAmbient,setDiagnoseAmbient]=useState(false);
  // The licensed Effekseer smoke scene is now part of the main 3D draw stage.
  // No hidden runtime toggle: the black stage masks dark-matte sprite edges.
  useEffect(()=>{
    const query=new URLSearchParams(window.location.search);
    setTextureQuality(query.get('texture')==='hd256'?'hd256':'original');
    setDiagnoseAmbient(query.get('fog_preview')==='1');
  },[]);
  const [phase,setPhase]=useState('idle'); // idle → waiting → drawing → revealing → transfer → ready
  const [pending,setPending]=useState(null);
  const [summonRuneId,setSummonRuneId]=useState(null);
  const [transferTarget,setTransferTarget]=useState(null);
  const stageRef=useRef(null),slotRef=useRef(null),resultsRef=useRef(null);
  const drawStageSize=useRef({width:800,height:520});
  const reducedMotion=useReducedMotion();
  const lock=useRef(false);
  const live=useRef(true);
  const cards=useRef([]);

  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  useEffect(()=>{
    if(phase!=='transfer'||!pending)return;
    const frame=requestAnimationFrame(()=>{
      const shelf=resultsRef.current,slot=slotRef.current,area=stageRef.current;
      if(!area||!slot){setTransferTarget({x:0,y:0});return;}
      if(shelf)shelf.scrollLeft=shelf.scrollWidth;
      const origin=area.getBoundingClientRect(),target=slot.getBoundingClientRect();
      setTransferTarget({
        x:target.left+target.width/2-origin.left-origin.width/2,
        y:target.top+target.height/2-origin.top-origin.height/2
      });
    });
    return()=>cancelAnimationFrame(frame);
  },[phase,pending]);
  function completeTransfer(){
    if(phase!=='transfer'||!pending)return;
    const next=[...cards.current,pending];
    cards.current=next;
    setItems(next);setPending(null);setTransferTarget(null);
    setPhase('ready');
  }
  useEffect(()=>{
    if(mode!=='list')return;
    let active=true;
    setBusy(true);
    selectRows('silver.runes_group',{columns:GROUP_COLUMNS,limit:9,offset:0})
      .then(({rows})=>{
        if(!active)return;
        const mapped=(rows||[]).map(row=>{
          const nums=(Array.isArray(row.runeslist)?row.runeslist:[]).map(Number).filter(Number.isInteger);
          const primary=nums.filter(id=>id>=1&&id<=64);
          const index=primary.length?Math.floor((Math.min(...primary)-1)/8):8;
          return {...row,index,id:index+1,name:row.group_id||GROUP_NAMES[index],runeslist:nums};
        }).sort((a,b)=>a.index-b.index);
        setGroups(mapped);
      })
      .catch(e=>{if(active)setError('群組載入失敗：'+String(e?.message||e));})
      .finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;};
  },[mode]);
  useEffect(()=>{
    if(mode!=='list'||!group){setRunes([]);return;}
    let active=true;
    setBusy(true);setError('');
    const ids=[...new Set(group.runeslist)].filter(Number.isInteger);
    if(!ids.length){setBusy(false);return;}
    selectRows('silver.runes',{columns:RUNE_COLUMNS,
      filters:[{column:'rune_id',operator:'in',value:ids}],
      orders:[{column:'rune_id',ascending:true}],limit:ids.length,offset:0})
      .then(({rows})=>{if(active)setRunes(rows||[]);})
      .catch(e=>{if(active)setError('符文讀取失敗：'+String(e?.message||e));})
      .finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;};
  },[mode,group]);

  async function drawOne(){
    if(lock.current||busy||phase==='waiting'||phase==='drawing'||phase==='revealing'||phase==='transfer'||finished||
      (mode==='daily'&&cards.current.length)||(mode==='duel'&&cards.current.length>=11))return;
    lock.current=true;setBusy(true);setError('');
    const bounds=stageRef.current?.getBoundingClientRect();
    if(bounds?.width>0&&bounds?.height>0)drawStageSize.current={width:bounds.width,height:bounds.height};
    // Daily is one draw, one direct result; ritual waiting belongs to multi-card duel.
    if(mode!=='daily')setPhase('waiting');
    const started=Date.now();
    const currentMoon=realMoonPhase();
    setMoon(currentMoon);
    if(currentMoon==='未知'){
      setError('真實月相無法辨識，無法查詢籤詩。');setPhase(cards.current.length?'ready':'idle');
      setBusy(false);lock.current=false;return;
    }
    const used=new Set(cards.current.map(item=>Number(item.card.rune_id)));
    const remaining=Array.from({length:66},(_,i)=>i+1).filter(id=>!used.has(id));
    const runeNumber=remaining[randomIndex(remaining.length)];
    setSummonRuneId(runeNumber);
    const directionIndex=randomIndex(4);
    try{
      const rows=await loadDrawCards([{runeNumber,dir:directionIndex+1}],{
        staticTypes:mode==='daily'?['direction']:[],
        moonTypes:mode==='daily'?DAILY_FIELDS.map(([key])=>key):['sit_q'],
        currentMoon
      });
      const card=rows.find(row=>Number(row.rune_id)===runeNumber);
      if(!card)throw Error('符文資料無法讀取。');
      const item={card,direction:DIRECTIONS[directionIndex],directionIndex,moon:currentMoon,birth:Date.now()};
      if(live.current){
        if(mode==='daily'){
          // No one-second waiting, ceremonial reveal, transfer, or second button.
          cards.current=[item];
          setItems([item]);
          setPending(null);
          setTransferTarget(null);
          setFinished(true);
          setPhase('ready');
          setResultOpen(true);
        }else{
          const remainingWait=Math.max(0,380-(Date.now()-started));
          if(remainingWait)await new Promise(resolve=>setTimeout(resolve,remainingWait));
          if(live.current){setPending(item);setPhase('drawing');}
        }
      }
    }catch(e){if(live.current){
      setError('抽牌失敗：'+String(e?.message||e));
      setPhase(cards.current.length?'ready':'idle');
    }}
    finally{lock.current=false;if(live.current)setBusy(false);}
  }
  function reset(){
    if(lock.current||busy)return;
    cards.current=[];setItems([]);setReading('');setSelected(null);
    setPending(null);setSummonRuneId(null);setTransferTarget(null);setPhase('idle');
    setResultOpen(false);setFinished(false);setError('');setMoon(realMoonPhase());
  }
  function finish(){
    if(lock.current||busy||!items.length)return;
    if(finished){setResultOpen(true);return;}
    try{
      const count=items.length;
      const text=count===1?String(items[0].card?.rune_etc?.sit_q?.[items[0].directionIndex+1]||'').trim():
        buildFixedReading(items.map(item=>item.card),items.map(item=>item.direction),count===11?'ow3gs':count+'card').sentence;
      if(!text||text.includes('資訊不足'))throw Error('籤詩資料不完整。');
      setReading(text);setFinished(true);setResultOpen(true);
    }catch(e){setError(String(e?.message||e));}
  }
  const isList=mode==='list';
  // Draw and daily must not manifest a fabricated default Light Rune.
  // The symbol only appears once real canonical draw data is available.
  const latest=items[items.length-1]?.card;
  const presented=isList?(focusedRune||runes[0]||null):(phase==='revealing'?pending?.card||null:null);
  function choose(entry){setSelected(entry);}
  const label=isList?(group?group.name+'之符文':'九大符文群組'):mode==='daily'?'每日符文 · 3D':'月光抽牌 · 3D';
  const detailItem=isList?null:items.find(item=>Number(item.card.rune_id)===Number(selected?.rune_id));
  const details=isList?selected:detailItem?.card;
  const day=mode==='daily'?items[0]:null;
  const drawMotion=phase==='drawing'&&pending?
    runeDrawMotion(runeDrawGroup(pending.card),pending.directionIndex,drawStageSize.current,Boolean(reducedMotion),pending.card.rune_id):null;
  const orbitGroup=summonRuneId?runeDrawGroup({rune_id:summonRuneId}):
    items.length?runeDrawGroup(items[items.length-1].card):null;
  const orbitGlyphs=orbitGroup?runeDrawOrbitGlyphs(orbitGroup):[];
  return <main className="loc-next-main" data-rune-3d-preview={mode}>
    <div className="loc-panel rune-skin-lab rune-3d-shell">
    {presentationSwitcher}
    <header className="rune-3d-header">
      <p className="loc-eyebrow">LunaRunes · 符文顯現</p>
      <h1>{label}</h1>
      <p>抽中時由巨大符文字或漂浮卡圖登場，專屬 Effekseer 魔法鋪滿舞台，再一起歸位；抽牌規則維持不變。</p>
    </header>
    <nav className="rune-3d-toolbar" aria-label="顯示與模式切換">
      <span className="rune-3d-toolbar-label">{isList?(group?group.name+'組':'九大群組'):'真實月相：'+moon+' · '+items.length+' 枚'}</span>
      {isList?<span className="rune-3d-toolbar-label">專屬字樣 · 魔法顯現</span>:
        <div className="rune-3d-ceremony-subject" role="group" aria-label="召喚主體">
          <button type="button" aria-pressed={ceremonySubject==='glyph'}
            onClick={()=>setCeremonySubject('glyph')}>巨大符文字</button>
          <button type="button" aria-pressed={ceremonySubject==='card'}
            onClick={()=>setCeremonySubject('card')}>漂浮卡圖</button>
          <span className="rune-3d-toolbar-label">粒子貼圖：{textureQuality==='original'?'原始':'256'}</span>
        </div>}
    </nav>
    <section className="rune-3d-stage" aria-label={label} ref={stageRef}
      data-ritual-phase={isList?'atlas':phase}
      data-rune-group={isList?(focusedRune?runeDrawGroup(focusedRune):null):(pending?.card?runeDrawGroup(pending.card):null)}>
      {!isList?<div className="rune-3d-night-backdrop" aria-hidden="true">
        <span className="rune-skin-moon rune-3d-night-moon"/>
      </div>:null}
      {!isList?<div className="rune-3d-group-light" aria-hidden="true"/>:null}
      {!isList?<RuneMistBackdrop phase={phase} textureQuality={textureQuality} diagnoseAmbient={diagnoseAmbient}/>:null}
      {mode==='duel'&&['idle','waiting','ready'].includes(phase)?
        <div className="rune-3d-draw-deck" aria-hidden="true">
          <div className="rune-3d-draw-deck-card">
            <img className="rune-3d-card-back-emblem" src={RUNE_CARD_BACK_IMAGE} alt="" draggable="false"/>
            <small>月之符文</small>
          </div>
        </div>:null}
      {mode==='duel'&&orbitGlyphs.length>0&&['waiting','drawing','ready'].includes(phase)?
        <div className="rune-3d-moon-orbit" aria-hidden="true">
          <div className="rune-3d-moon-orbit-track">
            {orbitGlyphs.map((glyph,index)=><span key={index}
              className="rune-3d-moon-orbit-glyph" style={{'--orbit-angle':(index*90)+'deg'}}>{glyph}</span>)}
          </div>
        </div>:null}
      {isList?(presented?<EffekseerStage rune={presented} textureQuality={textureQuality}
        onGlyphClick={()=>choose(presented)}/>:<div className="rune-3d-awaiting">請選擇符文</div>):
        <>
          {(phase==='waiting'||phase==='drawing')&&summonRuneId?
            <WaitingEffekseerStage runeId={summonRuneId} textureQuality={textureQuality}/>:null}
          {phase==='waiting'?<div className="rune-3d-ritual-status" role="status">
            <span>月光正在挑選符文……</span>
          </div>:null}
          {phase==='drawing'&&pending?<div className="rune-3d-card-flight-plane" aria-hidden="true">
            <motion.div key={'drawn-'+pending.birth} className="rune-3d-drawn-card"
            data-draw-style={runeDrawGroup(pending.card)} data-draw-origin={drawMotion.appearance}
            initial={drawMotion.initial} animate={drawMotion.animate} transition={drawMotion.transition}
            onAnimationComplete={()=>setPhase(current=>current==='drawing'?'revealing':current)}>
            <div className="rune-3d-drawn-card-back">
              <img className="rune-3d-card-back-emblem" src={RUNE_CARD_BACK_IMAGE} alt="" draggable="false"/>
              <small>月之符文</small>
            </div>
            <div className="rune-3d-drawn-card-front">
              <img src={runeImage(pending.card)} alt=""/>
            </div>
            </motion.div>
          </div>:null}
          {phase==='revealing'&&pending?<EffekseerStage key={pending.birth}
            rune={pending.card} direction={pending.direction} ceremony
            appearance={ceremonySubject} cardSrc={runeImage(pending.card)}
            textureQuality={textureQuality} vfxOnly onCeremonyComplete={()=>setPhase(current=>current==='revealing'?'transfer':current)}
            onGlyphClick={()=>{}}/>:null}
          {phase==='idle'?<button type="button" className="rune-3d-tap-to-draw"
            onClick={drawOne} disabled={busy}>輕觸畫面，召喚符文</button>:null}
          {phase==='transfer'&&pending&&transferTarget?
            <motion.div className="rune-3d-flying-rune" aria-hidden="true"
              initial={{x:0,y:0,scale:1,opacity:1}}
              animate={{x:transferTarget.x,y:transferTarget.y,scale:.23,opacity:1}}
              transition={{duration:reducedMotion?.05:.9,ease:[.24,.77,.24,1]}}
              onAnimationComplete={completeTransfer}>
              {ceremonySubject==='card'?<img src={runeImage(pending.card)} alt=""/>:
                <span>{runeName(pending.card)}</span>}
            </motion.div>:null}
          {phase==='ready'?<div className="rune-3d-ritual-ready" role="group"
            aria-label="本次召喚完成後的操作">
            <p className="rune-3d-ritual-title">召喚完成，{items.length} 枚符文</p>
            <p className="rune-3d-ritual-instructions">
              {mode==='daily'?'今日符文已抽取完成。每日指引已自動顯示，可隨時重新查看。':
                finished?'抽牌已結束，可重新查看籤詩或重新開始。':
                items.length>=11?'已抽滿 11 枚符文，請查看籤詩或重新開始。':
                '請選擇繼續抽牌、停止抽牌看籤詩，或重新開始；下方也能查看每枚符文的細節。'}
            </p>
            <div className="rune-3d-ritual-actions">
              {mode==='duel'?<>
                <button type="button" data-action="continue" onClick={drawOne}
                  disabled={busy||finished||items.length>=11}>繼續抽牌</button>
                <button type="button" data-action="finish" onClick={finish}
                  disabled={busy}>停止抽牌看籤詩</button>
                <button type="button" data-action="restart" onClick={reset}
                  disabled={busy}>重新開始抽牌</button>
              </>:<button type="button" data-action="finish"
                onClick={()=>setResultOpen(true)}>重新查看今日指引</button>}
            </div>
          </div>:null}
          {items.length>0||phase==='transfer'?<div className="rune-3d-result-shelf"
            ref={resultsRef} role="group" aria-label="已抽出的符文結果">
            {items.map((item,i)=><button type="button" key={item.birth}
              className="rune-3d-result-rune" onClick={()=>choose(item.card)}
              aria-label={'查看第'+(i+1)+'枚 '+runeName(item.card)+' '+item.direction+'的細節'}>
              <span className="rune-3d-result-letter">{runeName(item.card)}</span>
              <small>{item.direction}</small>
            </button>)}
            {phase==='transfer'&&pending?<span ref={slotRef}
              className="rune-3d-result-slot" aria-hidden="true"/>:null}
          </div>:null}
          {error?<p className="rune-3d-ritual-error" role="alert">{error}</p>:null}
          <button type="button" className="rune-3d-fullscreen" aria-label="切換舞台全螢幕"
            onClick={async()=>{
              try{
                if(document.fullscreenElement)await document.exitFullscreen?.();
                else await stageRef.current?.requestFullscreen?.();
              }catch{}
            }}>全螢幕</button>
        </>}
    </section>

    {isList?<div className="rune-3d-footer">
      {group?<button className="rune-skin-btn" type="button" onClick={()=>{setGroup(null);setSelected(null);setFocusedRune(null);}}>← 返回九個群組</button>:null}
      {group?<span>{group.english_name||''}　{group.desc||''}</span>:null}
      {group?<nav className="rune-3d-rune-index" aria-label="指定展示文字">
        {runes.map(rune=><button type="button" key={rune.rune_id}
          onClick={()=>{setFocusedRune(rune);setSample(null);}}
          aria-pressed={Number(presented?.rune_id)===Number(rune.rune_id)}>
          {runeName(rune)}</button>)}
      </nav>:null}
      {!group?<nav className="rune-3d-group-index" aria-label="群組快速切換">
        {groups.map(entry=><button type="button" key={entry.id} className="rune-3d-group-name-btn"
          onClick={()=>{setGroup(entry);setFocusedRune(null);setSample(null);}}>{entry.name}</button>)}
      </nav>:null}
    </div>:null}
    <footer className="rune-3d-footer">
      <nav className="rune-skin-controls" aria-label="符文三大功能">
        <ScopeLink className="rune-skin-btn" href={navigationHref('lrunes','',native)} native={native}>回符文首頁</ScopeLink>
        {MODES.filter(([id])=>id!==mode).map(([id,name])=>
          <ScopeLink key={id} className="rune-skin-btn" href={navigationHref('lrunes','card/'+id,native)} native={native}>{name}</ScopeLink>)}
      </nav>
    </footer>
    {selected&&<ResultDialog title={runeName(selected)+'之符文'} onClose={()=>setSelected(null)}>
      {details?<RuneCardInfo card={details} imageSrc={runeImage(details)}
        direction={detailItem?.direction||''} realMoonPhase={detailItem?.moon||''} layout="home"/>:null}
    </ResultDialog>}
    {resultOpen&&items.length>0&&<ResultDialog title={mode==='daily'?'抽牌結果與每日指引':'抽牌結果與指引籤詩'}
      onClose={()=>setResultOpen(false)}>
      <div className="rune-3d-modal-results" aria-label="抽牌結果">
        {items.map((item,i)=><button type="button" key={item.birth} onClick={()=>{
          setResultOpen(false);choose(item.card);
        }}>
          <span>{i+1}. {runeName(item.card)}</span><small>{item.direction}</small>
        </button>)}
      </div>
      {day?<div className="rune-3d-daily-summary">
        <RuneCardInfo card={day.card} imageSrc={runeImage(day.card)} direction={day.direction}
          realMoonPhase={day.moon} layout="home" expandKeywords/>
      </div>:null}
      <h3>{mode==='daily'?'每日符文指引':'指引籤詩'}</h3>
      {day?<div className="rune-3d-daily-fields">
        {readDaily(day).map(field=><article key={field.label}><h3>{field.label}</h3><p>{field.text}</p></article>)}
      </div>:<p>{reading}</p>}
      {mode!=='daily'?<button type="button" className="rune-skin-btn" onClick={reset}>開始新抽牌</button>:null}
    </ResultDialog>}
    </div>
  </main>;
}
