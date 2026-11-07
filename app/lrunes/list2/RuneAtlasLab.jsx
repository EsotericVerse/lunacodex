'use client';

import {useEffect,useMemo,useState} from 'react';
import RuneArtStage from '../visual/RuneArtStage';
import useRuneDialogFocus from '../visual/useRuneDialogFocus';
import RuneCardInfo from '../RuneCardInfo';
import {createPortal} from 'react-dom';
import {selectRows} from '../../loc/db-query.mjs';
import {navigationHref} from '../../modular/scope-registry.js';
import useNativeNavigation from '../../modular/use-native-navigation';
import ScopeLink from '../../modular/ScopeLink';
import {runeImage,groupImage} from '../rune-directory.mjs';
import '../skin-lab.css';
import '../visual/rune-art-layout.css';

const GROUP_COLUMNS='group_id,english_name,desc,quality,style,runeslist';
const DETAIL_COLUMNS='rune_id,rune_name,english_name,totem,group_name,moon_phase,card_attr,rune_description,archetype,char_action,positive_keywords,negative_keywords,extra_rules,extra_notes,rune_evolution_history,myth_story,soul_question,practice_challenge,ritual_advice,harmony_advice';
const GROUP_NAMES=['靈魂','連結','生命','自然','礦物','元素','秩序','無序','特殊'];
function cleanse(value){
  return String(value??'').replace(/&#x([0-9a-f]+);/gi,(_,hex)=>String.fromCodePoint(parseInt(hex,16)))
    .replace(/&#([0-9]+);/g,(_,n)=>String.fromCodePoint(parseInt(n,10)))
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'");
}
function groupIndex(row){
  const nums=Array.isArray(row?.runeslist)?row.runeslist.map(Number).filter(Number.isInteger):[];
  const a=nums.filter(n=>n>=1&&n<=64);
  return a.length?Math.floor((Math.min(...a)-1)/8):8;
}
function RuneInfoDialog({rune,onClose}){
  const dialogRef=useRuneDialogFocus(onClose);
  const details=[
    ['角色行動',rune.char_action],['額外規則',rune.extra_rules],
    ['額外留意',rune.extra_notes],['符文歷史',rune.rune_evolution_history],
    ['神話故事',rune.myth_story],['靈魂課題',rune.soul_question],
    ['實踐挑戰',rune.practice_challenge],['儀式建議',rune.ritual_advice],
    ['調和建議',rune.harmony_advice]
  ].filter(([,value])=>String(value??'').trim());
  if(typeof document==='undefined')return null;
  return createPortal(<div className="rune-art-modal-backdrop" role="presentation" onClick={onClose}>
    <section ref={dialogRef} tabIndex={-1} className="rune-art-modal" role="dialog" aria-modal="true" aria-label={rune.rune_name+'符文資料'} onClick={e=>e.stopPropagation()}>
      <div className="rune-art-modal-head">
        <div><span className="loc-eyebrow">RUNE ARCHIVE · {String(rune.rune_id).padStart(2,'0')}</span>
          <h2>{rune.rune_name}</h2>
          <p>{rune.english_name||''}　{rune.group_name||''}</p>
        </div>
        <button className="rune-skin-btn" type="button" onClick={onClose} aria-label="關閉資訊視窗">× 關閉</button>
      </div>
      <div className="rune-art-modal-main rune-art-modal-main--canonical">
        <div className="rune-art-modal-profile">
          <RuneCardInfo card={rune} imageSrc={runeImage(rune)} layout="profile"/>
        </div>
        <div className="rune-art-modal-details">
          {details.map(([label,value])=><div key={label}>
            <h3>{label}</h3>
            <p>{cleanse(Array.isArray(value)?value.join('、'):value)}</p>
          </div>)}
        </div>
      </div>
    </section>
  </div>,document.body);
}
export default function RuneAtlasLab({presentationSwitcher=null}){
  const native=useNativeNavigation();
  const [groups,setGroups]=useState([]);
  const [group,setGroup]=useState(null);
  const [runes,setRunes]=useState([]);
  const [details,setDetails]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    selectRows('silver.runes_group',{columns:GROUP_COLUMNS,limit:9,offset:0})
      .then(({rows})=>{if(active){
        setGroups((rows||[]).map(row=>({...row,index:groupIndex(row)}))
          .sort((a,b)=>a.index-b.index).map((row,i)=>({
            ...row,id:row.index+1,name:row.group_id||GROUP_NAMES[i],
            english_name:cleanse(row.english_name||''),
            desc:cleanse(row.desc||''),
            quality:cleanse(row.quality||''),
            style:cleanse(row.style||''),
            runeslist:Array.isArray(row.runeslist)?row.runeslist.map(Number):[]
          })));
      }})
      .catch(e=>{if(active)setError('群組載入失敗：'+String(e?.message||e));})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false};
  },[]);
  useEffect(()=>{
    let active=true;
    if(!group){setRunes([]);return()=>{active=false;};}
    const ids=[...new Set(group.runeslist.map(Number).filter(n=>Number.isInteger(n)&&n>=0))];
    if(!ids.length){setRunes([]);return()=>{active=false;};}
    setLoading(true);setError('');
    selectRows('silver.runes',{columns:DETAIL_COLUMNS,
      filters:[{column:'rune_id',operator:'in',value:ids}],
      orders:[{column:'rune_id',ascending:true}],limit:ids.length,offset:0
    }).then(({rows})=>{if(active)setRunes(rows||[]);})
      .catch(e=>{if(active)setError('符文讀取失敗：'+String(e?.message||e));})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[group]);
  // Direct navigation: group artwork tap enters the group, never opens a preview modal.
  const enterGroup=entry=>{
    if(!entry)return;
    window.history.pushState({runeCardLevel:'group'},'','#group-'+entry.id);
    setGroup(entry);setDetails(null);
  };
  const show=card=>{
    if(!group)return;
    window.history.pushState({runeCardLevel:'rune'},'','#group-'+group.id+'/rune-'+card.rune_id);
    setDetails(card);
  };
  const closeDetails=()=>{
    if(window.history.state?.runeCardLevel==='rune')window.history.back();
    else{
      window.history.replaceState({},'','#group-'+group.id);
      setDetails(null);
    }
  };
  const backToGroups=()=>{
    if(window.history.state?.runeCardLevel==='group')window.history.back();
    else{
      window.history.replaceState({},'',window.location.pathname);
      setGroup(null);setDetails(null);
    }
  };
  useEffect(()=>{
    const syncLocation=()=>{
      const match=new RegExp('^#group-([0-9]+)(?:/rune-([0-9]+))?$').exec(window.location.hash);
      if(!match){
        setGroup(null);setDetails(null);return;
      }
      const g=groups.find(x=>Number(x.id)===Number(match[1]));
      setGroup(g||null);
      const id=Number(match[2]);
      setDetails(id?(runes.find(r=>Number(r.rune_id)===id)||null):null);
    };
    window.addEventListener('popstate',syncLocation);
    window.addEventListener('hashchange',syncLocation);
    syncLocation();
    return()=>{
      window.removeEventListener('popstate',syncLocation);
      window.removeEventListener('hashchange',syncLocation);
    };
  },[groups,runes]);
  const display=useMemo(()=>group?runes:groups,[group,runes,groups]);
  return <main className="loc-next-main" data-rune-lab="list2">
    <div className="loc-panel rune-skin-lab rune-art-shell">
    {presentationSwitcher}
    <header className="rune-art-header">
      <p className="loc-eyebrow">LunaRunes · Living Atlas</p>
      <h1>{group?group.name+'之符文':'月之符文 · 九大群組'}</h1>
      <p>{group?'瀏覽群組簡介與原創符文卡圖；輕觸任一符文即可閱讀圖鑑資料。':
        '九大群組的原創畫作與基本資料。點選畫作直接進入該群組。'}</p>
    </header>
    <nav className="rune-art-toolbar" aria-label="圖鑑視角">
      {group?<span className="rune-art-toolbar-label">{group.name}組 · 原創符文畫廊</span>:<span className="rune-art-toolbar-label">九大符文群組 · 原創畫作</span>}

    </nav>
    {group?<section className="rune-art-group-inline" aria-label={group.name+'群組介紹'}>
      <div className="rune-art-group-inline-artwork">
        <img src={groupImage(group.id)} alt={group.name+'群組原創畫作'} loading="eager" decoding="async"/>
      </div>
      <div className="rune-art-group-inline-copy">
        <p className="loc-eyebrow">RUNE GROUP · {String(group.id).padStart(2,'0')} / 09</p>
        <h2>{group.name}組</h2>
        {group.english_name?<p className="rune-art-group-en">{group.english_name}</p>:null}
        <p className="rune-art-group-description">{group.desc||'此群組尚無介紹內容。'}</p>
        {group.quality&&group.quality!=='風格特徵'?<p className="rune-art-group-quality"><strong>群組特徵</strong> {group.quality}</p>:null}
        {group.style&&group.style!=='style / trait'?<p className="rune-art-group-style"><strong>風格</strong> {group.style}</p>:null}
        <p className="rune-art-group-count">本群組收錄 {group.runeslist.length} 枚符文{group.id===9?'（含誌銘）':''}</p>
      </div>
    </section>:null}
    <section className="rune-art-stage" aria-label="九群組與原創符文畫廊">
      <RuneArtStage mode={group?'runes':'groups'} items={display}
        galleryTitle={group?group.name+' · 符文原始卡片':'九大符文群組'}
        galleryDescription={group?'依原本卡片資料顯示本義、原型、關鍵詞、屬性與月相；點選卡圖閱讀完整資料。':'選取群組原創畫作，直接展開群組介紹和符文卡片。'}
        onSelect={group?show:enterGroup}/>
      <div className="rune-art-stage-label" role="status">{loading?'畫作載入中……':
        error||(!group?'點選群組畫作，直接查看該群組的介紹及符文':'輕觸符文卡面，查看原有文字資料')}</div>
    </section>
    {group?<button type="button" className="rune-art-floating-back" onClick={backToGroups}
      aria-label="返回九個群組"><span aria-hidden="true">←</span> 返回九群組</button>:null}
    {!group?<nav className="rune-art-group-index" aria-label="九個符文群組">
      {groups.map(item=><button key={item.id} type="button"
        className="rune-art-group-name-btn" onClick={()=>enterGroup(item)}>{item.name}</button>)}
    </nav>:null}
    <footer className="rune-art-footer">
      <span>原創美術展示 · 保留符文原始卡面</span>
      <nav className="rune-skin-controls" aria-label="返回與模式切換">
        <ScopeLink href={navigationHref('lrunes','',native)} native={native} className="rune-skin-btn">回符文首頁</ScopeLink>
        <ScopeLink href={navigationHref('lrunes','card',native)} native={native} className="rune-skin-btn">← 符文展示首頁</ScopeLink>
        <ScopeLink href={navigationHref('lrunes','card/duel',native)} native={native} className="rune-skin-btn">切換隨機抽牌</ScopeLink>
      </nav>
    </footer>
    {details?<RuneInfoDialog rune={details} onClose={closeDetails}/>:null}
    </div>
  </main>;
}
