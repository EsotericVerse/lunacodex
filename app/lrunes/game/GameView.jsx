'use client';

import {useEffect,useMemo,useRef,useState} from 'react';
import {runeImage} from '../rune-directory.mjs';
import {useAsyncResource} from '../../loc/use-async-resource';
import Select from 'react-select';
import {AnimatePresence,motion} from 'motion/react';
import {CartesianGrid,Legend,Line,LineChart,ReferenceLine,Tooltip,XAxis,YAxis} from 'recharts';
import {
  applyDe,draw,evaluateAlphaEvent,finishOpening,freshPlayer,loadGameData,shuffle
} from './game-data';
import {getThemeSlot,THEME_SLOTS} from '../../modular/theme-registry';
const gameHeroAsset={src:'/pics/LunaRunesGame.jpg'};

const NAMES=['A','B','C','D'];
const GAME_THEME_DEFAULT='theme-4';
const GAME_THEME_AUTO='event-auto';
const GAME_THEME_BY_GROUP=Object.freeze(Object.fromEntries(THEME_SLOTS.map(slot=>[slot.label,slot.id])));
const CHART_STROKES=['var(--loc-accent)','var(--loc-gold)','var(--loc-text)','var(--loc-muted)'];
const CHART_TOOLTIP={background:'var(--loc-panel)',border:'1px solid var(--loc-line)',color:'var(--loc-text)',borderRadius:'8px'};

function deSnapshot(players,label){
  const row={step:label};
  players.forEach((player,index)=>{row[NAMES[index]]=player.de;});
  return row;
}

function samePair(a,b,x,y){
  return (a===x&&b===y)||(a===y&&b===x);
}

function EventScene({event,data}){
  if(!event)return null;
  const groups=event.groups||[];
  const visuals=groups.map(group=>groupVisual(data.groupAssets,group)).filter(Boolean);
  if(groups.length===2){
    const bespoke=data.eventVisuals.find(item=>samePair(item.group,item.group2,groups[0],groups[1]));
    if(bespoke)return <EventVisual item={bespoke}/>;
  }
  if(visuals.length===1)return <EventVisual item={visuals[0]}/>;
  if(!visuals.length)return null;
  return <div className="game-event-pair-composite">
    {visuals.map(item=><EventVisual key={item.code} item={item}/>)}
  </div>;
}

function MatchTrend({history=[],players=[],focusPlayer=null,focusStep=''}) {
  if(history.length<2)return null;
  return <section className="loc-card game-trend-card">
    <h2>De 軌跡</h2>
    <div className="game-trend-chart">
      <LineChart responsive style={{width:"100%",height:"100%"}} data={history} margin={{top:10,right:20,bottom:8,left:0}}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--loc-line)"/>
          <XAxis dataKey="step" tick={{fill:'var(--loc-text)'}} stroke="var(--loc-line)"/>
          <YAxis allowDecimals={false} tick={{fill:'var(--loc-text)'}} stroke="var(--loc-line)"/>
          <Tooltip contentStyle={CHART_TOOLTIP}/>
          <Legend/>
          {focusStep?<ReferenceLine x={focusStep} stroke="var(--loc-gold)" strokeDasharray="4 4"/>:null}
          {players.map((player,index)=><Line key={player.name} type="monotone" dataKey={NAMES[index]} name={player.name} stroke={CHART_STROKES[index%CHART_STROKES.length]} strokeWidth={focusPlayer===null||focusPlayer===index?3:1.5} strokeOpacity={focusPlayer===null||focusPlayer===index?1:.28} dot={{r:focusPlayer===index?5:3}} isAnimationActive/>)}
        </LineChart>
    </div>
  </section>;
}

