'use client';

import {useEffect,useState} from 'react';
import {selectRows} from './db-query.mjs';
import {realMoonPhase} from './model/moon-phase';
import {listRecords,listRuneDrawSlots,putDailyRuneRecord,putRecord,putRuneDrawSlot} from './user-storage';
import {useAccount} from './use-account';
import {lRunes66ColumnString} from '../../zenstack/lrunes-read-model.mjs';

const RUNE_DIRECTIONS=Object.freeze(['正位','半正位','半逆位','逆位']);

function randomIndex(max){
  if(max<=1)return 0;
  if(globalThis.crypto?.getRandomValues){
    const limit=Math.floor(0x100000000/max)*max;
    const value=new Uint32Array(1);
    do globalThis.crypto.getRandomValues(value);while(value[0]>=limit);
    return value[0]%max;
  }
  return Math.floor(Math.random()*max);
}
function drawRuneSession(items,count){
  if(!Number.isInteger(count)||count<0||count>items.length)throw new Error(`無效的抽牌數量：${count}`);
  const pool=[...items],cards=[];
  for(let index=0;index<count;index+=1){
    const pick=randomIndex(pool.length);
    cards.push(pool.splice(pick,1)[0]);
  }
  const directionIndexes=cards.map(()=>randomIndex(4));
  return {cards,directionIndexes,directions:directionIndexes.map(index=>RUNE_DIRECTIONS[index])};
}

function makeRuneDrawId(mode='single'){
  const suffix=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `rune-draw:${mode}:${Date.now()}:${suffix}`;
}

const RUNE_COLUMNS=lRunes66ColumnString('rune_id','rune_name','english_name','group_name','moon_phase','card_attr','rune_description','positive_keywords','negative_keywords','extra_rules','extra_notes');
const CARD_ATTR_LABELS=Object.freeze({1:'正面',2:'中平',3:'負面',4:'未知'});
function cardAttrLabel(value){return CARD_ATTR_LABELS[Number(value)]||'';}
function directionNo(direction){return RUNE_DIRECTIONS.indexOf(direction)+1;}
async function loadDrawCards(pairs,types){
  const ids=[...new Set(pairs.map(item=>Number(item.runeNumber)))];
  const [runeResult,etcResult]=await Promise.all([
    selectRows('silver.runes',{
      columns:RUNE_COLUMNS,
      filters:[{column:'rune_id',operator:'in',value:ids}],
      limit:ids.length,
      offset:0
    }),
    selectRows('silver.runes_etc',{
      columns:'rune_id,dir,type,desc',
      filters:[{column:'type',operator:'in',value:types}],
      orFilter:pairs.map(item=>`and(rune_id.eq.${Number(item.runeNumber)},dir.eq.${Number(item.dir)})`).join(','),
      limit:Math.max(1,pairs.length*types.length),
      offset:0
    })
  ]);
  const map=new Map((runeResult.rows||[]).map(row=>[Number(row.rune_id),{...row,rune_etc:{}}]));
  for(const row of etcResult.rows||[]){
    const rune=map.get(Number(row.rune_id));
    if(!rune)continue;
    rune.rune_etc[row.type]??={};
    rune.rune_etc[row.type][Number(row.dir)]=String(row.desc||'');
  }
  return [...map.values()];
}
function runeEtcText(card,type,direction){
  return String(card?.rune_etc?.[type]?.[directionNo(direction)]||'').trim();
}

const MODES=[
  {key:'single',label:'單卡',count:1,positions:['核心']},
  {key:'2card',label:'雙卡',count:2,positions:['因','果']},
  {key:'3card',label:'三卡',count:3,positions:['源','轉','合']},
  {key:'5card',label:'五卡',count:5,positions:['過去成因 1','過去成因 2','意外變化','現在狀況 1','現在狀況 2']},
  {key:'ow3gs',label:'11卡 OW3gs',count:11,positions:['1','2','3','4','5','6','7','8','9','10','11']}
];

