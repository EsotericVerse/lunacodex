'use client';

import {useEffect,useMemo,useReducer,useRef,useState} from 'react';
import dynamic from 'next/dynamic';
import {usePathname,useRouter,useSearchParams} from 'next/navigation';
import {runeImage,RUNE_CARD_BACK_IMAGE} from '../rune-directory.mjs';
import {LOC_ORIGIN} from '../../seo/metadata';
import {produce} from 'immer';
import {useAsyncResource} from '../../loc/use-async-resource';
import {
  Alert,Box,Button,Chip,Divider,FormControl,InputLabel,LinearProgress,MenuItem,
  Paper,Select,Stack,Tab,Tabs,TextField,ThemeProvider,Typography,createTheme
} from '@mui/material';
import {DndContext,PointerSensor,TouchSensor,useDraggable,useDroppable,useSensor,useSensors} from '@dnd-kit/core';
import {CartesianGrid,Legend,Line,LineChart,Tooltip,XAxis,YAxis} from 'recharts';
import {createLunaRunesGame} from './boardgame-rules.js';
import {useOnlineTabletop} from './use-online-tabletop.js';
import {loadGameData} from './game-data.js';
import ScopeEditableBlocks from '../../loc/ScopeEditableBlocks';
import {useAccount,usePassiveSessionAccount} from '../../loc/use-account';
import ManagementSectionNav from '../../modular/ManagementSectionNav';
import {resolveHomeImage} from '../../loc/LocHomeBlockDisplay';
import './game-board.css';
import '../effekseer/effekseer-stage.css';

// Reuse the existing 3D ritual stage only when a tabletop action needs VFX.
const GameRuneEffect=dynamic(()=>import('../effekseer/EffekseerStage'),{ssr:false});
const GameResonanceEffect=dynamic(()=>import('../effekseer/EffekseerStage').then(mod=>mod.WaitingEffekseerStage),{ssr:false});
const GameDocs=dynamic(()=>import('./GameDocs'),{loading:()=> <Alert severity="info">正在載入遊戲規則…</Alert>});

const LABELS=['A','B','C','D'];
const FALLBACK_THEME={
  mode:'dark',bg:'#101623',panel:'#1a2434',panel2:'#25334a',
  text:'#f4f1e9',muted:'#c1ccdd',heading:'#f4f1e9',
  accent:'#e4bf7c',gold:'#e4bf7c',line:'#34435b',danger:'#c66f7e'
};

function readLocTheme(){
  if(typeof document==='undefined')return FALLBACK_THEME;
  const root=document.documentElement;
  const css=getComputedStyle(root);
  const token=(name,fallback)=>css.getPropertyValue(name).trim()||fallback;
  return {
    mode:root.dataset.theme==='light'?'light':'dark',
    bg:token('--loc-bg',FALLBACK_THEME.bg),
    panel:token('--loc-panel',FALLBACK_THEME.panel),
    panel2:token('--loc-panel-2',FALLBACK_THEME.panel2),
    text:token('--loc-text',FALLBACK_THEME.text),
    muted:token('--loc-muted',FALLBACK_THEME.muted),
    heading:token('--loc-heading',FALLBACK_THEME.heading),
    accent:token('--loc-accent',FALLBACK_THEME.accent),
    gold:token('--loc-gold',FALLBACK_THEME.gold),
    line:token('--loc-line',FALLBACK_THEME.line),
    danger:token('--loc-danger',FALLBACK_THEME.danger)
  };
}

function buildGameTheme(tokens){
  return createTheme({
    palette:{
      mode:tokens.mode,
      primary:{main:tokens.accent},
      secondary:{main:tokens.gold},
      error:{main:tokens.danger},
      background:{default:tokens.bg,paper:tokens.panel},
      text:{primary:tokens.text,secondary:tokens.muted},
      divider:tokens.line
    },
    shape:{borderRadius:12},
    typography:{fontFamily:'system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'},
    components:{
      MuiButton:{defaultProps:{disableElevation:true}},
      MuiPaper:{defaultProps:{elevation:0},styleOverrides:{root:{backgroundImage:'none'}}},
      MuiChip:{styleOverrides:{root:{fontWeight:650}}}
    }
  });
}

function useLocGameTheme(){
  const [tokens,setTokens]=useState(FALLBACK_THEME);
  useEffect(()=>{
    const root=document.documentElement;
    const sync=()=>setTokens(readLocTheme());
    sync();
    const observer=new MutationObserver(sync);
    observer.observe(root,{attributes:true,attributeFilter:['style','data-theme','data-theme-id']});
    return()=>observer.disconnect();
  },[]);
  return useMemo(()=>buildGameTheme(tokens),[tokens]);
}

const cardSrc=card=>runeImage(card);
const labelStage=s=>s==='opening'?'起手棄牌':s==='event'?'事件':s==='duel'?'決鬥':s==='finished'?'結算':String(s||'').includes('resonance')?'共鳴':s||'—';
const samePair=(a,b,x,y)=>(a===x&&b===y)||(a===y&&b===x);

function eventVisual(data,event){
  const groups=event?.groups||[];
  if(groups.length===2){
    const pair=data.eventVisuals.find(item=>samePair(item.group,item.group2,groups[0],groups[1]));
    if(pair)return pair;
  }
  return data.groupAssets.find(item=>groups.includes(item.group))||null;
}