function ResonanceNetwork({players=[],active=0,focusPlayer=null,cooperations=[],lastInteraction=null,onSelect=null,themeKey=''}){
  const containerRef=useRef(null);
  const onSelectRef=useRef(onSelect);
  const [error,setError]=useState('');
  useEffect(()=>{onSelectRef.current=onSelect;},[onSelect]);
  useEffect(()=>{
    let cancelled=false;
    let network=null;
    if(!containerRef.current)return undefined;
    setError('');
    const computed=getComputedStyle(containerRef.current);
    const accent=computed.getPropertyValue('--loc-accent').trim()||'#7c9bbd';
    const gold=computed.getPropertyValue('--loc-gold').trim()||accent;
    const panel=computed.getPropertyValue('--loc-panel').trim()||'#fff';
    const line=computed.getPropertyValue('--loc-line').trim()||'#aab';
    const text=computed.getPropertyValue('--loc-text').trim()||'#222';
    const count=Math.max(1,players.length);
    const nodes=players.map((player,index)=>{
      const angle=(-Math.PI/2)+(Math.PI*2*index/count);
      return {
        id:String(index),
        label:player.name+'\nDe '+player.de,
        x:Math.cos(angle)*150,
        y:Math.sin(angle)*95,
        fixed:true,
        shape:'dot',
        size:index===focusPlayer?38:index===active?34:28,
        color:{background:panel,border:index===focusPlayer?gold:index===active?accent:line},
        font:{color:text,size:15,bold:index===active||index===focusPlayer}
      };
    });
    const edges=cooperations.map((item,index)=>({
      id:'coop-'+index,
      from:String(item.a),to:String(item.b),
      label:'合作',width:3,color:{color:accent,highlight:accent},smooth:{type:'curvedCW',roundness:.14}
    }));
    if(lastInteraction?.type==='attack'&&lastInteraction.from!==lastInteraction.to){
      edges.push({
        id:'last-attack',
        from:String(lastInteraction.from),to:String(lastInteraction.to),
        label:'干擾',arrows:'to',dashes:true,width:3,color:{color:gold,highlight:gold},smooth:{type:'curvedCCW',roundness:.14}
      });
    }
    import('vis-network/standalone').then(({Network})=>{
      if(cancelled||!containerRef.current)return;
      network=new Network(containerRef.current,{nodes,edges},{
        autoResize:true,
        physics:{enabled:false},
        interaction:{hover:true,dragNodes:false,zoomView:false,dragView:false,selectable:true},
        nodes:{borderWidth:2},
        edges:{font:{align:'middle',size:12,color:text},selectionWidth:2}
      });
      network.on('selectNode',event=>{
        const id=Number(event.nodes?.[0]);
        if(Number.isInteger(id)&&typeof onSelectRef.current==='function')onSelectRef.current(id);
      });
      network.fit({animation:{duration:180,easingFunction:'easeInOutQuad'}});
    }).catch(reason=>{if(!cancelled)setError(reason?.message||'共鳴網路載入失敗');});
    return()=>{cancelled=true;network?.destroy();};
  },[players,active,focusPlayer,cooperations,lastInteraction,themeKey]);
  return <div className="game-network-wrap">
    {error?<p className="loc-status">{error}</p>:null}
    <div ref={containerRef} className="game-resonance-network" role="img" aria-label="玩家共鳴與合作關係圖"/>
  </div>;
}


function replayGroup(line=''){
  if(line.includes('事件'))return '事件';
  if(line.includes('共鳴')||line.includes('決鬥'))return '共鳴';
  if(line.includes('合作'))return '合作';
  return '系統';
}

function replayPlayerIndex(line=''){
  return NAMES.findIndex(name=>new RegExp('(^|[^A-Z])'+name+'([^A-Z]|$)').test(String(line||'')));
}

function replayRound(line=''){
  const match=String(line||'').match(/第\s*(\d+)\s*回合/);
  return match?Number(match[1]):null;
}

function ReplayTimeline({logs=[],selectedLogIndex=null,onSelect=null}){
  const containerRef=useRef(null);
  const timelineRef=useRef(null);
  const onSelectRef=useRef(onSelect);
  const [error,setError]=useState('');
  useEffect(()=>{onSelectRef.current=onSelect;},[onSelect]);
  useEffect(()=>{
    let cancelled=false;
    let instance=null;
    if(!containerRef.current||!logs.length)return undefined;
    setError('');
    const chronological=logs.map((line,logIndex)=>({line,logIndex})).reverse();
    const base=Date.UTC(2000,0,1,0,0,0);
    import('vis-timeline/standalone').then(({DataSet,Timeline})=>{
      if(cancelled||!containerRef.current)return;
      const rows=chronological.map((entry,index)=>({
        id:String(entry.logIndex),
        group:replayGroup(entry.line),
        content:String(entry.line),
        title:String(entry.line),
        start:new Date(base+index*60000),
        type:'point'
      }));
      const groupIds=[...new Set(rows.map(row=>row.group))];
      instance=new Timeline(
        containerRef.current,
        new DataSet(rows),
        new DataSet(groupIds.map(id=>({id,content:id}))),
        {
          autoResize:true,
          minHeight:'220px',
          maxHeight:'320px',
          showCurrentTime:false,
          showMajorLabels:false,
          showMinorLabels:false,
          selectable:true,
          moveable:false,
          zoomable:false,
          stack:true,
          margin:{axis:8,item:{horizontal:8,vertical:8}}
        }
      );
      instance.on('select',({items=[]})=>{
        const selected=Number(items[0]);
        if(Number.isInteger(selected)&&typeof onSelectRef.current==='function')onSelectRef.current(selected);
      });
      timelineRef.current=instance;
      instance.fit({animation:false});
    }).catch(reason=>{if(!cancelled)setError(reason?.message||'對局時間軸載入失敗');});
    return()=>{cancelled=true;instance?.destroy();timelineRef.current=null;};
  },[logs]);
  useEffect(()=>{
    if(!timelineRef.current)return;
    timelineRef.current.setSelection(Number.isInteger(selectedLogIndex)?[String(selectedLogIndex)]:[]);
  },[selectedLogIndex]);
  if(!logs.length)return null;
  return <section className="loc-card game-replay-card">
    <h2>對局 Replay</h2>
    <p className="game-player-meta">事件、共鳴、合作與系統操作依實際發生順序排列；點選節點可同步聚焦盤面與 De 軌跡。</p>
    {error?<p className="loc-status">{error}</p>:null}
    <div ref={containerRef} className="game-replay-timeline" role="region" aria-label="對局 Replay 時序"/>
  </section>;
}

