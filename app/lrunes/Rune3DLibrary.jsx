'use client';

import {useEffect,useRef,useState} from 'react';
import {motion,useReducedMotion} from 'motion/react';
import {selectRows} from '../loc/db-query.mjs';
import RuneArtStage from './visual/RuneArtStage';
import RuneCardInfo from './RuneCardInfo';
import EffekseerStage from './effekseer/EffekseerStage';
import RuneExtrudedGlyph from './effekseer/RuneExtrudedGlyph';
import {RUNE_GLYPH_STYLES,runeGlyphProfile} from './effekseer/rune-glyph-library.mjs';
import {groupImage,runeImage,runeName,runeNumbersForGroup} from './rune-directory.mjs';
import {navigationHref} from '../modular/scope-registry.js';
import useNativeNavigation from '../modular/use-native-navigation';
import ScopeLink from '../modular/ScopeLink';
import {lRunes66ColumnString} from '../../zenstack/lrunes-read-model.mjs';
import './skin-lab.css';
import './visual/rune-art-layout.css';
import './effekseer/effekseer-stage.css';

// Nine canonical groups, eight runes each except the last group, which also
// carries rune 0 (德 / Rune Zero, excluded from card draw): 0, 65, 66.
// Membership comes from runeNumbersForGroup (rune-directory.mjs) — the single
// canonical source for group<->rune-id mapping — rather than a second,
// range-only copy that would drift out of sync with it (as happened before).
const GROUPS=Object.freeze([
  {id:1,name:'靈魂'},{id:2,name:'連結'},{id:3,name:'生命'},{id:4,name:'自然'},
  {id:5,name:'礦物'},{id:6,name:'元素'},{id:7,name:'秩序'},{id:8,name:'無序'},
  {id:9,name:'特殊'}
]);
const RUNE_COLUMNS=lRunes66ColumnString('rune_id','rune_name','english_name','totem','group_name','moon_phase','card_attr','rune_description','archetype','char_action','positive_keywords','negative_keywords','extra_rules','extra_notes','rune_evolution_history','myth_story','soul_question','practice_challenge','ritual_advice','harmony_advice');
const GROUP_COLUMNS='group_id,english_name,desc,quality,style,runeslist';
const inGroup=(rune,group)=>group.runeslist.includes(Number(rune.rune_id));
function cleanse(value){
  return String(value??'').replace(/&#x([0-9a-f]+);/gi,(_,hex)=>String.fromCodePoint(parseInt(hex,16)))
    .replace(/&#([0-9]+);/g,(_,n)=>String.fromCodePoint(parseInt(n,10)))
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'");
}
function groupIndex(row){
  const ids=(Array.isArray(row?.runeslist)?row.runeslist:[])
    .map(Number).filter(n=>Number.isInteger(n)&&n>=1&&n<=64);
  return ids.length?Math.floor((Math.min(...ids)-1)/8):8;
}

export default function Rune3DLibrary({presentationSwitcher=null}){
  const native=useNativeNavigation();
  const [allRunes,setAllRunes]=useState([]);
  const [groupRows,setGroupRows]=useState([]);
  const [groupError,setGroupError]=useState('');
  const [groupId,setGroupId]=useState(null);
  const [focusId,setFocusId]=useState(null);
  const [showCardInfo,setShowCardInfo]=useState(false);
  const [playback,setPlayback]=useState(0);
  const [textureQuality,setTextureQuality]=useState('original');
  useEffect(()=>{
    setTextureQuality(new URLSearchParams(window.location.search).get('texture')==='hd256'?'hd256':'original');
  },[]);
  const reducedMotion=useReducedMotion();
  const [status,setStatus]=useState('ready');
  const [error,setError]=useState('');
  const [reload,setReload]=useState(0);
  const stageRef=useRef(null);

  // Keep 3D catalog reads as targeted as the working 2D catalog: selecting a
  // group requests only that group's rune IDs. A missing rune outside the
  // selected group must not blank the entire atlas.
  useEffect(()=>{
    let active=true;
    const controller=new AbortController();
    if(groupId===null){
      setAllRunes([]);setStatus('ready');setError('');
      return()=>{active=false;controller.abort();};
    }
    const ids=runeNumbersForGroup(groupId);
    setAllRunes([]);setStatus('loading');setError('');
    selectRows('silver.runes',{
      columns:RUNE_COLUMNS,
      filters:[{column:'rune_id',operator:'in',value:ids}],
      orders:[{column:'rune_id',ascending:true}],
      limit:ids.length,offset:0,signal:controller.signal
    }).then(({rows})=>{
      if(!active)return;
      const byId=new Map((rows||[]).map(rune=>[Number(rune.rune_id),rune]));
      const next=ids.map(id=>byId.get(id)).filter(Boolean);
      if(!next.length)throw Error('此群組未取得任何符文卡片');
      setAllRunes(next);
      setError(next.length===ids.length?'':'此群組目前只讀取到 '+next.length+' / '+ids.length+' 枚符文');
      setStatus('ready');
    }).catch(err=>{
      if(active){setError(String(err?.message||err));setStatus('error');}
    });
    return()=>{active=false;controller.abort();};
  },[groupId,reload]);

  useEffect(()=>{
    let active=true;
    const controller=new AbortController();
    selectRows('silver.runes_group',{columns:GROUP_COLUMNS,limit:9,offset:0,signal:controller.signal})
      .then(({rows})=>{
        if(!active)return;
        if((rows||[]).length!==9)throw Error('群組資料不完整：'+(rows||[]).length+' / 9');
        setGroupRows(rows);setGroupError('');
      }).catch(err=>{if(active)setGroupError('群組文字資料暫時無法載入：'+String(err?.message||err));});
    return()=>{active=false;controller.abort();};
  },[reload]);

  const groups=GROUPS.map(entry=>{
    const row=groupRows.find(value=>groupIndex(value)===entry.id-1);
    return {...entry,english_name:cleanse(row?.english_name),
      desc:cleanse(row?.desc),quality:cleanse(row?.quality),style:cleanse(row?.style),
      runeslist:runeNumbersForGroup(entry.id)};
  });
  // 2D and 3D share #group-N[/rune-N] so changing presentation
  // preserves the selected group and supports bookmarked group URLs.
  useEffect(()=>{
    const syncLocation=()=>{
      const match=/^#group-([1-9])(?:\/rune-(\d{1,2}))?$/.exec(window.location.hash);
      const id=match?Number(match[1]):null;
      const runeId=match?.[2]!==undefined?Number(match[2]):null;
      setGroupId(id);
      setFocusId(id!==null&&runeId!==null&&runeNumbersForGroup(id).includes(runeId)?runeId:null);
      setShowCardInfo(false);
    };
    window.addEventListener('popstate',syncLocation);
    window.addEventListener('hashchange',syncLocation);
    syncLocation();
    return()=>{
      window.removeEventListener('popstate',syncLocation);
      window.removeEventListener('hashchange',syncLocation);
    };
  },[]);
  const group=groups.find(item=>item.id===groupId)||null;
  const runes=group?allRunes.filter(rune=>inGroup(rune,group)):[];
  const current=focusId===null?null:runes.find(rune=>Number(rune.rune_id)===focusId)||null;
  const runePosition=Math.max(0,runes.findIndex(rune=>Number(rune.rune_id)===Number(current?.rune_id)));
  const currentGlyph=current?runeGlyphProfile(current):null;

  useEffect(()=>{
    if(current&&stageRef.current)
      stageRef.current.scrollIntoView({behavior:reducedMotion?'auto':'smooth',block:'center'});
  },[current?.rune_id,playback,reducedMotion]);
  const jumpTo=rune=>{
    if(!rune||groupId===null)return;
    const runeId=Number(rune.rune_id);
    window.history.pushState({runeCardLevel:'rune'},'',
      window.location.pathname+window.location.search+'#group-'+groupId+'/rune-'+runeId);
    setShowCardInfo(false);
    setPlayback(n=>n+1);
    setFocusId(runeId);
  };
  const selectGroup=entry=>{
    window.history.pushState({runeCardLevel:'group'},'',
      window.location.pathname+window.location.search+'#group-'+entry.id);
    setGroupId(entry.id);setFocusId(null);setShowCardInfo(false);
  };
  const backToGroups=()=>{
    window.history.pushState({},'',window.location.pathname+window.location.search);
    setGroupId(null);setFocusId(null);setShowCardInfo(false);
    window.scrollTo?.({top:0,behavior:'smooth'});
  };
  const stepRune=delta=>{
    if(!runes.length||!current)return;
    jumpTo(runes[(runePosition+delta+runes.length)%runes.length]);
  };

  return <main className="loc-next-main" data-rune-3d-preview="list" data-rune-embodiment="66">
    <div className="loc-panel rune-skin-lab rune-3d-shell rune-3d-library">
    {presentationSwitcher}
    <header className="rune-3d-header">
      <p className="loc-eyebrow">LUNARUNES · 符文圖鑑</p>
      <h1>{group?group.name+'組 · 3D 符文圖鑑':'六十六枚符文 · 3D 圖鑑'}</h1>
      <p>{group?'先瀏覽群組介紹與符文卡片；選擇任一枚後，才展開該符文專屬的 Effekseer 特效。':
        '以九個群組的原創圖片為入口，展開符文畫廊，不再使用星系式選單。'}</p>
    </header>
    {status==='loading'?<p className="rune-3d-library-message" role="status">正在載入此群組的符文卡片……</p>:null}
    {status==='error'?<div className="rune-3d-library-message" role="alert">
      <p>群組符文卡片無法載入：{error}</p>
      <button type="button" className="rune-skin-btn" onClick={()=>{setStatus('loading');setReload(n=>n+1);}}>重新載入</button>
    </div>:null}
    {groupError?<p className="rune-3d-atlas-data-warning" role="status">{groupError}（原創群組畫作仍可瀏覽）</p>:null}
    {status==='ready'&&group&&error?<p className="rune-3d-atlas-data-warning" role="status">{error}</p>:null}
    {status==='ready'&&!group?<section className="rune-3d-atlas-gallery" aria-label="九大群組原創圖片">
      <RuneArtStage mode="groups" items={groups} onSelect={selectGroup}
        galleryTitle="九大符文群組 · 66 種獨立特效" galleryDescription="九組只是分類，先瀏覽群組介紹與符文卡片，點選任一枚才播放其獨立 3D 特效。"/>
    </section>:null}
    {status==='ready'&&group?<>
      <nav className="rune-3d-atlas-back" aria-label="返回群組畫廊">
        <button type="button" className="rune-skin-btn" onClick={backToGroups}>← 返回九個群組</button>
        <span>第 {String(group.id).padStart(2,'0')} / 09 組 · {runes.length} 枚</span>
      </nav>
      <section className="rune-3d-atlas-group-hero" aria-label={group.name+'群組原創畫作與介紹'}>
        <div className="rune-3d-atlas-group-artwork">
          <img src={groupImage(group.id)} alt={group.name+'群組原創畫作'} loading="eager" decoding="async"/>
        </div>
        <div className="rune-3d-atlas-group-copy">
          <p className="loc-eyebrow">RUNE GROUP · {String(group.id).padStart(2,'0')} / 09</p>
          <h2>{group.name}組</h2>
          {group.english_name?<p className="rune-3d-atlas-group-en">{group.english_name}</p>:null}
          {group.desc?<p className="rune-3d-atlas-group-description">{group.desc}</p>:null}
          {group.quality&&group.quality!=='風格特徵'?<p><strong>群組特徵：</strong>{group.quality}</p>:null}
          {group.style&&group.style!=='style / trait'?<p><strong>風格：</strong>{group.style}</p>:null}
          <p>本群組收錄 {runes.length} 枚 3D 符文</p>
        </div>
      </section>
    {status==='ready'&&current?<section className="rune-3d-library-manifestation"
      aria-label={runeName(current)+'符文 3D 顯現'}>
      <div className="rune-3d-library-title">
        <h2>{runeName(current)} · {current.english_name}</h2>
        <span>第 {current.rune_id} / 66 枚 · {group.name}</span>
        <span className="rune-3d-toolbar-label">粒子貼圖：{textureQuality==='hd256'?'256':'原始'}</span>
      </div>
      <div ref={stageRef} className={'rune-3d-stage rune-3d-atlas-performance'+(showCardInfo?' rune-3d-atlas-performance--reading':'')}>
        <EffekseerStage key={current.rune_id+'-'+playback} rune={current} vfxOnly textureQuality={textureQuality}
          onPlaybackComplete={()=>setShowCardInfo(true)}/>
        {showCardInfo?<motion.div key={'reading-'+current.rune_id+'-'+playback}
          className="rune-3d-atlas-reading" role="region" aria-label={runeName(current)+'原始符文卡片資料'}
          initial={reducedMotion?false:{opacity:0,y:20}}
          animate={{opacity:1,y:0}}
          transition={{duration:reducedMotion?0:.75,ease:'easeOut'}}>
          <div className="rune-3d-atlas-reading-inner">
            <p className="loc-eyebrow">RUNE ARCHIVE · {String(current.rune_id).padStart(2,'0')} / 66</p>
            <h3 className="rune-3d-atlas-reading-title">{runeName(current)}之符文 · 詳細資料</h3>
            <RuneCardInfo card={current} imageSrc={runeImage(current)} layout="home" expandKeywords/>
            <div className="rune-3d-atlas-reading-details" aria-label="符文完整延伸敘述">
              {[
                ['角色行動',current.char_action],['額外規則',current.extra_rules],
                ['額外留意',current.extra_notes],['符文歷史',current.rune_evolution_history],
                ['神話故事',current.myth_story],['靈魂課題',current.soul_question],
                ['實踐挑戰',current.practice_challenge],['儀式建議',current.ritual_advice],
                ['調和建議',current.harmony_advice]
              ].filter(([,value])=>String(value??'').trim()).map(([label,value])=>
                <section key={label} className="rune-3d-atlas-reading-detail">
                  <h4>{label}</h4>
                  <p>{cleanse(Array.isArray(value)?value.join('、'):value)}</p>
                </section>)}
            </div>
            <div className="rune-3d-atlas-reading-actions">
              <button type="button" className="rune-skin-btn" onClick={()=>{
                setShowCardInfo(false);setPlayback(n=>n+1);
              }}>重播符文演出</button>
            </div>
          </div>
        </motion.div>:null}
      </div>
      <div className="rune-3d-atlas-glyph-review" aria-label={runeName(current)+'的 3D 字型檢視'}>
        <div className={'rune-effekseer-glyph rune-effekseer-glyph--'+currentGlyph.font+' rune-3d-atlas-glyph-model'}
          data-glyph-family={currentGlyph.family} data-glyph-finish={currentGlyph.finish}
          style={{'--rune-ink':currentGlyph.ink}} data-glyph-ink={currentGlyph.ink}>
          <RuneExtrudedGlyph key={'preview-'+current.rune_id} word={runeName(current).slice(0,1)} profile={currentGlyph}/>
        </div>
        <div className="rune-3d-atlas-glyph-copy">
          <p className="loc-eyebrow">3D 字型 · 固定檢視</p>
          <p>字型：{RUNE_GLYPH_STYLES[currentGlyph.family]?.label||currentGlyph.family}</p>
          <p>正面固定、立體筆畫及側面厚度，可直接比較每枚符文。</p>
        </div>
      </div>
      <div className="rune-3d-library-actions">
        <div className="rune-3d-review-stepping" role="group" aria-label="前後符文">
          <button type="button" className="rune-skin-btn" onClick={()=>stepRune(-1)}>← 上一枚</button>
          <span>{runePosition+1} / {runes.length}</span>
          <button type="button" className="rune-skin-btn" onClick={()=>stepRune(1)}>下一枚 →</button>
        </div>

      </div>
    </section>:null}
      <section className="rune-3d-atlas-gallery" aria-label={group.name+'原創符文卡圖'}>
        <RuneArtStage mode="runes" items={runes} onSelect={jumpTo}
          galleryTitle={group.name+' · 符文卡圖'}
          galleryDescription="每枚卡片皆有自己的魔法特效；點選卡片即可切換上方動畫。"
          runeActionLabel="觀看 3D 顯現"/>
      </section>
    </>:null}

    <footer className="rune-3d-footer">
      <nav className="rune-skin-controls" aria-label="符文圖鑑導覽">
        <ScopeLink className="rune-skin-btn" href={navigationHref('lrunes','',native)} native={native}>回符文首頁</ScopeLink>
        <ScopeLink className="rune-skin-btn" href={navigationHref('lrunes','card/duel',native)} native={native}>符文抽牌</ScopeLink>
        <ScopeLink className="rune-skin-btn" href={navigationHref('lrunes','card/daily',native)} native={native}>每日符文</ScopeLink>
      </nav>
    </footer>


    </div>
  </main>;
}