function fullRequirement(data,requirement=''){
  const macroMap=new Map((data.macros||[]).map(item=>[
    item.code,
    item.description||[item.groupA,item.groupB].filter(Boolean).join('＋')||item.title||item.code
  ]));
  return String(requirement||'')
    .split('+')
    .map(code=>macroMap.get(code.trim())||code.trim())
    .filter(Boolean)
    .join('／');
}

function EventScoringHelp({data}){
  const results=Array.from(data.resultByCoverage?.entries?.()||[])
    .sort((a,b)=>b[0]-a[0]);
  return <Paper variant="outlined" className="lrg-scoring-help">
    <Typography fontWeight={800}>Event 最高 4 分，這樣計算：</Typography>
    <ol>
      <li>第一張符文的群組符合事件條件：+1</li>
      <li>第二張符文的群組符合事件條件：+1</li>
      <li>兩張回應牌中至少出現 1 種符文群組：+1</li>
      <li>兩張符文來自不同群組：再 +1</li>
    </ol>
    <Typography variant="caption" color="text.secondary">結果依目前規則資料：</Typography>
    <Stack direction="row" gap={.75} flexWrap="wrap" sx={{mt:.75}}>
      {results.map(([score,result])=><Chip
        key={score}
        size="small"
        variant="outlined"
        label={score+'/4 '+result.label+' · De '+(result.delta>0?'+':'')+result.delta+' · 補 '+result.drawCount+' 張'}
      />)}
    </Stack>
  </Paper>;
}



function RuneCard({card,selected,disabled,onClick,playerIndex,roleName='',groupVisual=''}){
  const {attributes,listeners,setNodeRef,transform,isDragging}=useDraggable({
    id:'rune-'+playerIndex+'-'+card.id,
    disabled,
    data:{playerIndex,cardId:card.id}
  });
  return <button
    ref={setNodeRef}
    type="button"
    {...attributes}
    {...listeners}
    className={'lrg-card'+(selected?' picked':'')}
    aria-pressed={selected}
    disabled={disabled}
    onClick={onClick}
    title={card.name+'｜'+card.group+(card.action?'｜'+card.action:'')}
    style={{
      transform:transform?'translate3d('+transform.x+'px,'+transform.y+'px,0)':undefined,
      opacity:isDragging?.58:1,
      zIndex:isDragging?10:undefined
    }}
  >
    <img className="lrg-rune-art" src={cardSrc(card)} alt={card.name+'符文卡'} loading="lazy"/>
    {groupVisual?<img className="lrg-group-mark" src={groupVisual} alt="" aria-hidden="true" loading="lazy"/>:null}
    <span>
      <b>{String(card.id).padStart(2,'0')} {card.name}</b>
      <small>{card.group}{roleName?' · '+roleName:''}</small>
      {card.action?<em className="lrg-card-action">{card.action}</em>:null}
    </span>
  </button>;
}

// A presentation-only local opening deal. The game model already owns every
// hand and deck: these noninteractive card backs must never shuffle, draw or
// modify its authoritative state. CSS perspective supplies the brief 3D motion.
function OpeningDealCards({cards,roleByGroup,groupVisualByGroup}){
  return <>
    <span className="lrg-deal-pile" aria-hidden="true">
      <img src={RUNE_CARD_BACK_IMAGE} alt=""/>
    </span>
    {cards.map((card,index)=>{
      const column=index%4;
      const row=Math.floor(index/4);
      return <div
        key={card.id}
        className="lrg-deal-card"
        data-deal-card={index+1}
        style={{
          '--deal-order':index,
          '--deal-source-x':(1.5-column)*107+'%',
          '--deal-row-shift':row===0?'0%':'-100%'
        }}
        aria-hidden="true"
      >
        <div className="lrg-deal-flip">
          <div className="lrg-deal-side lrg-deal-back">
            <img src={RUNE_CARD_BACK_IMAGE} alt=""/>
          </div>
          <div className="lrg-deal-side lrg-deal-front">
            <img className="lrg-rune-art" src={cardSrc(card)} alt=""/>
            {groupVisualByGroup.get(card.group)?<img className="lrg-group-mark" src={groupVisualByGroup.get(card.group)} alt=""/>:null}
            <span>
              <b>{String(card.id).padStart(2,'0')} {card.name}</b>
              <small>{card.group}{roleByGroup.get(card.group)?' · '+roleByGroup.get(card.group):''}</small>
            </span>
          </div>
        </div>
      </div>;
    })}
  </>;
}

function SelectionZone({count,limit,playerIndex}){
  const {setNodeRef,isOver}=useDroppable({id:'selected-zone-'+playerIndex,data:{playerIndex}});
  return <Paper
    ref={setNodeRef}
    variant="outlined"
    className="lrg-dropzone"
    sx={{
      p:1.25,mt:1,borderStyle:'dashed',
      borderColor:isOver?'primary.main':'divider',
      bgcolor:isOver?'var(--loc-accent-surface,rgba(228,191,124,.10))':'transparent'
    }}
  >
    <Typography variant="body2">已選 {count} / {limit} 張 · 點擊卡牌，或拖曳至此選取</Typography>
  </Paper>;
}