const runeCardImage=runeImage;

function groupVisual(groupAssets,groupName){
  return groupAssets.find(item=>item.group===groupName)||null;
}

function phaseMark(phase){
  if(phase==='event')return '事';
  if(phase==='duel')return '決';
  return '鳴';
}
function phaseText(phase){
  if(phase==='event')return '事件';
  if(phase==='duel')return '決鬥';
  return '共鳴';
}

function signed(value){
  const number=Number(value||0);
  return number>0?'+'+number:String(number);
}

function GameThemeControl({value,onChange,effectiveSlot}){
  const options=[
    {value:GAME_THEME_AUTO,label:'事件跟隨'},
    ...THEME_SLOTS.map(slot=>({value:slot.id,label:slot.label}))
  ];
  const selected=options.find(option=>option.value===value)||options.find(option=>option.value===GAME_THEME_DEFAULT);
  return <label className="game-theme-control">
    <span>遊戲主題</span>
    <Select
      className="game-theme-select"
      classNamePrefix="game-theme-select"
      unstyled
      isSearchable={false}
      options={options}
      value={selected}
      onChange={option=>onChange(option?.value||GAME_THEME_DEFAULT)}
      aria-label="遊戲主題"
    />
    <small>{value===GAME_THEME_AUTO?'目前跟隨 '+effectiveSlot.label+' 組':'局部 '+effectiveSlot.label+' 主題'}</small>
  </label>;
}

function DeMeter({value=0,max=8}){
  return <div className="game-de-meter" aria-label={'De '+value+' / '+max} style={{gridTemplateColumns:'repeat('+max+',1fr)'}}>
    {Array.from({length:max},(_,index)=><motion.span key={index} className={index<value?'is-on':''} animate={{scaleY:index<value?1.3:1,opacity:index<value?1:.65}} transition={{duration:.18}}/>)}
  </div>;
}

function RuneCard({card,selected=false,onClick=null,compact=false}){
  if(!card)return null;
  const Tag=onClick?'button':'div';
  return <Tag
    type={onClick?'button':undefined}
    className={'game-rune-card'+(selected?' is-selected':'')+(compact?' is-compact':'')}
    onClick={onClick||undefined}
    aria-pressed={onClick?selected:undefined}
    title={card.name+'｜'+card.group+(card.action?'｜'+card.action:'')}
  >
    <img src={runeCardImage(card)} alt={card.name+'符文卡'} loading="lazy"/>
    <span><b>{String(card.id).padStart(2,'0')} {card.name}</b><small>{card.group}</small></span>
  </Tag>;
}

function EventVisual({item,small=false}){
  if(!item)return null;
  return <motion.figure layout initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-10}} className={'game-event-visual'+(small?' is-small':'')}>
    <img src={item.path} alt={(item.title||'事件')+'圖'} loading="lazy"/>
    <figcaption>{item.title}</figcaption>
  </motion.figure>;
}

function RoundRail({round=1,rounds=[]}){
  const sequence=round===9?[...rounds,{round:9,phase:'duel',title:'第 9 回合'}]:rounds;
  return <div className="game-round-rail" aria-label="回合進度" style={{gridTemplateColumns:'repeat('+sequence.length+',minmax(64px,1fr))'}}>
    {sequence.map(item=>{
      const current=item.round===round;
      const done=item.round<round;
      return <motion.div layout className={'game-round-node'+(current?' is-current':'')+(done?' is-done':'')} key={item.round} animate={{y:current?-2:0,scale:current?1.025:1}} transition={{duration:.18}}>
        <span>第 {item.round} 回合</span><b>{phaseMark(item.phase)}</b>
      </motion.div>;
    })}
  </div>;
}

