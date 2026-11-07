'use client';

import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import RuneArtStage from '../visual/RuneArtStage';
import useRuneDialogFocus from '../visual/useRuneDialogFocus';
import {realMoonPhase} from '../../loc/model/moon-phase';
import {navigationHref} from '../../modular/scope-registry.js';
import useNativeNavigation from '../../modular/use-native-navigation';
import ScopeLink from '../../modular/ScopeLink';
import {loadDrawCards,randomIndex} from '../rune-draw-core.mjs';
import {runeImage} from '../rune-directory.mjs';
import '../skin-lab.css';
import '../visual/rune-art-layout.css';

const DIRECTIONS=['正位','半正位','半逆位','逆位'];
const CARD_ROTATION=[0,90,-90,180];
const FIELDS=[['sit_q','狀況形容'],['sit_a','狀況表達'],
  ['daily_r','每日占卜提醒'],['daily_g','每日占卜引導'],['daily_b','每日占卜祝福']];
export default function RuneDaily3D({presentationSwitcher=null}){
  const native=useNativeNavigation();
  const [moon,setMoon]=useState(()=>realMoonPhase());
  const [draw,setDraw]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [details,setDetails]=useState(false);
  const dialogRef=useRuneDialogFocus(()=>setDetails(false),details);
  const lock=useRef(false);
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  async function drawDaily(){
    if(lock.current||draw)return;
    lock.current=true;setBusy(true);setError('');setDetails(false);
    const currentMoon=realMoonPhase();setMoon(currentMoon);
    if(currentMoon==='未知'){
      setError('真實月相無法辨識，無法查詢每日指示。');
      lock.current=false;setBusy(false);return;
    }
    const runeNumber=randomIndex(66)+1;
    const index=randomIndex(4);
    try{
      const [card]=await loadDrawCards([{runeNumber,dir:index+1}],{
        staticTypes:['direction'],moonTypes:FIELDS.map(([type])=>type),currentMoon
      });
      if(!card)throw new Error('每日符文資料尚未就緒。');
      if(mounted.current){
        setDraw({card,directionIndex:index,
          direction:DIRECTIONS[index],birth:Date.now(),moon:currentMoon});
        // Daily has precisely one card, so reveal canonical details immediately.
        setDetails(true);
      }
    }catch(e){if(mounted.current)setError('每日指示讀取失敗：'+String(e?.message||e));}
    finally{lock.current=false;if(mounted.current)setBusy(false);}
  }
  const fields=draw?FIELDS.map(([key,label])=>({
    label,text:String(draw.card?.rune_etc?.[key]?.[draw.directionIndex+1]||'').trim()
  })).filter(field=>field.text):[];
  return <main className="loc-next-main" data-rune-lab="daily3d">
    <div className="loc-panel rune-skin-lab rune-art-shell">
    {presentationSwitcher}
    <header className="rune-art-header">
      <p className="loc-eyebrow">LunaRunes · Living Daily</p>
      <h1>每日符文 · 月光指示</h1>
      <p>每日指示獨立呈現。以當下真實月相、符文與位向精確查詢原有五項文字。</p>
    </header>
    <nav className="rune-art-toolbar">
      <span className="rune-art-toolbar-label">真實月相：{moon}　·　每日指示</span>
    </nav>
    <section className="rune-art-stage" aria-label="每日符文原創美術揭示">
      <RuneArtStage mode="daily" items={draw?[draw]:[]}
        onSelect={()=>setDetails(true)} onBackgroundClick={!busy&&!draw?drawDaily:undefined}/>
      <div className="rune-art-stage-label" role="status">
        {busy?'正在讀取今日符文與原始指引……':draw?'今日符文已亮相，指引將直接呈現；點選卡片可重新閱讀。':'輕觸月光召喚每日符文'}
      </div>
    </section>
    {error?<p className="rune-skin-error" role="alert">{error}</p>:null}
    <div className="rune-art-footer">
      <nav className="rune-skin-controls" aria-label="符文模式">
        <ScopeLink className="rune-skin-btn" href={navigationHref('lrunes','',native)} native={native}>回符文首頁</ScopeLink>
        <ScopeLink className="rune-skin-btn" href={navigationHref('lrunes','card',native)} native={native}>← 符文展示首頁</ScopeLink>
        <ScopeLink className="rune-skin-btn" href={navigationHref('lrunes','card/duel',native)} native={native}>一般抽牌</ScopeLink>
      </nav>
    </div>
    {details&&draw&&typeof document!=='undefined'?createPortal(
      <div className="rune-art-modal-backdrop rune-art-result-backdrop"
        onClick={()=>setDetails(false)} role="presentation">
        <section ref={dialogRef} tabIndex={-1} className="rune-art-modal rune-art-result-modal" role="dialog"
          aria-modal="true" aria-label="每日符文指示"
          onClick={event=>event.stopPropagation()}>
          <div className="rune-art-modal-head rune-art-result-head">
            <div>
              <p className="loc-eyebrow">LUNARUNES · DAILY GUIDANCE</p>
              <h2>每日符文指示</h2>
            </div>
            <div className="rune-art-result-actions">
              <ScopeLink className="rune-art-result-home" href={navigationHref('lrunes','card',native)} native={native}>回到首頁</ScopeLink>
              <button type="button" className="rune-art-result-close"
                onClick={()=>setDetails(false)} aria-label="關閉每日指示">×</button>
            </div>
          </div>
          <div className="rune-art-result-body rune-art-daily-result-body">
            <div className="rune-art-daily-summary">
              <img className="rune-art-daily-card" src={runeImage(draw.card)}
                alt={draw.card.rune_name+'原始符文卡面'} loading="eager"
                style={{transform:`rotate(${CARD_ROTATION[draw.directionIndex]??0}deg)`}}/>
              <div className="rune-art-daily-summary-copy">
                <h3>{String(draw.card.rune_name||'').replace(/之符文$/,'')} · {draw.direction}</h3>
                <p>卡片月相：{['','新月','上弦','滿月','下弦'][Number(draw.card.moon_phase)]||'無'}</p>
                <p>真實月相：{draw.moon}</p>
              </div>
            </div>
            <div className="rune-art-daily-fields" aria-label="每日五項指示">
              {fields.map(field=><article key={field.label}>
                <h3>{field.label}</h3><p>{field.text}</p>
              </article>)}
            </div>
            {Number(draw.card.rune_id)>=65&&fields.length<5?
              <p className="rune-art-daily-caveat">特殊符文尚未建置全部每日母資料，僅展示實際存在的原始文字。</p>:null}
          </div>
        </section>
      </div>,document.body
    ):null}
    </div>
  </main>;
}