function DeTrend({history,players}){
  if((history||[]).length<2)return <Alert severity="info">完成第一個遊戲行動後會開始顯示 De 軌跡。</Alert>;
  return <Paper className="lrg-history-panel">
    <Typography variant="h6" component="h2">De 軌跡</Typography>
    <div className="lrg-trend">
      <LineChart responsive style={{width:"100%",height:"100%"}}
           data={history} margin={{top:12,right:16,bottom:8,left:-12}}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--loc-line,#34435b)"/>
          <XAxis dataKey="step" tick={{fill:'var(--loc-muted,#c1ccdd)'}} stroke="var(--loc-line,#34435b)"/>
          <YAxis allowDecimals={false} tick={{fill:'var(--loc-muted,#c1ccdd)'}} stroke="var(--loc-line,#34435b)"/>
          <Tooltip contentStyle={{background:'var(--loc-panel,#1a2434)',border:'1px solid var(--loc-line,#34435b)',color:'var(--loc-text,#f4f1e9)',borderRadius:8}}/>
          <Legend/>
          {players.map((player,index)=><Line key={player.name} type="monotone" dataKey={LABELS[index]} name={player.name} stroke={['var(--loc-accent,#e4bf7c)','var(--loc-gold,#e4bf7c)','var(--loc-heading,#f4f1e9)','var(--loc-danger,#c66f7e)'][index]} strokeWidth={2.5} dot={{r:3}} isAnimationActive={false}/>)}
        </LineChart>
    </div>
  </Paper>;
}

