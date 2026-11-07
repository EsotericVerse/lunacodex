'use client';

import {useEffect,useRef,useState} from 'react';
import RuneArtStage from '../visual/RuneArtStage';
import useRuneDialogFocus from '../visual/useRuneDialogFocus';
import {createPortal} from 'react-dom';
import {realMoonPhase} from '../../loc/model/moon-phase';
import {navigationHref} from '../../modular/scope-registry.js';
import useNativeNavigation from '../../modular/use-native-navigation';
import ScopeLink from '../../modular/ScopeLink';
import {randomIndex,loadDrawCards,buildFixedReading} from '../rune-draw-core.mjs';
import {runeImage} from '../rune-directory.mjs';
import {RUNE_ALL_DRAW_MODES} from '../rune-draw-modes.mjs';
import RuneCardInfo from '../RuneCardInfo';
import '../skin-lab.css';
import '../visual/rune-art-layout.css';

const MAX_DRAW=11;
const REVEAL_MS=1000;
const DIRECTIONS=['正位','半正位','半逆位','逆位'];
// Explanatory only: 1–11 rune counts, without any route, button or handler.
const DRAW_COUNT_GUIDE=RUNE_ALL_DRAW_MODES
  .filter(item=>item.key!=='daily')
  .slice().sort((a,b)=>a.count-b.count);