function GameDocs({data}){
  const [section,setSection]=useState('rules');
  const [query,setQuery]=useState('');
  const [groupFilter,setGroupFilter]=useState(null);

  const searchRows=useMemo(()=>{
    const rows=[];
    const add=(sectionName,row,title,body,groups=[])=>{
      rows.push({
        key:String(rows.length+1),
        section:sectionName,
        row,
        groups:[...new Set((groups||[]).filter(Boolean))],
        text:[title,body,...groups].filter(Boolean).join(' ')
      });
    };
    data.rules.filter(row=>!['ROUND_PHASE','EVENT_RESULT'].includes(row.rule_code))
      .forEach(row=>add('rules',row,row.rule_title,row.rule_text));
    data.events.forEach(row=>add('events',row,row.name,[row.requirement,row.description].filter(Boolean).join(' '),row.groups));
    data.roles.forEach(row=>add('roles',row,row.name,[row.focus,row.mode,row.intervention,row.tool,row.tagline].filter(Boolean).join(' '),[row.group]));
    data.runeActions.forEach(row=>add('actions',row,row.name,[row.text,row.kind,row.value].filter(value=>value!==null&&value!==undefined).join(' '),[row.group]));
    return rows;
  },[data]);

  const groupOptions=useMemo(()=>[...new Set(data.cards.map(card=>card.group).filter(Boolean))]
    .map(group=>({value:group,label:group})),[data.cards]);

  const visibleRows=useMemo(()=>{
    const normalized=String(query||'').normalize('NFKC').toLocaleLowerCase('zh-Hant').trim();
    return searchRows.filter(item=>
      item.section===section
      &&(!groupFilter?.value||item.groups.includes(groupFilter.value))
      &&(!normalized||item.text.normalize('NFKC').toLocaleLowerCase('zh-Hant').includes(normalized))
    );
  },[searchRows,section,query,groupFilter]);

  const currentRules=visibleRows.filter(item=>item.section==='rules').map(item=>item.row);
  const events=visibleRows.filter(item=>item.section==='events').map(item=>item.row);
  const roles=visibleRows.filter(item=>item.section==='roles').map(item=>item.row);
  const actions=visibleRows.filter(item=>item.section==='actions').map(item=>item.row);

  function switchSection(next){
    setSection(next);
    setGroupFilter(null);
  }

  return <section className="loc-card game-docs">
    <div className="game-doc-tabs">
      <button type="button" className={'loc-button '+(section==='rules'?'primary':'')} onClick={()=>switchSection('rules')}>遊戲規則</button>
      <button type="button" className={'loc-button '+(section==='events'?'primary':'')} onClick={()=>switchSection('events')}>事件卡</button>
      <button type="button" className={'loc-button '+(section==='roles'?'primary':'')} onClick={()=>switchSection('roles')}>八職</button>
      <button type="button" className={'loc-button '+(section==='actions'?'primary':'')} onClick={()=>switchSection('actions')}>符文行動</button>
    </div>

    <div className="game-doc-tools">
      <label className="game-doc-search">
        <span>局部搜尋</span>
        <input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜尋事件、規則、職業或符文行動"/>
      </label>
      {section!=='rules'?<label className="game-doc-group-filter">
        <span>分組</span>
        <Select
          className="game-select"
          classNamePrefix="game-select"
          unstyled
          isClearable
          isSearchable
          options={groupOptions}
          value={groupFilter}
          onChange={setGroupFilter}
          placeholder="全部分組"
          noOptionsMessage={()=>"沒有符合的分組"}
        />
      </label>:null}
    </div>

    {section==='rules'&&<div className="game-doc-copy">
      <h2>遊戲規則</h2>
      <div className="game-role-grid">
        {currentRules.map(rule=><article key={rule.game_key}><b>{rule.rule_title}</b><span>{rule.rule_text}</span></article>)}
      </div>
      {!currentRules.length?<p className="loc-status">沒有符合的規則。</p>:null}
      <h3>四組簡稱</h3>
      <div className="game-role-grid">
        {data.macros.map(item=><article key={item.code}><b>{item.code}｜{item.title}</b><span>{item.description}</span><small>{item.groupA}＋{item.groupB}</small></article>)}
      </div>
      <h3>回合</h3>
      <div className="game-role-grid">
        {data.rounds.map(item=><article key={item.round}><b>第 {item.round} 回合｜{phaseText(item.phase)}</b><span>{item.text}</span></article>)}
      </div>
    </div>}

    {section==='events'&&<div className="game-doc-copy">
      <h2>{events.length} / {data.events.length} 張事件卡</h2>
      <div className="game-role-grid">
        {events.map(event=><article key={event.id}><b>{event.id}｜{event.name}</b><span>{event.groups.join('＋')}｜{event.requirement}</span><small>{event.description}</small></article>)}
      </div>
      {!events.length?<p className="loc-status">沒有符合的事件。</p>:null}
      <h3>雙群組主視覺</h3>
      <div className="game-event-gallery">{data.eventVisuals.map(item=><EventVisual key={item.code} item={item}/>)}</div>
    </div>}

    {section==='roles'&&<div className="game-doc-copy">
      <h2>八職</h2>
      <div className="game-role-grid">
        {roles.map(role=><article key={role.id}><b>{role.group}｜{role.name}</b><span>{role.focus}｜{role.mode}｜{role.intervention}</span><small>{role.tagline}｜{role.tool}</small></article>)}
      </div>
      {!roles.length?<p className="loc-status">沒有符合的職業。</p>:null}
    </div>}

    {section==='actions'&&<div className="game-doc-copy">
      <h2>{actions.length} / {data.runeActions.length} 符文遊戲行動</h2>
      <div className="game-role-grid">
        {actions.map(action=><article key={action.runeId}><b>{String(action.runeId).padStart(2,'0')}｜{action.name}</b><span>{action.text}</span><small>{action.group}{action.kind?'｜'+action.kind+(action.value!==null?' '+action.value:''):''}</small></article>)}
      </div>
      {!actions.length?<p className="loc-status">沒有符合的符文行動。</p>:null}
    </div>}
  </section>;
}
function BoardPreview({data}){
  const max=data.config.deMax;
  const previewA=Math.min(4,max);
  const previewB=Math.min(3,max);
  return <section className="game-preview-board" aria-label="遊戲盤面預覽">
    <div className="game-preview-player">
      <p className="loc-eyebrow">玩家 A</p>
      <strong>De {previewA} / {max}</strong>
      <DeMeter value={previewA} max={max}/>
      <div className="game-preview-hand">{data.cards.slice(0,5).map(card=><RuneCard key={card.id} card={card} compact/>)}</div>
    </div>
    <div className="game-preview-center">
      <p className="loc-eyebrow">事件區</p>
      <EventVisual item={data.eventVisuals[0]}/>
      <p>{data.events.length} 張事件卡＋雙卡回應</p>
    </div>
    <div className="game-preview-player">
      <p className="loc-eyebrow">玩家 B</p>
      <strong>De {previewB} / {max}</strong>
      <DeMeter value={previewB} max={max}/>
      <div className="game-preview-hand">{data.cards.slice(8,13).map(card=><RuneCard key={card.id} card={card} compact/>)}</div>
    </div>
  </section>;
}