function Board({G,moves,rules,onRestart,remoteEffect=null,restartLabel='新遊戲',animateLocalDeal=false}){
  const [target,setTarget]=useState('');
  const [tab,setTab]=useState('board');
  const [showScoringHelp,setShowScoringHelp]=useState(false);
  const [effectsEnabled,setEffectsEnabled]=useState(true);
  const [battleEffect,setBattleEffect]=useState(null);
  const effectSequence=useRef(0);
  const dealActive=animateLocalDeal&&G.stage==='opening';
  const dealPlayer=G.players[G.active];
  // Includes the active seat and hand identity; advancing to the next seat
  // always begins a new local deal without flashing its face-up cards.
  const dealToken=dealActive?
    G.round+':'+G.active+':'+dealPlayer.hand.map(card=>card.id).join(','):null;
  const [completedDeal,setCompletedDeal]=useState(null);
  const dealReady=!dealActive||completedDeal===dealToken;
  useEffect(()=>{
    if(!dealToken)return;
    if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){
      setCompletedDeal(dealToken);
      return;
    }
    // 140ms stagger + 900ms arrival/flip. Timing is cosmetic and does not
    // write any game state. All opening actions remain disabled until reveal.
    const timeout=window.setTimeout(
      ()=>setCompletedDeal(dealToken),900+Math.max(1,dealPlayer.hand.length)*140
    );
    return()=>window.clearTimeout(timeout);
  },[dealToken,dealPlayer?.hand.length]);

  useEffect(()=>{
    if(!battleEffect)return;
    const timer=setTimeout(()=>setBattleEffect(current=>current?.key===battleEffect.key?null:current),
      battleEffect.kind==='resonance'?2600:6000);
    return()=>clearTimeout(timer);
  },[battleEffect]);
  const playRuneEffect=(card,appearance='glyph')=>{
    if(!effectsEnabled||!card)return;
    setBattleEffect({key:++effectSequence.current,kind:'rune',appearance,rune:{
      rune_id:card.id,rune_name:card.name,english_name:card.englishName,
      group_name:card.group
    }});
  };
  const playResonanceEffect=()=>{
    if(!effectsEnabled)return;
    // This is a visual cue only: no rune is played or removed for resonance.
    const rune=rules.cards.find(card=>card.englishName==='Resonance');
    if(rune)playRuneEffect(rune);
    else setBattleEffect({key:++effectSequence.current,kind:'resonance'});
  };
  useEffect(()=>{
    if(!remoteEffect||!effectsEnabled)return;
    if(remoteEffect.kind==='rune'&&remoteEffect.card){
      playRuneEffect(remoteEffect.card,remoteEffect.appearance||'glyph');
    }else if(remoteEffect.kind==='resonance'){
      playResonanceEffect();
    }
  // Remote events are keyed by the accepted online state revision.
  },[remoteEffect]);

  const toggleRune=(playerIndex,id)=>{
    if(!dealReady)return;
    const player=G.players[playerIndex];
    if(player&&!player.selected.includes(id)&&
      (G.stage==='event'||(G.stage==='opening'&&playerIndex===G.active))){
      playRuneEffect(player.hand.find(card=>card.id===id));
    }
    moves.toggleCard(playerIndex,id);
  };
  const sensors=useSensors(
    useSensor(PointerSensor,{activationConstraint:{distance:8}}),
    useSensor(TouchSensor,{activationConstraint:{delay:180,tolerance:8}})
  );
  const active=G.players[G.active]||G.players[0];
  const event=G.eventDeck[G.eventIndex%G.eventDeck.length];
  const visual=eventVisual(rules,event);
  const opening=G.stage==='opening';
  const isEvent=G.stage==='event';
  const isResonance=String(G.stage||'').includes('resonance')||G.stage==='duel';
  const done=G.stage==='finished';
  const selectable=dealReady&&!done&&!isResonance;
  const players=opening?[{p:active,i:G.active}]:G.players.map((p,i)=>({p,i}));
  const roleByGroup=new Map((rules.roles||[]).map(role=>[role.group,role.formalName||role.publicName||role.name]));
  const groupVisualByGroup=new Map((rules.groupAssets||[]).map(item=>[item.group,item.path]));

  return <DndContext sensors={sensors} onDragEnd={({active:drag,over})=>{
      if(over?.data.current?.playerIndex===drag.data.current?.playerIndex&&drag.data.current){
        toggleRune(drag.data.current.playerIndex,drag.data.current.cardId);
      }
    }}>
      <main className="lrg">
        <Paper component="header" className="lrg-top">
          <div>
            <Typography variant="overline" color="primary">LUNARUNES · TABLETOP</Typography>
            <Typography variant="h4" component="h1">月之符文</Typography>
          </div>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Chip color="primary" label={'第 '+G.round+' 回合 · '+labelStage(G.stage)}/>
            <Button size="small" variant="outlined" aria-pressed={effectsEnabled}
              onClick={()=>{setEffectsEnabled(value=>!value);setBattleEffect(null);}}>
              3D特效：{effectsEnabled?'開':'關'}
            </Button>
            <Button variant="outlined" onClick={onRestart}>{restartLabel}</Button>
          </Stack>
        </Paper>

        <nav className="lrg-steps" aria-label="回合進度">
          {rules.rounds.map(r=><span key={r.round} className={r.round===G.round?'current':r.round<G.round?'past':''}>{r.round}</span>)}
          {G.round===9?<span className="current">9</span>:null}
        </nav>

        <Alert severity={done?'success':'info'} role="status" sx={{mb:1.5}}>{G.result}</Alert>

        <Tabs value={tab} onChange={(_,value)=>setTab(value)} variant="scrollable" scrollButtons="auto" aria-label="遊戲檢視">
          <Tab value="board" label="遊戲盤面"/>
          <Tab value="history" label="對局紀錄"/>
          <Tab value="docs" label="規則資料"/>
        </Tabs>

        {tab==='docs'?<DocsPanel data={rules}/>:null}

        {tab==='history'?<Stack spacing={1.5}>
          <DeTrend history={G.history} players={G.players}/>
          <Paper className="lrg-history-panel">
            <Typography variant="h6" component="h2">操作紀錄</Typography>
            <Stack divider={<Divider flexItem/>} sx={{mt:1}}>
              {G.logs.map((line,i)=><Typography key={i} variant="body2" sx={{py:.75}}>{line}</Typography>)}
            </Stack>
          </Paper>
        </Stack>:null}

        {tab==='board'?<div className="lrg-layout">
          <section className="lrg-table">
            <Paper className="lrg-field">
              {isEvent?<>
                <Stack direction={{xs:'column',sm:'row'}} spacing={2} alignItems={{sm:'center'}}>
                  {visual?.path?<figure className="lrg-event-visual"><img src={visual.path} alt={visual.title||event.name}/><figcaption>{visual.title}</figcaption></figure>:null}
                  <Box sx={{flex:1}}>
                    <Typography variant="overline" color="primary">EVENT · {event.id}</Typography>
                    <Typography variant="h5" component="h2">{event.name}</Typography>
                    <Typography sx={{mt:1}}>{event.description}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{mt:1}}>條件：{fullRequirement(rules,event.requirement)}</Typography>
                    <Stack direction="row" spacing={.5} alignItems="center" flexWrap="wrap" sx={{mt:1}}>
                      <Typography variant="body2">每位玩家選擇 {rules.config.eventResponseCards} 張符文卡回應；依符文群組是否符合事件條件判定結果。</Typography>
                      <Button
                        size="small"
                        variant="text"
                        className="lrg-help-button"
                        aria-label="查看 Event 得分計算"
                        aria-expanded={showScoringHelp}
                        onClick={()=>setShowScoringHelp(value=>!value)}
                      >(?)</Button>
                    </Stack>
                    {showScoringHelp?<EventScoringHelp data={rules}/>:null}
                  </Box>
                </Stack>
                <Button variant="contained" disabled={G.players.some(p=>p.selected.length!==rules.config.eventResponseCards)}
                  onClick={()=>{
                    const player=G.players.find(p=>p.selected.length);
                    playRuneEffect(player?.hand.find(card=>player.selected.includes(card.id)),'card');
                    moves.resolveEvent();
                  }}>結算事件</Button>
              </>:null}

              {isResonance?<>
                <Typography variant="overline" color="primary">RESONANCE</Typography>
                <Typography variant="h5" component="h2">{G.stage==='duel'?'最終決鬥':'共鳴階段'}</Typography>
                <Typography>輪到 {active.name} 行動。</Typography>
                <Stack direction={{xs:'column',md:'row'}} spacing={1.25} alignItems={{md:'center'}}>
                  <Button variant="contained" onClick={()=>{playResonanceEffect();moves.resonance('self');setTarget('');}}>自我共振 {rules.config.resonanceSelf>0?'+':''}{rules.config.resonanceSelf}</Button>
                  <FormControl size="small" sx={{minWidth:180}}>
                    <InputLabel id="resonance-target-label">目標玩家</InputLabel>
                    <Select labelId="resonance-target-label" label="目標玩家" value={target} onChange={e=>setTarget(e.target.value)}>
                      {G.players.map((p,i)=>i!==G.active?<MenuItem value={i} key={i} disabled={G.stage==='duel'&&!G.duelists.includes(i)}>{p.name}</MenuItem>:null)}
                    </Select>
                  </FormControl>
                  <Button disabled={target===''||(G.stage==='duel'&&!G.duelists.includes(Number(target)))} onClick={()=>{playResonanceEffect();moves.resonance('attack',Number(target));setTarget('');}}>干擾 {rules.config.resonanceAttack}</Button>
                  {G.stage!=='duel'?<Button disabled={target===''} onClick={()=>moves.toggleCooperation(Number(target))}>建立／解除合作</Button>:null}
                </Stack>
              </>:null}

              {opening?<>
                <Typography variant="overline" color="primary">SETUP</Typography>
                <Typography variant="h5" component="h2">{active.name} 起手設定</Typography>
                <Typography>選擇 {rules.config.openingDiscard} 張棄牌，保留 {rules.config.handBase} 張。</Typography>
                <Button variant="contained" disabled={!dealReady||active.selected.length!==rules.config.openingDiscard} onClick={()=>{if(!dealReady)return;playRuneEffect(active.hand.find(card=>active.selected.includes(card.id)),'card');moves.confirmOpening(G.active);}}>確認棄牌（{active.selected.length}/{rules.config.openingDiscard}）</Button>
              </>:null}

              {done?<>
                <Typography variant="overline" color="primary">GAME OVER</Typography>
                <Typography variant="h4" component="h2">{G.winner!==null?G.players[G.winner].name+' 勝出':'平局'}</Typography>
                <Button variant="contained" onClick={onRestart}>{restartLabel==='新遊戲'?'再玩一次':'離開房間'}</Button>
              </>:null}
            </Paper>

            <div className="lrg-players">
              {players.map(({p,i})=><Paper component="section" key={i} className={'lrg-player'+(G.active===i?' active':'')}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                  <div><Typography variant="overline">PLAYER {LABELS[i]}</Typography><Typography variant="h6" component="h3">{p.name}</Typography></div>
                  <Chip color={G.active===i?'primary':'default'} label={'De '+p.de+' / '+rules.config.deMax}/>
                </Stack>
                <LinearProgress variant="determinate" value={Math.max(0,Math.min(100,p.de/rules.config.deMax*100))} sx={{my:1.25,height:8,borderRadius:2}}/>
                <Typography variant="caption" color="text.secondary">手牌 {p.hand.length} · 牌庫 {p.deck.length} · 棄牌 {p.discard.length} · 已選 {p.selected.length}</Typography>
                {dealActive&&!dealReady&&i===G.active?<Typography variant="caption" className="lrg-deal-status" role="status">正在發牌…</Typography>:null}
                <div className="lrg-hand" data-deal-phase={dealActive&&!dealReady&&i===G.active?'dealing':undefined} aria-busy={dealActive&&!dealReady&&i===G.active}>
                  {dealActive&&!dealReady&&i===G.active?
                    <OpeningDealCards cards={p.hand} roleByGroup={roleByGroup} groupVisualByGroup={groupVisualByGroup}/>:
                    p.hand.map(card=><RuneCard key={card.id} card={card} playerIndex={i} roleName={roleByGroup.get(card.group)||''} groupVisual={groupVisualByGroup.get(card.group)||''} selected={p.selected.includes(card.id)} disabled={!selectable||(opening&&i!==G.active)} onClick={()=>toggleRune(i,card.id)}/>)}
                </div>
                {!done&&!isResonance&&((opening&&i===G.active)||isEvent)?<SelectionZone playerIndex={i} count={p.selected.length} limit={opening?rules.config.openingDiscard:rules.config.eventResponseCards}/>:null}
              </Paper>)}
            </div>
          </section>

          <Paper component="aside" className="lrg-side">
            <Typography variant="h6" component="h2">對局資訊</Typography>
            <Stack direction="row" flexWrap="wrap" gap={1}>
              <Chip size="small" label={G.players.length+' 人'}/>
              <Chip size="small" label={labelStage(G.stage)}/>
              <Chip size="small" label={'行動：'+active.name}/>
            </Stack>
            <Divider/>
            <Typography variant="body2">事件牌：{Math.min(G.eventIndex+1,G.eventDeck.length)} / {G.eventDeck.length}</Typography>
            <Typography variant="body2">合作關係：{G.cooperations.length}</Typography>
            {G.lastInteraction?<Typography variant="body2">最近互動：{G.players[G.lastInteraction.from]?.name} → {G.players[G.lastInteraction.to]?.name}</Typography>:null}
            <Divider/>
            <Typography variant="subtitle2">最新紀錄</Typography>
            {G.logs.slice(0,6).map((line,i)=><Typography variant="caption" color="text.secondary" key={i}>{line}</Typography>)}
          </Paper>
        </div>:null}
        {battleEffect?<div className="lrg-battle-effect" aria-hidden="true" key={battleEffect.key}>
          {battleEffect.kind==='rune'?
            <GameRuneEffect rune={battleEffect.rune} ceremony appearance={battleEffect.appearance}
              cardSrc={cardSrc(battleEffect.rune)} textureQuality="original" quality="high" vfxOnly
              onCeremonyComplete={()=>setBattleEffect(current=>current?.key===battleEffect.key?null:current)}/>:
            <GameResonanceEffect textureQuality="original"/>}
        </div>:null}
      </main>
    </DndContext>;
}

