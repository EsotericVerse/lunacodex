'use client';

import {useEffect,useMemo,useRef,useState} from 'react';
import {produce} from 'immer';
import {tabletopSocketUrl} from './tabletop-socket.mjs';
import {createLunaRunesGame} from './boardgame-rules.js';
import {validState,packTabletopState,unpackTabletopState} from './tabletop-state.mjs';

const topic=code=>'lrunes:tabletop:'+code;
function actionEffect(state,move,args,rules){
  if(move==='resonance'){
    const card=rules.cards.find(c=>c.englishName==='Resonance');
    return card?{kind:'rune',card}:{kind:'resonance'};
  }
  let card;
  if(move==='toggleCard'){
    const [player,id]=args;
    const p=state.players[player];
    if(!p||p.selected.includes(id))return null;
    card=p.hand.find(c=>c.id===id);
  }else if(move==='confirmOpening'){
    const p=state.players[args[0]];
    card=p?.hand.find(c=>p.selected.includes(c.id));
  }else if(move==='resolveEvent'){
    const p=state.players.find(p=>p.selected.length);
    card=p?.hand.find(c=>p.selected.includes(c.id));
  }
  return card?{kind:'rune',card,appearance:move==='toggleCard'?'glyph':'card'}:null;
}

/**
 * Ephemeral, shared tabletop. One room creator serializes valid moves.
 * Everyone with the invitation code may operate any player; no referee or accounts.
 * No DB writes or permanent save; the creator must remain online.
 */
export function useOnlineTabletop({data,count,code,host,hostKey=''}){
  const game=useMemo(()=>createLunaRunesGame(data,count),[data,count]);
  const [G,setG]=useState(null);
  const [online,setOnline]=useState(false);
  const [members,setMembers]=useState([]);
  const [error,setError]=useState('');
  const [remoteEffect,setRemoteEffect]=useState(null);
  const memberId=useRef(null);
  if(!memberId.current)memberId.current=crypto.randomUUID();
  const Gref=useRef(null);
  const revision=useRef(0);
  const channelRef=useRef(null);
  const applyRef=useRef(null);
  const connectedRef=useRef(false);

  useEffect(()=>{
    let active=true,socket=null,reconnect=null,attempt=0;
    const report=reason=>{if(active)setError(String(reason?.message||reason||'房間連線失敗'))};
    const send=(type,payload={})=>{
      if(socket?.readyState!==WebSocket.OPEN)return false;
      try{socket.send(JSON.stringify({type,payload}));return true}
      catch(error){report(error);return false}
    };
    const publish=(origin,effect=null)=>{
      if(Gref.current)send('state',{
        state:packTabletopState(Gref.current),revision:revision.current,origin,effect
      });
    };
    const apply=(move,args,origin,expected)=>{
      const state=Gref.current;
      if(!connectedRef.current||!state||!Object.hasOwn(game.moves,move)||!Array.isArray(args))return;
      if(expected&&(expected.round!==state.round||expected.stage!==state.stage))return;
      const effect=actionEffect(state,move,args,data);
      const next=produce(state,draft=>game.moves[move]({G:draft},...args));
      if(next===state)return;
      Gref.current=next;
      revision.current+=1;
      setG(next);
      publish(origin,effect);
      if(origin!==memberId.current&&effect)setRemoteEffect({...effect,revision:revision.current});
    };
    applyRef.current=apply;
    function connect(){
      if(!active)return;
      let url;
      try{url=tabletopSocketUrl({code,member:memberId.current,host,hostKey})}
      catch(error){report(error);return}
      socket=new WebSocket(url);
      channelRef.current=socket;
      socket.onopen=()=>{
        if(!active)return;
        attempt=0;
        connectedRef.current=true;
        setOnline(true);setError('');
        send('request-state');
        if(host)publish(memberId.current);
      };
      socket.onmessage=event=>{
        if(!active)return;
        let packet;try{packet=JSON.parse(event.data)}catch{return}
        const {type,payload}=packet||{};
        if(type==='presence'&&Array.isArray(packet.members)){
          setMembers(packet.members);
        }else if(type==='move'&&host&&payload?.origin&&typeof payload.move==='string'){
          apply(payload.move,payload.args,payload.origin,payload.expected);
        }else if(type==='state'&&payload&&(!host||!Gref.current)&&
          validState(payload.state)&&Number.isInteger(payload.revision)&&
          payload.revision>=revision.current){
          const next=unpackTabletopState(payload.state,data.cards);
          if(!next)return;
          Gref.current=next;
          revision.current=payload.revision;
          setG(next);
          if(payload.effect&&payload.origin!==memberId.current)
            setRemoteEffect({...payload.effect,revision:payload.revision});
        }else if(type==='error')report(packet.message||'房間操作遭拒絕');
      };
      socket.onclose=event=>{
        if(!active)return;
        connectedRef.current=false;setOnline(false);setMembers([]);
        if(event.code===1008||event.code===1009||event.code===4403){
          report('房間連線遭拒絕，請重新建立或檢查邀請連結');return;
        }
        report('房間連線中斷，正在重新連線');
        reconnect=setTimeout(connect,Math.min(15000,1000*2**Math.min(attempt++,4)));
      };
      socket.onerror=()=>{if(active)setError('網路或 LOC 房間服務暫時無法連線')};
    }
    connect();
    return ()=>{
      active=false;
      if(reconnect)clearTimeout(reconnect);
      connectedRef.current=false;
      applyRef.current=null;
      channelRef.current=null;
      socket?.close(1000,'Room left');
    };
  },[code,host,hostKey,game,data]);

  const start=()=>{
    if(!host||!connectedRef.current||Gref.current)return;
    const state=game.setup();
    Gref.current=state;
    revision.current+=1;
    setG(state);
    try{channelRef.current?.send(JSON.stringify({type:'state',payload:{
      state:packTabletopState(state),revision:revision.current,origin:memberId.current
    }}))}catch(error){setError(String(error?.message||error))}
  };
  const moves=useMemo(()=>Object.fromEntries(Object.keys(game.moves).map(move=>[
    move,(...args)=>{
      if(!connectedRef.current||!Gref.current)return;
      if(host)applyRef.current?.(move,args,memberId.current,null);
      else try{
        channelRef.current?.send(JSON.stringify({type:'move',payload:{
          move,args,origin:memberId.current,
          expected:{round:Gref.current.round,stage:Gref.current.stage}
        }}));
      }catch(error){setError(String(error?.message||error))}
    }
  ])),[game,host]);

  return {G,moves,start,online,members,error,remoteEffect,hostOnline:host||members.some(m=>m.role==='host')};
}