function directionText(card,direction){
  return runeEtcText(card,'direction',direction)||String(card?.rune_description||'').trim();
}
function dailyGuidance(card,direction){
  return runeEtcText(card,'daily',direction);
}
function cleanGrammarPart(value){
  return String(value||'').trim().replace(/[。；;，,\s]+$/g,'')||'資訊不足';
}
function composeFixedGrammar(values,mode){
  const parts=(values||[]).map(cleanGrammarPart);
  if(mode==='2card'&&parts.length>=2)return `因為${parts[0]}，所以${parts[1]}。`;
  if(mode==='3card'&&parts.length>=3)return `因為${parts[0]}，但會有${parts[1]}的改變，所以${parts[2]}。`;
  if(mode==='5card'&&parts.length>=5)return `因為${parts[0]}、${parts[1]}，但會有${parts[2]}的變化，所以${parts[3]}、${parts[4]}。`;
  if(mode==='ow3gs'&&parts.length>=11)return `因為（因為${parts[0]}、${parts[1]}，但會有${parts[2]}、${parts[3]}的變化，所以${parts[4]}、${parts[5]}），所以（因為${parts[6]}、${parts[7]}，但會有${parts[8]}的變化，所以${parts[9]}、${parts[10]}）。`;
  if(parts.length===1)return `${parts[0]}。`;
  return parts.length?`${parts.join('、')}。`:'資訊不足。';
}
async function resolvedSession(pool,count,types){
  const raw=drawRuneSession(pool,count);
  const pairs=raw.cards.map((runeNumber,index)=>({runeNumber:Number(runeNumber),dir:Number(raw.directionIndexes[index])+1}));
  const rows=await loadDrawCards(pairs,types);
  const byNumber=new Map(rows.map(row=>[Number(row.rune_id),row]));
  const cards=raw.cards.map(number=>byNumber.get(Number(number))).filter(Boolean);
  if(cards.length!==raw.cards.length)throw new Error('抽中的符文資料不完整。');
  return {...raw,cards};
}

function todayKey(){
  const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
}
function makeRecord(mode,session){
  const config=MODES.find(item=>item.key===mode)||MODES[0];
  const guidance=composeFixedGrammar(session.cards.map((card,index)=>directionText(card,session.directions[index])),mode);
  return {
    id:makeRuneDrawId(mode),created_at:new Date().toISOString(),mode,mode_label:config.label,
    moon_phase:realMoonPhase(),trend:null,result:null,guidance,
    cards:session.cards.map((card,index)=>({
      number:Number(card.rune_id),name:card.rune_name,
      position:config.positions[index]||`第 ${index+1} 張`,
      direction:session.directions[index],
      card_attribute:cardAttrLabel(card.card_attr),
      state:'',
      positive_keywords:card.positive_keywords||'',negative_keywords:card.negative_keywords||''
    }))
  };
}
function dailyRecord(session,role){
  const card=session.cards[0];
  const direction=session.directions[0];
  return {
    id:makeRuneDrawId('daily'),created_at:new Date().toISOString(),mode:'daily',mode_label:'每日',
    moon_phase:realMoonPhase(),daily_role:role,
    trend:null,result:null,guidance:dailyGuidance(card,direction)||directionText(card,direction),
    cards:[{number:Number(card.rune_id),name:card.rune_name,position:role==='supplement'?'副符':'主符',direction,card_attribute:cardAttrLabel(card.card_attr),state:'',positive_keywords:card.positive_keywords||'',negative_keywords:card.negative_keywords||''}]
  };
}
function cardLine(record){
  return (record?.cards||[]).map(card=>`${card.position}・${card.name}・${card.direction}`).join(' ｜ ');
}