// Hero copy and image are Scope content (lrunes / page "game"); only the
// game-data badges below stay fixed UI and wait for SQL.
const GAME_HERO_DEFAULTS={eyebrow:'LUNARUNES · TABLETOP',title:'月之符文',text:'<p>以 66 枚符文、事件回應、De 與共鳴互動構成的本機多人桌遊。</p>'};
function GameHomeHero({data=null,editing=false,onEditorExit=null}){
  return <ScopeEditableBlocks
    scopeId="lrunes"
    page="game"
    adminOnly
    allowEditing={editing}
    authorizedByParent={editing}
    startInEditMode={editing}
    onEditorExit={onEditorExit}
    orders={[1]}
    slotTag="header"
    slotClassName="lrg-home-hero"
    resolveSlotClassName={()=> 'lrg-home-hero'}
    editSlotClassName="loc-card loc-home-block"
    containerless
    placeholderFirstOrder={1}
    explicitEditButton
    allowDelete={false}
    allowEntities={false}
    renderDisplay={slot=>{
      const image=resolveHomeImage({...slot,order:1},'lrunes');
      const eyebrow=slot.stored?slot.eyebrow:GAME_HERO_DEFAULTS.eyebrow;
      const title=slot.stored?slot.title:GAME_HERO_DEFAULTS.title;
      const text=slot.stored?slot.text:GAME_HERO_DEFAULTS.text;
      return <>
        <div className="lrg-home-copy">
          {eyebrow?<Typography variant="overline" color="primary">{eyebrow}</Typography>:null}
          {title?<Typography variant="h3" component="h1">{title}</Typography>:null}
          {text?<div className="scope-rich-surface" dangerouslySetInnerHTML={{__html:text}}/>:null}
          {data?<Stack direction="row" flexWrap="wrap" gap={1} sx={{mt:1.5}}>
            <Chip label={data.cards.length+' 枚符文'}/>
            <Chip label={data.events.length+' 張事件'}/>
            <Chip label={data.roles.length+' 職'}/>
            <Chip label={data.rounds.length+' 個正式回合＋平手決鬥'}/>
          </Stack>:null}
        </div>
        {image.src?<img className="lrg-hero-image" src={image.src} alt="月之符文桌遊主視覺"/>:null}
      </>;
    }}
  />;
}