function realText(card,type,directionIndex){
  return String(card?.rune_etc?.[type]?.[directionIndex+1]||'').trim();
}
function shortRuneName(card){
  return String(card?.rune_name||'').replace(/之符文$/,'').trim();
}
function officialReading(items){
  if(!items.length)throw new Error('尚未抽取任何符文。');
  const cards=items.map(item=>item.card);
  const directions=items.map(item=>item.direction);
  const count=items.length;
  const mode=count===1?'single':count===11?'ow3gs':count+'card';
  const sentence=count===1?realText(cards[0],'sit_q',items[0].directionIndex)+'。':
    buildFixedReading(cards,directions,mode).sentence;
  if(!sentence||sentence==='。'||sentence.includes('資訊不足'))
    throw new Error('組合籤詩內容不完整，請重試。');
  return sentence;
}
// This is exactly the same silver.runes "card basic information" UI used
// in the accepted original draw. NO runes_etc content or queries in this dialog.
function RuneDrawCardDialog({item,onClose}){
  const dialogRef=useRuneDialogFocus(onClose);
  const card=item.card;
  return <div className="rune-art-modal-backdrop rune-art-draw-modal-backdrop" role="presentation" onClick={onClose}>
    <section ref={dialogRef} tabIndex={-1} className="rune-art-modal rune-art-draw-modal" role="dialog" aria-modal="true"
      aria-label={shortRuneName(card)+'符文基本資料'} onClick={e=>e.stopPropagation()}>
      <div className="rune-art-modal-head">
        <div><span className="loc-eyebrow">RUNE ARCHIVE · 卡片基本資料</span>
          <h2>{shortRuneName(card)}之符文 · {item.direction}</h2></div>
        <button className="rune-skin-btn" type="button" onClick={onClose}>× 關閉</button>
      </div>
      <div className="rune-art-modal-main rune-art-original-card-info">
        <RuneCardInfo card={card} imageSrc={runeImage(card)}
          direction={item.direction} realMoonPhase={item.moon} layout="home"/>
      </div>
    </section>
  </div>;
}
function RuneDrawResultDialog({items,reading,homeHref,homeHrefNative=false,onRestart,onClose}){
  const dialogRef=useRuneDialogFocus(onClose);
  return <div className="rune-art-modal-backdrop rune-art-result-backdrop"
    role="presentation" onClick={onClose}>
    <section ref={dialogRef} tabIndex={-1} className="rune-art-modal rune-art-result-modal" role="dialog"
      aria-modal="true" aria-label="本次占卜籤詩" onClick={event=>event.stopPropagation()}>
      <div className="rune-art-modal-head rune-art-result-head">
        <div>
          <p className="loc-eyebrow">LUNARUNES · RUNE READING</p>
          <h2>本次占卜籤詩</h2>
        </div>
        <div className="rune-art-result-actions">
          <ScopeLink className="rune-art-result-home" href={homeHref} native={homeHrefNative}>回到首頁</ScopeLink>
          <button type="button" className="rune-art-result-new" onClick={onRestart}>開始新抽牌</button>
          <button type="button" className="rune-art-result-close" onClick={onClose}
            aria-label="關閉占卜結果">×</button>
        </div>
      </div>
      <div className="rune-art-result-body">
        <p className="rune-art-result-count">本次抽了 {items.length} 枚符文</p>
        <p className="rune-art-result-runes">
          {items.map((item,index)=><span key={item.card.rune_id}>
            {index?'、':''}{shortRuneName(item.card)}・{item.direction}
          </span>)}
        </p>
        <div className="rune-art-result-verse" aria-label="籤詩內容">
          <p>{reading}</p>
        </div>
      </div>
    </section>
  </div>;
}
const pause=milliseconds=>new Promise(done=>setTimeout(done,milliseconds));
export default function RuneRitualLab({presentationSwitcher=null}){
  const native=useNativeNavigation();
  const [items,setItems]=useState([]);
  const [busy,setBusy]=useState(false);
  const [finished,setFinished]=useState(false);
  const [reading,setReading]=useState('');
  const [resultOpen,setResultOpen]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('月光已就位，準備揭示第一枚符文');
  const cardsRef=useRef([]);
  const locked=useRef(false);
  const mounted=useRef(true);
  const [moon,setMoon]=useState(()=>realMoonPhase());
  const [selected,setSelected]=useState(null);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  async function drawOne(){
    if(locked.current||finished||selected||cardsRef.current.length>=MAX_DRAW)return;
    locked.current=true;
    setBusy(true);setError('');setMessage('月光正在為下一枚符文揭幕……');
    const started=Date.now();
    const currentMoon=realMoonPhase();setMoon(currentMoon);
    if(currentMoon==='未知'){
      setError('真實月相無法辨識，無法查詢籤詩。');setBusy(false);locked.current=false;return;
    }
    const used=new Set(cardsRef.current.map(x=>Number(x.card.rune_id)));
    const remaining=Array.from({length:66},(_,i)=>i+1).filter(id=>!used.has(id));
    const runeNumber=remaining[randomIndex(remaining.length)];
    const directionIndex=randomIndex(4);
    try{
      const cards=await loadDrawCards([{runeNumber,dir:directionIndex+1}],{
        staticTypes:[],moonTypes:['sit_q'],currentMoon
      });
      const card=cards.find(x=>Number(x.rune_id)===runeNumber);
      if(!card||!realText(card,'sit_q',directionIndex))throw Error('抽中的符文籤詩無法讀取');
      await pause(Math.max(0,REVEAL_MS-(Date.now()-started)));
      if(!mounted.current)return;
      const next=[...cardsRef.current,{
        card,direction:DIRECTIONS[directionIndex],directionIndex,moon:currentMoon,birth:Date.now()
      }];
      cardsRef.current=next;setItems(next);
      setMessage(next.length>=MAX_DRAW?'已抽滿十一枚，請結束抽牌。':'符文已亮相，點擊卡片閱讀資料，或點擊繼續召喚，或點擊結束來觀看指引籤詩。');
    }catch(e){
      if(mounted.current){setError('抽牌失敗：'+String(e?.message||e));setMessage('觸碰畫面重試');}
    }finally{
      locked.current=false;
      if(mounted.current)setBusy(false);
    }
  }
  function showCard(card){
    const item=cardsRef.current.find(x=>Number(x.card.rune_id)===Number(card.rune_id));
    if(item)setSelected(item);
  }
  function finish(){
    if(locked.current||busy||selected||!cardsRef.current.length)return;
    if(finished){setResultOpen(true);return;}
    try{
      setReading(officialReading(cardsRef.current));
      setFinished(true);setResultOpen(true);setError('');
      setMessage('占卜結束，已在視窗中呈現籤詩。');
    }catch(e){setError(String(e?.message||e));}
  }
  function reset(){
    if(locked.current||busy||selected)return;
    cardsRef.current=[];setItems([]);setSelected(null);setFinished(false);
    setReading('');setResultOpen(false);setError('');
    setMessage('月光已就位，準備揭示第一枚符文');
  }
  const actionDock=<div className="rune-art-duel-action-dock" role="group" aria-label="占卜功能列">
    <button type="button" className="rune-art-duel-action rune-art-duel-action--restart"
      onClick={reset} disabled={busy||!!selected||!items.length}>重新開始占卜</button>
    <button type="button" className="rune-art-duel-action rune-art-duel-action--draw"
      onClick={drawOne} disabled={busy||finished||!!selected||items.length>=MAX_DRAW}>招喚下一枚符文</button>
    <button type="button" className="rune-art-duel-action rune-art-duel-action--finish"
      onClick={finish} disabled={busy||!!selected||!items.length}>占卜結束，觀看籤詩</button>
  </div>;
  return <main className="loc-next-main" data-rune-lab="duel2">
    <div className="loc-panel rune-skin-lab rune-art-shell rune-art-duel-shell">
    {presentationSwitcher}
    <header className="rune-art-header">
      <p className="loc-eyebrow">LunaRunes · Living Ritual</p>
      <h1>月光召喚 · 華麗抽牌</h1>
      <p>讓原創符文卡面成為主角。月光揭幕、流金入場，逐枚抽取並保留原有占卜規則。</p>
    </header>
    <nav className="rune-art-toolbar">
      <span className="rune-art-toolbar-label">真實月相 {moon}　·　{items.length} / {MAX_DRAW} 枚</span>

    </nav>
    <section className="rune-art-stage" aria-label="原創符文美術動態抽牌">
      <RuneArtStage mode="draw" items={items} charging={busy} actions={actionDock}
        onSelect={showCard} onBackgroundClick={!finished&&!selected?drawOne:undefined}/>
      <div className="rune-art-stage-label" role="status">{busy?'月光正在揭示符文……':message}</div>
    </section>
    {error?<p className="rune-skin-error" role="alert">{error}</p>:null}
    <div className="rune-art-footer">
      <nav className="rune-skin-controls" aria-label="返回與模式切換">
        <ScopeLink href={navigationHref('lrunes','',native)} native={native} className="rune-skin-btn">回符文首頁</ScopeLink>
        <ScopeLink href={navigationHref('lrunes','card',native)} native={native} className="rune-skin-btn">← 符文展示首頁</ScopeLink>
        <ScopeLink href={navigationHref('lrunes','card/list',native)} native={native} className="rune-skin-btn">切換指定圖鑑</ScopeLink>
        <ScopeLink href={navigationHref('lrunes','card/daily',native)} native={native} className="rune-skin-btn">每日符文</ScopeLink>
      </nav>
    </div>
    <details className="rune-art-draw-guide" aria-label="占卜張數說明">
      <summary className="rune-art-draw-guide-summary">
        <span>占卜張數說明</span>
        <span className="rune-art-guide-toggle" aria-hidden="true">⌄</span>
      </summary>
      <div className="rune-art-draw-guide-content">
        <p>不同的抽取張數對應不同的閱讀結構；以下僅為說明，不是模式選單。</p>
        <div className="rune-art-draw-guide-grid">
          {DRAW_COUNT_GUIDE.map(item=><article className="rune-art-draw-guide-card" key={item.key}>
            <strong>{item.count} 張｜{item.label}</strong>
            <p>{item.description}</p>
          </article>)}
        </div>
      </div>
    </details>
    {selected&&typeof document!=='undefined'?createPortal(
      <RuneDrawCardDialog item={selected} onClose={()=>setSelected(null)}/>,document.body
    ):null}
    {resultOpen&&finished&&typeof document!=='undefined'?createPortal(
      <RuneDrawResultDialog items={items} reading={reading}
        homeHref={navigationHref('lrunes','card',native)}
        homeHrefNative={native}
        onRestart={reset} onClose={()=>setResultOpen(false)}/>,document.body
    ):null}
    </div>
  </main>;
}
