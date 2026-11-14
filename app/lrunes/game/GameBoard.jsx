'use client';

import {useEffect,useMemo,useState} from 'react';
import {createLunaRunesGame} from './boardgame-rules.js';
import {localTabletopRules} from './game-data.js';
import {runeImage} from '../rune-directory.mjs';
import {prepareTransientResourceAction} from '../../../zenstack/client-queries';
import ScopeLink from '../../modular/ScopeLink';
import './game-board.css';

const LETTERS=['A','B','C','D'];
const PHASES={opening:'起手準備',event:'事件回應',resonance:'共振行動',duel:'決勝回合',finished:'牌局結束'};
const ROLES=[{key:'self',name:'回復自身',description:'德 +2'},
  {key:'attack',name:'干預對手',description:'對手德 −2'}];

export default function GameBoard(){
  const rules=useMemo(()=>localTabletopRules(),[]);
  const [count,setCount]=useState(2);
  const [game,setGame]=useState(null);
  const [viewer,setViewer]=useState(0);
  const [notice,setNotice]=useState('');
  const [ready,setReady]=useState(false);
  const engine=useMemo(()=>createLunaRunesGame(rules,count),[rules,count]);
  useEffect(()=>{
    // /game is an expensive, independent interactive workspace. Dispose old
    // public reads BEFORE the playable board is mounted, exactly once.
    prepareTransientResourceAction('navigation');
    setReady(true);
  },[]);

  function startGame(){
    setGame(engine.setup());setViewer(0);setNotice('');
  }
  function action(name,...args){
    if(!game)return;
    try{
      const next=structuredClone(game);
      engine.moves[name]({G:next},...args);
      setGame(next);setNotice('');
      if(name==='confirmOpening')setViewer(next.active);
      if(name==='resolveEvent')setViewer(0);
    }catch(error){setNotice(String(error?.message||error));}
  }
  if(!ready)return <main className="scope-main"><section className="scope-page">
    <p role="status" className="scope-status">正在釋放前一頁資源，準備牌桌…</p>
  </section></main>;

  const stage=game?.stage||'idle';
  const active=stage==='opening'||stage==='resonance'||stage==='duel'?game.active:viewer;
  const player=game?.players?.[active]||null;
  const choosing=stage==='opening'||stage==='event';
  const selected=player?.selected||[];
  const limit=stage==='opening'?rules.config.openingDiscard:rules.config.eventResponseCards;
  const complete=game?.players?.every(p=>p.selected.length===rules.config.eventResponseCards);
  const event=stage==='event'?game.eventDeck[game.eventIndex%game.eventDeck.length]:null;
  const targets=stage==='duel'?game.duelists:game?.players.map((_,i)=>i)||[];
  return <main className="loc-next-main" data-lrunes-tabletop="local">
    <div className="lrg">
      <header className="lrg-head">
        <div><p className="loc-eyebrow">LUNARUNES · LOCAL TABLETOP</p>
          <h1>月之符文 · 桌遊</h1>
          <p>本機輪流操作 · 二至四名玩家 · 八回合事件與共振</p>
        </div>
        <ScopeLink className="loc-button" href="/lrunes/">返回月之符文</ScopeLink>
      </header>
      {!game?<section className="lrg-panel lrg-launch">
        <h2>建立牌局</h2>
        <p>以歷史 32 個事件與 66 枚符文進行本機對局；不連線、不建立房間、不寫入資料庫。</p>
        <label>玩家人數
          <select className="scope-select" value={count} onChange={e=>setCount(Number(e.target.value))}>
            {[2,3,4].map(n=><option value={n} key={n}>{n} 人</option>)}
          </select>
        </label>
        <button type="button" className="loc-button primary" onClick={startGame}>開始遊戲</button>
      </section>:<>
        <div className="lrg-topline">
          <span>第 {game.round} 回合／8</span>
          <strong>{PHASES[stage]||stage}</strong>
          <button type="button" className="loc-button" onClick={startGame}>重新開局</button>
        </div>
        <div className="lrg-players" role="list" aria-label="玩家德值">
          {game.players.map((p,i)=><div key={i} className={'lrg-player'+(active===i?' lrg-player--active':'')} role="listitem">
            <strong>玩家 {LETTERS[i]}</strong><span>德 <b>{p.de}</b></span>
            <small>手牌 {p.hand.length} · 牌庫 {p.deck.length}</small>
          </div>)}
        </div>
        {event?<section className="lrg-panel lrg-event" aria-live="polite">
          <p className="loc-eyebrow">{event.id} · 當前事件</p>
          <h2>{event.name}</h2><p>{event.description}</p>
          <small>需回應：{event.req.join(' ＋ ')}</small>
        </section>:null}
        {stage==='finished'?<section className="lrg-panel lrg-result" role="status">
          <h2>{game.draw?'平局':game.winner===null?'結算完成':'玩家 '+LETTERS[game.winner]+' 獲勝'}</h2>
          <p>{game.players.map((p,i)=>LETTERS[i]+'：德 '+p.de).join(' ／ ')}</p>
          <button type="button" className="loc-button primary" onClick={startGame}>再玩一局</button>
        </section>:null}
        {stage==='opening'?<section className="lrg-panel">
          <h2>玩家 {LETTERS[game.active]} · 起手棄牌</h2>
          <p>選擇 {rules.config.openingDiscard} 張起手牌棄置，保留其他手牌。</p>
        </section>:null}
        {stage==='event'?<nav className="lrg-player-tabs" aria-label="輪流選擇事件回應牌">
          {game.players.map((p,i)=><button type="button" key={i} className={'loc-button'+(viewer===i?' primary':'')}
            aria-pressed={viewer===i} onClick={()=>setViewer(i)}>
            玩家 {LETTERS[i]} · {p.selected.length}/{rules.config.eventResponseCards}
          </button>)}
        </nav>:null}
        {choosing&&player?<section className="lrg-panel" aria-label={'玩家 '+LETTERS[active]+' 手牌'}>
          <h2>玩家 {LETTERS[active]} 的手牌</h2>
          <p>已選 {selected.length}/{limit} 張。{stage==='event'?'每位玩家選完三張後統一判定。':''}</p>
          <div className="lrg-hand">
            {player.hand.map(card=><button key={card.id} type="button"
              className={'lrg-card'+(selected.includes(card.id)?' lrg-card--chosen':'')}
              aria-pressed={selected.includes(card.id)}
              onClick={()=>action('toggleCard',active,card.id)}>
              <img src={runeImage({rune_id:card.id})} alt="" loading="lazy"/>
              <strong>{card.name}</strong><small>{card.group} · {card.alphaCompatMacro||'特殊'}</small>
            </button>)}
          </div>
          {stage==='opening'?<button type="button" className="loc-button primary"
            disabled={selected.length!==limit}
            onClick={()=>action('confirmOpening',game.active)}>確認棄牌，交給下一位</button>:null}
          {stage==='event'&&complete?<button type="button" className="loc-button primary"
            onClick={()=>action('resolveEvent')}>全部確認 · 判定事件</button>:null}
        </section>:null}
        {(stage==='resonance'||stage==='duel')&&player?<section className="lrg-panel">
          <h2>玩家 {LETTERS[game.active]} 的共振行動</h2>
          <p>選擇回復自己或干預其他玩家。每名參與者依序執行一次。</p>
          <div className="lrg-actions">
            <button type="button" className="loc-button primary"
              onClick={()=>action('resonance','self',game.active)}>回復自身 · 德 +2</button>
            {targets.filter(i=>i!==game.active).map(i=><button type="button" className="loc-button"
              key={i} onClick={()=>action('resonance','attack',i)}>
              干預玩家 {LETTERS[i]} · 德 −2
            </button>)}
          </div>
        </section>:null}
        <section className="lrg-panel lrg-history" aria-label="牌局紀錄">
          <h2>狀態與操作紀錄</h2>
          <p role="status">{notice||game.result}</p>
          <ol>{game.logs.slice(0,12).map((line,i)=><li key={i}>{line}</li>)}</ol>
        </section>
      </>}
    </div>
  </main>;
}