function OnlineMatch({data,count,code,host,onExit}){
  const [shareError,setShareError]=useState('');
  const {G,moves,start,online,members,error,remoteEffect,hostOnline}=
    useOnlineTabletop({data,count,code,host});
  return <div className="lrg-online">
    <Paper className="lrg-setup" sx={{m:{xs:1,sm:2},p:2}}>
      <Stack direction={{xs:'column',sm:'row'}} spacing={1.5}
        justifyContent="space-between" alignItems={{sm:'center'}}>
        <div>
          <Typography variant="overline" color="primary">LUNARUNES · 線上對戰</Typography>
          <Typography variant="h6" component="h1">房間 {code}</Typography>
          <Typography variant="body2" color="text.secondary" role="status">
            {online?'已連上 Supabase Realtime':'連線中／連線已中斷'}
            {' · 在線裝置 '+members.length}
            {host?' · 房主':' · 已加入'}
          </Typography>
        </div>
        <Stack direction="row" spacing={1} flexWrap="wrap">
          <Button variant="outlined" onClick={()=>{
            navigator.clipboard?.writeText(code).catch(()=>{});
          }}>複製房間碼</Button>
          <Button variant="outlined" onClick={async()=>{
            const url=LOC_ORIGIN+'/game/room/?room='+code;
            setShareError('');
            try{
              const {Capacitor}=await import('@capacitor/core');
              if(Capacitor.isNativePlatform()){
                const {Share}=await import('@capacitor/share');
                await Share.share({title:'月之符文線上對戰',url,dialogTitle:'邀請玩家加入房間'});
              }else if(typeof navigator.share==='function'){
                await navigator.share({title:'月之符文線上對戰',url});
              }else{
                await navigator.clipboard.writeText(url);
              }
            }catch(error){
              // Share sheets can be dismissed by the player without changing the room.
              if(!/cancel|dismiss|abort/i.test(String(error?.message||error)))
                setShareError('無法啟動分享功能；可直接將下方連結傳給朋友。');
            }
          }}>分享跨裝置邀請連結</Button>
          <Button variant="outlined" onClick={onExit}>離開房間</Button>
        </Stack>
      </Stack>
      {error?<Alert severity="error" role="alert" sx={{mt:1}}>{error}</Alert>:null}
      {shareError?<Alert severity="warning" role="alert" sx={{mt:1}}>
        {shareError} <span style={{overflowWrap:'anywhere'}}>{LOC_ORIGIN+'/game/room/?room='+code}</span>
      </Alert>:null}
      {!hostOnline?<Alert severity="warning" role="status" sx={{mt:1}}>
        房主不在線，請等待房主重新連線。此模式不會將對局永久存檔。
      </Alert>:null}
      {!G?<Stack spacing={1} sx={{mt:2}}>
        <Typography>{host?'房間已建立，可以等待朋友加入，也可以直接自己開始。':
          '等待房主開始對局。你可以在此等候，遊戲開始後會自動顯示牌桌。'}</Typography>
        {host?<Button variant="contained" disabled={!online}
          onClick={start}>開始線上對局（{count} 人）</Button>:null}
      </Stack>:null}
    </Paper>
    {G&&online&&hostOnline?<Board G={G} moves={moves} rules={data} remoteEffect={remoteEffect} onRestart={onExit} restartLabel="離開房間"/>:null}
    {G&&(!online||!hostOnline)?<Alert severity="info" role="status" sx={{m:2}}>牌桌暫停，等待恢復連線後繼續同一場對局。</Alert>:null}
  </div>;
}

