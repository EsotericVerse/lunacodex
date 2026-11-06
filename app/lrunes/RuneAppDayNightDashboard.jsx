'use client';

import {useEffect,useMemo,useState} from 'react';
import {Line,LineChart,Tooltip,XAxis,YAxis} from 'recharts';
import {listLocalDailyRunes,listLocalRuneDraws} from './local-rune-sqlite.mjs';
import {buildRuneAppOverview,FOUR_DIRECTIONS} from './rune-app-dashboard.mjs';

function taipeiDate(){
  return new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'});
}
function systemNight(){
  return typeof window!=='undefined'&&window.matchMedia?.('(prefers-color-scheme: dark)').matches===true;
}

export default function RuneAppDayNightDashboard({canReadLocal=false,onSelectDraw}={}){
  const [night,setNight]=useState(false);
  const [rows,setRows]=useState([]);
  const [draws,setDraws]=useState([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [days,setDays]=useState(7);
  useEffect(()=>{
    const media=window.matchMedia?.('(prefers-color-scheme: dark)');
    if(!media)return;
    const listener=()=>setNight(media.matches);
    listener();
    media.addEventListener?.('change',listener);
    return()=>media.removeEventListener?.('change',listener);
  },[]);
  useEffect(()=>{
    let alive=true;
    async function refresh(){
      if(!canReadLocal){setRows([]);setDraws([]);setError('');return;}
      setBusy(true);setError('');
      try{
        const [daily,sessions]=await Promise.all([listLocalDailyRunes(),listLocalRuneDraws()]);
        if(alive){setRows(daily);setDraws(sessions);}
      }catch(cause){if(alive)setError(String(cause?.message||cause));}
      finally{if(alive)setBusy(false);}
    }
    refresh();
    const onChange=()=>{refresh();};
    window.addEventListener('loc-rune-local-changed',onChange);
    return()=>{alive=false;window.removeEventListener('loc-rune-local-changed',onChange);};
  },[canReadLocal]);
  const now=taipeiDate();
  const overview=useMemo(()=>buildRuneAppOverview(rows,now,days),[rows,now,days]);
  const latest=draws[0]||null;
  const latestCard=latest?.cards?.[0]||null;
  const counts=overview?.counts||{};
  const maxCount=Math.max(1,...FOUR_DIRECTIONS.map(key=>counts[key]||0));

  return <section className={'loc-card scope-rune-app-overview'+(night?' is-night':' is-day')} aria-label="月典 App 日夜生活觀測">
    <div className="scope-rune-daynight-head">
      <div><p className="loc-eyebrow">Luna Codex · Daily</p>
        <h2>{night?'夜安，探索者':'早安，探索者'}</h2>
        <p>在月光與日光之間，觀察今日的符文和近期的位向軌跡。</p>
      </div>
      <span className="scope-rune-daynight-orb" aria-label={night?'夜間月光主題':'日間晨光主題'}>{night?'☾':'☼'}</span>
    </div>
    <section className="scope-rune-daynight-today">
      <span className="loc-eyebrow">今日符文 · {now.replaceAll('-','/')}</span>
      <div className="scope-rune-daynight-feature">
        <span className="scope-rune-daynight-sigil">{latestCard?.rune_name||'月'}</span>
        <div>
          <h3>{latestCard?latestCard.rune_name+' · '+latestCard.direction:'今天，從一次抽牌開始'}</h3>
          <p>{latest?('上次保存 '+new Date(latest.created_at).toLocaleDateString('zh-TW')+' · '+latest.draw_key):'選擇抽牌方式，讓今日的符文成為觀察起點。'}</p>
          <p>{latest?.reading||'抽牌可供所有 App 使用者體驗；是否儲存由符文 Scope 權限決定。'}</p>
        </div>
      </div>
    </section>
    <div className="scope-rune-daynight-shortcuts" aria-label="符文與生活快捷入口">
      <button type="button" onClick={()=>onSelectDraw?.('daily')}>今日抽牌</button>
      <button type="button" onClick={()=>onSelectDraw?.('3card')}>三張解讀</button>
      <button type="button" onClick={()=>onSelectDraw?.('5card')}>五張解讀</button>
      <button type="button" onClick={()=>document.getElementById('settings-daily-calendar-title')?.scrollIntoView({behavior:'smooth',block:'start'})}>行事曆</button>
    </div>
    <section className="scope-rune-daynight-trajectory">
      <div className="scope-rune-daynight-section-head">
        <h3>位向與近期軌跡</h3>
        <select className="scope-select" aria-label="月典生活分析區間" value={days} onChange={e=>setDays(Number(e.target.value))}>
          <option value={7}>最近 7 天</option>
          <option value={30}>最近 30 天</option>
          <option value={90}>最近 90 天</option>
        </select>
      </div>
      {canReadLocal?<div>
        {busy?<p className="scope-status">正在讀取本機 SQLite 紀錄…</p>:null}
        {error?<p className="scope-status scope-error" role="alert">本機紀錄讀取失敗：{error}</p>:null}
        <div className="scope-rune-daynight-metrics">
          <div><strong>{overview?.total||0}</strong><span>抽符紀錄</span></div>
          <div><strong>{overview?.daysWithRecord||0}</strong><span>有紀錄的日子</span></div>
          <div><strong>{overview?.tendency||'資料不足'}</strong><span>近期位向傾向</span></div>
        </div>
        <div className="scope-rune-daynight-directions">
          {FOUR_DIRECTIONS.map(direction=><div key={direction}>
            <span>{direction}</span><div className="scope-rune-daynight-track"><span style={{width:((counts[direction]||0)/maxCount*100)+'%'}}/></div><strong>{counts[direction]||0}</strong>
          </div>)}
        </div>
        <p className="scope-rune-daynight-explain">
          順向（正位＋半正位）{overview?.forwardRatio||0}% · 阻向（半逆位＋逆位）{overview?.blockedRatio||0}%。
          {overview?.tendency==='資料不足'?' 至少需要三筆抽符紀錄才顯示傾向。':' '+overview?.tendency+'，僅供觀察，不是事件預測。'}
        </p>
        <div className="scope-rune-daynight-chart" aria-label={'最近'+days+'天抽符次數時間趨勢'}>
          <LineChart responsive style={{width:"100%",height:165}} data={overview?.daily||[]} margin={{top:8,right:8,left:-30,bottom:4}}>
              <XAxis dataKey="label" interval={days===7?0:'preserveStartEnd'} tick={{fontSize:10,fill:'currentColor'}}/>
              <YAxis allowDecimals={false} tick={{fontSize:10,fill:'currentColor'}}/>
              <Tooltip contentStyle={{color:'#17263f'}}/>
              <Line dataKey="count" name="抽取紀錄" type="monotone" stroke="currentColor" strokeWidth={2} dot={days===7} />
            </LineChart>
        </div>
      </div>:<p className="scope-rune-daynight-empty">你可以先體驗抽牌。保存紀錄與專屬趨勢分析僅開放已登入的月之符文 Scope 人員；其他使用者不會建立本機私人紀錄。</p>}
    </section>
  </section>;
}