function freshGame(data,count){
  const eventDeck=shuffle(data.events);
  const players=Array.from({length:count},(_,index)=>freshPlayer(data.cards,'玩家 '+NAMES[index],data.config));
  return {
    players,
    eventDeck,
    eventIndex:0,
    round:1,
    phase:'opening',
    active:0,
    actions:0,
    winner:null,
    draw:false,
    cooperations:[],
    lastInteraction:null,
    history:[deSnapshot(players,'開始')],
    logs:['新遊戲開始。'],
    result:'每位玩家先從 '+data.config.openingDraw+' 張起手牌各棄 '+data.config.openingDiscard+' 張，保留 '+data.config.handBase+' 張。'
  };
}

function phaseForRound(data,round){
  return data.rounds.find(item=>item.round===round)?.phase||null;
}

export default function GameView(){
  const {data,error,isLoading}=useAsyncResource(['lrunes','game','current'],loadGameData,{revalidateOnMount:true});


  const [state,setState]=useState(null);
  const [playerCount,setPlayerCount]=useState(2);
  const [homeView,setHomeView]=useState('play');
  const [networkTarget,setNetworkTarget]=useState(null);
  const [focusPlayer,setFocusPlayer]=useState(null);
  const [replayLogIndex,setReplayLogIndex]=useState(null);
  const [gameThemeId,setGameThemeId]=useState(GAME_THEME_DEFAULT);

  const event=state?.eventDeck?.length?state.eventDeck[state.eventIndex%state.eventDeck.length]:null;
  const eventThemeId=GAME_THEME_BY_GROUP[event?.groups?.[0]]||GAME_THEME_DEFAULT;
  const effectiveGameThemeId=gameThemeId===GAME_THEME_AUTO?eventThemeId:gameThemeId;
  // Published CSS provides all 43 palette tokens on the game container, independently
  // of the page's selected theme; only the tiny metadata lookup remains in JS.
  const gameTheme=useMemo(()=>getThemeSlot(effectiveGameThemeId),[effectiveGameThemeId]);
  const allOpened=state?.players.every(player=>!player.opening);
  const phaseLabel=state?.phase==='event'?'事件':state?.phase==='duel'?'決鬥':'共鳴';

  useEffect(()=>{setNetworkTarget(null);},[state?.round,state?.active,state?.phase]);

  const replayLine=Number.isInteger(replayLogIndex)?state?.logs?.[replayLogIndex]||'':'';
  const replayRoundNo=replayRound(replayLine);
  const replayStep=useMemo(()=>{
    if(!replayRoundNo||!state?.history?.length)return '';
    return [...state.history].reverse().find(row=>String(row.step||'').startsWith('R'+replayRoundNo))?.step||'';
  },[replayRoundNo,state?.history]);

  function focusFromReplay(logIndex){
    setReplayLogIndex(logIndex);
    const line=state?.logs?.[logIndex]||'';
    const playerIndex=replayPlayerIndex(line);
    setFocusPlayer(playerIndex>=0?playerIndex:null);
  }

  function focusFromNetwork(playerIndex){
    setNetworkTarget(playerIndex);
    setFocusPlayer(playerIndex);
    setReplayLogIndex(null);
  }

  const status=useMemo(()=>{
    if(error)return '遊戲資料載入失敗：'+error.message;
    if(isLoading)return '正在準備遊戲資料…';
    if(!data)return '遊戲資料尚未就緒。';
    if(!state)return data.cards.length+' 張可玩符文、'+data.events.length+' 張事件卡已就緒。';
    if(state.winner!==null)return state.players[state.winner].name+' 勝出。';
    if(state.draw)return '第 9 回合決鬥仍平分；後續判定待定。';
    return '第 '+state.round+' 回合 · '+phaseLabel;
  },[data,error,isLoading,state,phaseLabel]);

  if(isLoading)return <section className="loc-view loc-game game-shell"><p className="loc-status">{status}</p></section>;
  if(error||!data)return <section className="loc-view loc-game game-shell"><p className="loc-status">{status}</p></section>;

  const playerOptions=Array.from(
    {length:data.config.playerMax-data.config.playerMin+1},
    (_,index)=>data.config.playerMin+index
  );

  function start(){
    const count=Math.max(data.config.playerMin,Math.min(data.config.playerMax,playerCount));
    setState(freshGame(data,count));
  }

  function toggle(pi,id){
    setState(current=>{
      if(!current)return current;
      const players=current.players.map((player,index)=>{
        if(index!==pi)return player;
        const limit=player.opening?data.config.openingDiscard:data.config.eventResponseCards;
        const selected=player.selected.includes(id)
          ?player.selected.filter(value=>value!==id)
          :(player.selected.length<limit?[...player.selected,id]:player.selected);
        return {...player,selected};
      });
      return {...current,players};
    });
  }

  function confirmOpening(pi){
    if(!state||!data)return;
    const player=state.players[pi];
    if(!player?.opening)return;
    if(player.selected.length!==data.config.openingDiscard){
      setState(current=>current?{...current,result:player.name+' 尚需選滿 '+data.config.openingDiscard+' 張棄牌（目前 '+player.selected.length+' 張）。'}:current);
      return;
    }
    try{
      const finished=finishOpening(player,player.selected,data.config);
      const players=state.players.map((item,index)=>index===pi?finished:item);
      const nextPlayer=players.find(item=>item.opening);
      setState({
        ...state,
        players,
        active:nextPlayer?players.indexOf(nextPlayer):0,
        phase:nextPlayer?'opening':(phaseForRound(data,1)||'event'),
        result:nextPlayer
          ?player.name+' 已完成起手。請操作 '+nextPlayer.name+'，選 '+data.config.openingDiscard+' 張棄牌。'
          :'雙方起手完成，進入第 1 回合事件。'
      });
      setFocusPlayer(nextPlayer?players.indexOf(nextPlayer):null);
    }catch(problem){
      setState(current=>current?{...current,result:'起手棄牌失敗：'+problem.message}:current);
    }
  }

  function settleIfFinal(current){
    if(current.round!==data.rounds.length)return current;
    const max=Math.max(...current.players.map(player=>player.de));
    const leaders=current.players.map((player,index)=>player.de===max?index:null).filter(index=>index!==null);
    if(leaders.length===1)return {...current,winner:leaders[0]};
    return {
      ...current,
      round:9,
      phase:'duel',
      duelists:leaders,
      active:leaders[0],
      actions:0,
      result:'第 8 回合平分，進入第 9 回合決鬥。'
    };
  }

  function nextRound(current){
    if(current.round===data.rounds.length)return settleIfFinal(current);
    const round=current.round+1;
    const phase=phaseForRound(data,round);
    return {
      ...current,
      round,
      phase,
      active:0,
      actions:0,
      eventIndex:current.eventIndex+(phase==='event'?1:0)
    };
  }

  function resolveEvent(){
    setState(current=>{
      if(!current||current.phase!=='event'||!event)return current;
      try{
        const outcomes=current.players.map(player=>{
          const chosen=player.hand.filter(card=>player.selected.includes(card.id));
          const outcome=evaluateAlphaEvent(chosen,event,data.resultByCoverage,data.config);
          let next=applyDe(player,outcome.delta,data.config);
          next={
            ...next,
            hand:next.hand.filter(card=>!player.selected.includes(card.id)),
            discard:[...next.discard,...chosen],
            selected:[]
          };
          next=draw(next,outcome.drawCount,data.config);
          return {player:next,outcome};
        });
        const line=outcomes.map((entry,index)=>
          NAMES[index]+' '+entry.outcome.label+' '+entry.outcome.coverageText+' · De '+signed(entry.outcome.delta)
        ).join('｜');
        const players=outcomes.map(entry=>entry.player);
        return nextRound({
          ...current,
          players,
          history:[...(current.history||[]),deSnapshot(players,'R'+current.round+' 事件')],
          logs:['第 '+current.round+' 回合事件：'+line,...current.logs],
          result:line
        });
      }catch(problem){
        return {...current,result:problem.message};
      }
    });
  }

  function resonance(kind,targetIndex=null){
    setState(current=>{
      if(!current||(!current.phase?.includes('resonance')&&current.phase!=='duel'))return current;
      const participants=current.phase==='duel'?(current.duelists||[]):current.players.map((_,index)=>index);
      const actor=current.active;
      const target=kind==='self'?actor:targetIndex;
      if(target===null||target===undefined||!participants.includes(actor)||!participants.includes(target)||(kind!=='self'&&target===actor))return current;

      const delta=kind==='self'?data.config.resonanceSelf:data.config.resonanceAttack;
      const players=current.players.map((player,index)=>index===target?applyDe(player,delta,data.config):player);
      const actions=current.actions+1;
      const actorPosition=participants.indexOf(actor);
      const nextActive=participants[(actorPosition+1)%participants.length];
      const actionText=kind==='self'?signed(delta):'→ '+NAMES[target]+' '+signed(delta);
      const next={
        ...current,
        players,
        actions,
        active:nextActive,
        lastInteraction:{from:actor,to:target,type:kind},
        history:[...(current.history||[]),deSnapshot(players,(current.phase==='duel'?'R9':'R'+current.round)+' '+NAMES[actor])],
        logs:[(current.phase==='duel'?'第 9 回合決鬥':'第 '+current.round+' 回合共鳴')+'：'+NAMES[actor]+' '+actionText,...current.logs]
      };

      if(actions<participants.length)return next;
      if(current.phase==='duel'){
        const max=Math.max(...participants.map(index=>players[index].de));
        const leaders=participants.filter(index=>players[index].de===max);
        if(leaders.length===1)return {...next,winner:leaders[0]};
        return {...next,draw:true,result:'第 9 回合決鬥仍平分；後續判定待定。'};
      }
      return nextRound(next);
    });
  }

  function toggleCooperation(targetIndex){
    setState(current=>{
      if(!current||!current.phase?.includes('resonance'))return current;
      const actor=current.active;
      if(targetIndex===null||targetIndex===undefined||targetIndex===actor)return current;
      const exists=(current.cooperations||[]).some(item=>samePair(item.a,item.b,actor,targetIndex));
      const cooperations=exists
        ?current.cooperations.filter(item=>!samePair(item.a,item.b,actor,targetIndex))
        :[...(current.cooperations||[]),{a:actor,b:targetIndex}];
      return {
        ...current,
        cooperations,
        logs:['第 '+current.round+' 回合合作：'+NAMES[actor]+' 與 '+NAMES[targetIndex]+' '+(exists?'解除合作狀態':'建立合作狀態'),...current.logs]
      };
    });
  }

  const roundBadge=data.rounds.map(item=>phaseMark(item.phase)).join('-');

  if(!state)return <section className="loc-view loc-game game-shell" data-game-theme={gameTheme.id} data-game-scheme={gameTheme.scheme}>
    <header className="loc-hero game-hero game-home-hero">
      <img
        className="game-home-hero-image"
        src={gameHeroAsset.src}
        alt=""
        aria-hidden="true"
        loading="eager"
        fetchPriority="high"
        decoding="async"
      />
      <div className="game-home-hero-overlay" aria-hidden="true"/>
      <div className="game-home-hero-copy">
        <p className="loc-eyebrow">LunaRunes · Game</p>
        <h1>月之符文遊戲</h1>
        <p className="game-hero-lead">這是一套以符文、事件、角色與 De 值變化為核心的卡牌遊戲。選擇玩家人數即可直接開始；完整規則、事件卡、八職與符文行動可從「遊戲文件」查看。</p>
        <div className="game-hero-badges" aria-label="遊戲摘要">
          <span>{data.cards.length} 張符文卡</span>
          <span>{data.config.playerMin}–{data.config.playerMax} 人</span>
          <span>De {data.config.deMin}–{data.config.deMax}</span>
          <span>回合 {roundBadge}</span>
        </div>
        <div className="game-hero-start">
          <label className="game-hero-player-count">
            <span>玩家人數</span>
            <select value={playerCount} onChange={event=>setPlayerCount(Number(event.target.value))}>
              {playerOptions.map(count=><option key={count} value={count}>{count} 人</option>)}
            </select>
          </label>
          <button className="loc-button primary game-hero-start-button" onClick={start}>開始新遊戲</button>
        </div>
        <p className="game-hero-status">{status}｜{data.events.length} 張事件卡 · 66 枚符文行動 · 八種職業</p>
      </div>
    </header>

    <div className="game-theme-row">
      <GameThemeControl value={gameThemeId} onChange={setGameThemeId} effectiveSlot={gameTheme}/>
    </div>

    <div className="game-round-wrap"><RoundRail round={1} rounds={data.rounds}/></div>

    <div className="loc-actions game-home-tabs">
      <button className={'loc-button '+(homeView==='play'?'primary':'')} onClick={()=>setHomeView('play')}>遊戲盤面</button>
      <button className={'loc-button '+(homeView==='docs'?'primary':'')} onClick={()=>setHomeView('docs')}>遊戲文件</button>
    </div>

    {homeView==='docs'?<GameDocs data={data}/>:<>
      <BoardPreview data={data}/>
      <section className="loc-card">
        <p className="loc-eyebrow">事件圖</p>
        <h2>雙群組事件圖</h2>
        <div className="game-event-gallery">{data.eventVisuals.map(item=><EventVisual key={item.code} item={item}/>)}</div>
      </section>
      <section className="loc-card">
        <p className="loc-eyebrow">符文分組</p>
        <h2>八分組</h2>
        <div className="game-group-gallery">
          {data.groupAssets.map(group=><figure key={group.code}><img src={group.path} alt={(group.title||group.group)+'代表圖'} loading="lazy"/><figcaption><b>{group.title||group.group}</b></figcaption></figure>)}
        </div>
      </section>
    </>}
  </section>;

  return <section className="loc-view loc-game game-shell" data-game-theme={gameTheme.id} data-game-scheme={gameTheme.scheme}>
    <header className="loc-hero loc-hero-context game-compact-hero">
      <div><p className="loc-eyebrow">月之符文遊戲</p><h1>月之符文遊戲</h1><p>{status}｜{state.result}</p></div>
      <DeMeter value={Math.max(...state.players.map(player=>player.de))} max={data.config.deMax}/>
    </header>

    <div className="game-theme-row">
      <GameThemeControl value={gameThemeId} onChange={setGameThemeId} effectiveSlot={gameTheme}/>
      {gameThemeId===GAME_THEME_AUTO&&event?<p className="game-player-meta">Event {event.id} · {event.groups.join('＋')} → {gameTheme.label}</p>:null}
    </div>

    <div className="game-round-wrap"><RoundRail round={state.round} rounds={data.rounds}/></div>

    {!allOpened?<p className="loc-status">單人試玩可輪流操作所有玩家。起手設定：每位玩家從 {data.config.openingDraw} 張棄 {data.config.openingDiscard} 張，保留 {data.config.handBase} 張。{state.players.some(player=>player.opening)?'目前待完成：'+state.players.filter(player=>player.opening).map(player=>player.name).join('、')+'。':''}</p>:null}
    {!allOpened?<p className="loc-status" role="status">{state.result}</p>:null}

    <div className={'game-live-board players-'+state.players.length}>
      {state.players.map((player,pi)=>({player,pi})).filter(({player})=>allOpened||player.opening).map(({player,pi})=><section className={'loc-player game-player '+(state.active===pi?'is-turn ':'')+(focusPlayer===pi?'is-focused':'')} key={(allOpened?'play-':'opening-')+player.name}>
        <div className="game-player-head">
          <div><p className="loc-eyebrow">{player.name}</p><strong>{player.de} / {data.config.deMax} De</strong></div>
          <DeMeter value={player.de} max={data.config.deMax}/>
        </div>
        <p className="game-player-meta">手牌 {player.hand.length} · 牌庫 {player.deck.length} · 棄牌 {player.discard.length}</p>
        <div className="game-hand">
          {player.hand.map(card=><RuneCard key={card.id} card={card} selected={player.selected.includes(card.id)} onClick={()=>toggle(pi,card.id)}/>)}
        </div>
        {player.opening?<button type="button" className="loc-button primary" onClick={()=>confirmOpening(pi)} aria-disabled={player.selected.length!==data.config.openingDiscard}>確認 {player.name} 棄 {data.config.openingDiscard} 張（已選 {player.selected.length} 張），保留 {data.config.handBase} 張</button>:null}
      </section>)}

      <AnimatePresence mode="wait">
        {allOpened&&state.phase==='event'?<motion.section key={'event-'+state.round} initial={{opacity:0,y:18}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-18}} className="loc-event game-event-field">
          <p className="loc-eyebrow">第 {state.round} 回合 · 事件</p>
          <EventScene event={event} data={data}/>
          {event?<><h2>{event.id}｜{event.name}</h2><p>{event.description}</p><p className="game-player-meta">條件：{event.requirement}</p><button className="loc-button primary" onClick={resolveEvent} disabled={state.players.some(player=>player.selected.length!==data.config.eventResponseCards)}>{data.config.eventResponseCards} 卡結算事件</button></>:null}
        </motion.section>:null}

        {allOpened&&(state.phase?.includes('resonance')||state.phase==='duel')?<motion.section key={'resonance-'+state.round} initial={{opacity:0,scale:.98}} animate={{opacity:1,scale:1}} exit={{opacity:0,scale:.98}} className="loc-event game-event-field game-resonance-field">
          <p className="loc-eyebrow">{state.phase==='duel'?'第 9 回合 · 決鬥':'第 '+state.round+' 回合 · 共鳴'}</p>
          <h2>{state.phase==='duel'?'決鬥':'共鳴'}</h2>
          <p>輪到 {state.players[state.active].name}{networkTarget!==null&&networkTarget!==state.active?'｜已選 '+state.players[networkTarget].name:''}</p>
          <ResonanceNetwork players={state.players} active={state.active} focusPlayer={focusPlayer} cooperations={state.cooperations||[]} lastInteraction={state.lastInteraction} onSelect={focusFromNetwork} themeKey={gameTheme.id}/>
          <div className="loc-actions">
            <button className="loc-button primary" onClick={()=>resonance('self')}>自我共振 {signed(data.config.resonanceSelf)}</button>
            {networkTarget!==null&&networkTarget!==state.active?<button className="loc-button" onClick={()=>resonance('attack',networkTarget)}>干擾 {state.players[networkTarget].name} {signed(data.config.resonanceAttack)}</button>:null}
            {state.phase!=='duel'&&networkTarget!==null&&networkTarget!==state.active?<button className="loc-button" onClick={()=>toggleCooperation(networkTarget)}>{(state.cooperations||[]).some(item=>samePair(item.a,item.b,state.active,networkTarget))?'解除合作':'建立合作'}</button>:null}
          </div>
          <p className="game-player-meta">合作狀態目前只作互動標記，不改變 De 或既有規則。</p>
        </motion.section>:null}
      </AnimatePresence>
    </div>

    <MatchTrend history={state.history||[]} players={state.players} focusPlayer={focusPlayer} focusStep={replayStep}/>

    <ReplayTimeline logs={state.logs} selectedLogIndex={replayLogIndex} onSelect={focusFromReplay}/>

    <section className="loc-card game-log-card">
      <h2>對局紀錄</h2>
      <div className="game-log">{state.logs.map((line,index)=><motion.button type="button" key={index} className={'game-log-row '+(replayLogIndex===index?'is-replay-selected':'')} onClick={()=>focusFromReplay(index)} animate={{x:replayLogIndex===index?5:0}} transition={{duration:.16}}><span>◈</span>{line}</motion.button>)}</div>
    </section>
  </section>;
}