function LocalMatch({data,count,onRestart}){
  const game=useMemo(()=>createLunaRunesGame(data,count),[data,count]);
  const [G,dispatch]=useReducer(
    (state,{move,args})=>produce(state,draft=>game.moves[move]({G:draft},...args)),
    null,()=>game.setup()
  );
  const moves=useMemo(()=>Object.fromEntries(
    Object.keys(game.moves).map(move=>[move,(...args)=>dispatch({move,args})])
  ),[game]);
  return <Board G={G} moves={moves} rules={data} onRestart={onRestart} animateLocalDeal/>;
}

export default function GameBoard(){
  const uiTheme=useLocGameTheme();
  const {data,error,isLoading}=useAsyncResource(['lrunes','game','current'],loadGameData);
  const [count,setCount]=useState(2);
  const [match,setMatch]=useState(0);
  const router=useRouter();
  const pathname=usePathname();
  const searchParams=useSearchParams();
  const roomFromUrl=pathname?.startsWith('/game/room')?
    String(searchParams.get('room')||'').trim().toUpperCase():'';
  const validRoomFromUrl=/^[A-F0-9]{12}$/.test(roomFromUrl);
  const [onlineRoom,setOnlineRoom]=useState(null);
  useEffect(()=>{
    if(!validRoomFromUrl||!pathname?.startsWith('/game/room'))return;
    // The Next.js room segment represents joining a remote host. A visitor
    // never becomes host by changing query parameters.
    setOnlineRoom(current=>current?.code===roomFromUrl?current:
      {code:roomFromUrl,count:2,host:false});
  },[pathname,roomFromUrl,validRoomFromUrl]);
  const [inviteCode,setInviteCode]=useState('');
  const [roomError,setRoomError]=useState('');
  const [section,setSection]=useState('play');
  const [checkingEdit,setCheckingEdit]=useState(false);
  const [editError,setEditError]=useState('');
  const session=usePassiveSessionAccount();
  // Public game views must not fetch management permissions until edit is requested.
  const management=useAccount({enabled:false});
  const [authorizedEdit,setAuthorizedEdit]=useState(false);
  async function chooseSection(next){
    if(section==='edit'||checkingEdit)return;
    setEditError('');
    if(next!=='edit'){setSection(next);return;}
    setCheckingEdit(true);
    try{
      const permission=await management.refresh();
      if(!permission?.authorizer?.canManageGlobalSync()){
        setEditError('僅 LOC 管理者可以編輯遊戲首頁 Hero。');
        return;
      }
      setAuthorizedEdit(true);
      setSection('edit');
    }catch(error){
      setEditError('無法驗證管理權限：'+String(error?.message||error));
    }finally{
      setCheckingEdit(false);
    }
  }

  if(isLoading)return <ThemeProvider theme={uiTheme}><main className="lrg lrg-home">
    <GameHomeHero/>
    <Alert severity="info">載入遊戲資料…</Alert>
  </main></ThemeProvider>;
  if(error||!data)return <ThemeProvider theme={uiTheme}><main className="lrg lrg-home">
    <GameHomeHero/>
    <Alert severity="error" role="alert">遊戲資料載入失敗：{error?.message||'無資料'}</Alert>
  </main></ThemeProvider>;
  if(pathname?.startsWith('/game/room')&&!validRoomFromUrl)
    return <ThemeProvider theme={uiTheme}><main className="lrg">
      <Alert severity="warning" role="alert">房間邀請網址無效。請使用房主分享的完整連結。</Alert>
      <Button onClick={()=>router.replace('/game/')}>返回遊戲首頁</Button>
    </main></ThemeProvider>;
  if(onlineRoom)return <ThemeProvider theme={uiTheme}>
    <OnlineMatch key={onlineRoom.code} data={data} count={onlineRoom.count}
      code={onlineRoom.code} host={onlineRoom.host}
      onExit={()=>{setOnlineRoom(null);if(pathname?.startsWith('/game/room'))router.replace('/game/');}}/>
  </ThemeProvider>;
  if(pathname?.startsWith('/game/room'))return <ThemeProvider theme={uiTheme}>
    <main className="lrg"><Alert severity="info" role="status">正在加入線上房間…</Alert></main>
  </ThemeProvider>;
  if(match)return <ThemeProvider theme={uiTheme}><LocalMatch key={match} data={data} count={count} onRestart={()=>setMatch(0)}/></ThemeProvider>;

  const sections=[
    {value:'play',label:'開始遊戲',description:'遊戲介紹與建立本機對局'},
    {value:'rules',label:'遊戲規則',description:'回合流程、事件判定與四組簡稱'},
    {value:'events',label:'事件卡 · '+data.events.length,description:'事件條件與卡片內容'},
    {value:'roles',label:'八職 · '+data.roles.length,description:'職業定位、介入與工具'},
    {value:'actions',label:'符文行動 · '+data.runeActions.length,description:'各符文的遊戲行動效果'},
    ...(session.user?[{value:'edit',label:'編輯 Hero',description:'只變更遊戲首頁的文字與主視覺'}]:[])
  ];
  const visibleSections=section==='edit'?
    [{value:'edit',label:'Hero 編輯中',description:'儲存或取消後返回遊戲首頁'}]:sections;
  return <ThemeProvider theme={uiTheme}>
    <main className="lrg lrg-home">
      <GameHomeHero key={section==='edit'?'editing':'display'} data={data}
        editing={section==='edit'&&authorizedEdit}
        onEditorExit={()=>{setAuthorizedEdit(false);setSection('play');}}/>
      <div className="management-workspace lrg-home-workspace">
        <ManagementSectionNav showDescriptions id="game-home-sections" title="遊戲選單"
          panelId="game-home-panel" items={visibleSections} value={section}
          onChange={chooseSection}/>
        <div className="management-workspace-panel lrg-home-panel" id="game-home-panel"
          role="region" aria-labelledby={'game-home-sections-option-'+section}>
          {editError?<Alert severity="warning" role="alert">{editError}</Alert>:null}
          {checkingEdit?<Alert severity="info" role="status">正在驗證 Hero 編輯權限…</Alert>:null}
          {section==='play'?<>
            <Paper className="lrg-setup">
              <Typography variant="h6" component="h2">建立本機對局</Typography>
              <Typography variant="body2" color="text.secondary">同一裝置依序操作 A–D 玩家，不需要登入，也不寫入私人對局資料。</Typography>
              <Stack direction={{xs:'column',sm:'row'}} spacing={1.5} alignItems={{sm:'center'}} sx={{mt:2}}>
                <FormControl size="small" sx={{minWidth:160}}>
                  <InputLabel id="player-count-label">玩家人數</InputLabel>
                  <Select labelId="player-count-label" label="玩家人數" value={count} onChange={e=>setCount(Number(e.target.value))}>
                    {Array.from({length:data.config.playerMax-data.config.playerMin+1},(_,i)=>i+data.config.playerMin).map(n=><MenuItem key={n} value={n}>{n} 人</MenuItem>)}
                  </Select>
                </FormControl>
                <Button variant="contained" size="large" onClick={()=>setMatch(x=>x+1)}>本機開始遊戲</Button>
                <Button variant="outlined" size="large" onClick={()=>{
                  const bytes=crypto.getRandomValues(new Uint8Array(6));
                  const code=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();
                  setRoomError('');
                  setOnlineRoom({code,count,host:true});
                }}>建立線上房間</Button>
              </Stack>
              <Divider sx={{my:2}}/>
              <Typography variant="subtitle2">跨裝置線上對戰</Typography>
              <Typography variant="body2" color="text.secondary" sx={{mb:1}}>
                手機、IPA 與網頁輸入相同房間碼即可同桌遊玩。無須登入；房主在線時同步遊戲。
              </Typography>
              <Stack direction={{xs:'column',sm:'row'}} spacing={1} alignItems={{sm:'center'}}>
                <TextField size="small" label="房間代碼" autoComplete="off"
                  value={inviteCode} onChange={e=>setInviteCode(e.target.value.toUpperCase().replace(/\s/g,''))}
                  inputProps={{maxLength:12}}/>
                <Button variant="contained" disabled={!/^[A-F0-9]{12}$/.test(inviteCode)}
                  onClick={()=>{
                    if(!/^[A-F0-9]{12}$/.test(inviteCode)){setRoomError('請輸入 12 位房間代碼');return;}
                    setRoomError('');
                    router.push('/game/room/?room='+encodeURIComponent(inviteCode));
                  }}>加入線上房間</Button>
              </Stack>
              {roomError?<Alert severity="warning" sx={{mt:1}}>{roomError}</Alert>:null}
            </Paper>
          </>:null}
          {['rules','events','roles','actions'].includes(section)?
            <GameDocs key={section} data={data} section={section} fullRequirement={fullRequirement}/>:null}
          {section==='edit'&&authorizedEdit?<p className="scope-status">請在上方編輯遊戲 Hero。</p>:null}
        </div>
      </div>
    </main>
  </ThemeProvider>;
}