export default function RuneManagementPanel(){
  const account=useAccount();
  const [runes,setRunes]=useState([]);
  const [mode,setMode]=useState('single');
  const [draw,setDraw]=useState(null);
  const [slot,setSlot]=useState(1);
  const [slots,setSlots]=useState([]);
  const [dailyRows,setDailyRows]=useState([]);
  const [dailyMain,setDailyMain]=useState(null);
  const [dailySupplement,setDailySupplement]=useState(null);
  const [status,setStatus]=useState('');
  const [loading,setLoading]=useState(true);
  const canManage=account.canLocAccessSync('scope','lrunes');

  async function reloadRecords(){
    const today=todayKey();
    const [slotRows,records]=await Promise.all([
      listRuneDrawSlots(),
      listRecords('rune-draw',{recordKind:'daily',recordDate:today,limit:2})
    ]);
    setSlots(slotRows);
    setDailyRows(records);
  }
  useEffect(()=>{
    let live=true;
    if(!account.user||!canManage){setLoading(false);return()=>{live=false};}
    Promise.all([selectRows('silver.runes',{columns:lRunes66ColumnString('rune_id','rune_name','card_attr','positive_keywords','negative_keywords'),orders:[{column:'rune_id',ascending:true}],limit:67,offset:0}),reloadRecords()])
      .then(([result])=>{if(live)setRunes((result.rows||[]).filter(row=>Number(row?.rune_id)>=1&&Number(row?.rune_id)<=66));})
      .catch(error=>{if(live)setStatus(String(error?.message||error));})
      .finally(()=>{if(live)setLoading(false);});
    return()=>{live=false};
  },[account.user?.email,canManage]);

  const config=MODES.find(item=>item.key===mode)||MODES[0];
  const savedMain=dailyRows.find(row=>row.daily_role==='main');
  const savedSupplement=dailyRows.find(row=>row.daily_role==='supplement');

  async function drawGroup(){
    try{
      const pool=Array.from({length:66},(_,index)=>index+1);
      setDraw(makeRecord(mode,await resolvedSession(pool,config.count,['direction','lots'])));setStatus('');
    }catch(error){setStatus(error?.message||'抽牌失敗。');}
  }
  async function saveSlot(){
    if(!draw)return;
    try{
      const saved=await putRuneDrawSlot(slot,draw);
      // The write already returns the saved row; patch the one matching slot
      // locally instead of re-fetching all 8 slots + today's daily rows.
      setSlots(current=>current.map(item=>item.slot===slot?{...item,record:saved}:item));
      setStatus(`第 ${slot} 組已更新；舊內容已覆蓋。`);
    }
    catch(error){setStatus(error?.message||'儲存失敗。');}
  }
  async function drawDailyMain(){
    try{
      const pool=Array.from({length:66},(_,index)=>index+1);
      setDailyMain(dailyRecord(await resolvedSession(pool,1,['direction','daily']),'main'));setDailySupplement(null);setStatus('');
    }catch(error){setStatus(error?.message||'抽牌失敗。');}
  }
  async function drawDailySupplement(){
    try{
      const mainNumber=Number((savedMain||dailyMain)?.cards?.[0]?.number);
      const pool=Array.from({length:66},(_,index)=>index+1).filter(number=>number!==mainNumber);
      setDailySupplement(dailyRecord(await resolvedSession(pool,1,['direction','daily']),'supplement'));setStatus('');
    }catch(error){setStatus(error?.message||'副符抽牌失敗。');}
  }
  async function saveDaily(record){
    try{
      const saved=await putDailyRuneRecord(record);
      setDailyRows(current=>[...current.filter(row=>row.id!==saved.id),saved]);
      setStatus(record.daily_role==='supplement'?'副符已儲存。':'主符已儲存。');
    }
    catch(error){setStatus(error?.message||'每日符文儲存失敗。');}
  }
  async function updateDaily(row,field,value){
    const current=row.cards?.[0]||{};
    const nextCard={...current};
    if(field==='number')nextCard.number=Number(value);
    else nextCard.direction=value;
    try{
      const dir=RUNE_DIRECTIONS.indexOf(nextCard.direction)+1;
      const [resolved]=await loadDrawCards([{runeNumber:Number(nextCard.number),dir}],['direction','daily']);
      if(!resolved)throw new Error('符文資料不存在。');
      nextCard.name=resolved.rune_name||String(nextCard.number);
      nextCard.card_attribute=cardAttrLabel(resolved.card_attr);
      nextCard.state='';
      const saved=await putRecord({...row,trend:null,result:null,guidance:dailyGuidance(resolved,nextCard.direction)||directionText(resolved,nextCard.direction),cards:[nextCard]});
      setDailyRows(current=>current.map(item=>item.id===saved.id?saved:item));
      setStatus('每日符文紀錄已更新。');
    }catch(error){setStatus(error?.message||'更新失敗。');}
  }

  if(!canManage)return null;
  if(loading)return <section className="scope-inline-card"><h3>每日符文與抽牌紀錄</h3><p>正在讀取…</p></section>;

  return <section className="scope-inline-card">
    <h3>抽牌與 8 組儲存槽</h3>
    <p>每次 Draw Session 算一組；11 卡 OW3gs 也只占一組。儲存到相同槽位時直接覆蓋舊組。</p>
    <div className="scope-tabs">
      {MODES.map(item=><button type="button" key={item.key} aria-pressed={mode===item.key} onClick={()=>setMode(item.key)}>{item.label}</button>)}
      <button type="button" onClick={drawGroup}>抽牌</button>
    </div>
    {draw?<article className="loc-card"><strong>{draw.mode_label}</strong><p>{cardLine(draw)}</p><p>{draw.guidance}</p>
      <div className="scope-stat-controls">
        <label>儲存到<select value={slot} onChange={e=>setSlot(Number(e.target.value))}>{Array.from({length:8},(_,i)=><option key={i+1} value={i+1}>第 {i+1} 組</option>)}</select></label>
        <button type="button" onClick={saveSlot}>覆蓋／儲存這一組</button>
      </div>
    </article>:null}
    <div className="scope-context-list">
      {slots.map(item=><article className="scope-inline-card" key={item.slot}><strong>第 {item.slot} 組</strong><p>{item.record?cardLine(item.record):'尚未儲存'}</p></article>)}
    </div>

    <hr/>
    <h3>每日符文</h3>
    <p>一天最多兩筆正式紀錄：主符 Main + 副符 Supplement。副符只補充主符；兩筆都存在後不再新增，只能編輯既有紀錄。</p>
    {!savedMain?<div className="loc-actions"><button type="button" onClick={drawDailyMain}>抽主符</button>{dailyMain?<button type="button" onClick={()=>saveDaily(dailyMain)}>儲存主符</button>:null}</div>:null}
    {(savedMain||dailyMain)&&!savedSupplement?<div className="loc-actions"><button type="button" onClick={drawDailySupplement}>抽副符</button>{dailySupplement?<button type="button" onClick={()=>saveDaily(dailySupplement)}>儲存副符</button>:null}</div>:null}
    {dailyMain&&!savedMain?<p>待存主符：{cardLine(dailyMain)}</p>:null}
    {dailySupplement&&!savedSupplement?<p>待存副符：{cardLine(dailySupplement)}</p>:null}

    <div className="scope-context-list">
      {dailyRows.map(row=>{
        const card=row.cards?.[0]||{};
        return <article className="scope-inline-card" key={row.id}>
          <strong>{row.daily_role==='supplement'?'副符':'主符'}｜{card.name}・{card.direction}</strong>
          <div className="scope-stat-controls">
            <label>符文<select value={card.number||''} onChange={e=>updateDaily(row,'number',e.target.value)}>
              {runes.map(rune=><option key={rune.rune_id} value={rune.rune_id}>{rune.rune_id}・{rune.rune_name}</option>)}
            </select></label>
            <label>方向<select value={card.direction||'正位'} onChange={e=>updateDaily(row,'direction',e.target.value)}>
              {RUNE_DIRECTIONS.map(direction=><option key={direction} value={direction}>{direction}</option>)}
            </select></label>
          </div>
        </article>;
      })}
    </div>
    {status?<p className="scope-status">{status}</p>:null}
  </section>;
}
