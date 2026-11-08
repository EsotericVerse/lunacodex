// Per-device Rune records use the browser's native IndexedDB facility.
// This is not a SQL engine and does not select or hold remote SQL credentials.
const NAME='loc-lrunes-device-records-v1';
const VERSION=1;
const DIRECTION_VALUES=new Set(['正位','半正位','半逆位','逆位']);
const DRAW_MODES=new Set(['single','daily','2card','3card','4card','5card','6card','7card','8card','9card','10card','ow3gs']);
const DAILY_KINDS=new Set(['main','supplement','history_1','history_2']);
const MAX_IMPORT_ROWS=50000;
function openDatabase(){
  if(typeof indexedDB==='undefined')
    return Promise.reject(new Error('此裝置不支援本機 IndexedDB 紀錄。'));
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(NAME,VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains('draws'))
        db.createObjectStore('draws',{keyPath:'draw_id'});
      if(!db.objectStoreNames.contains('daily'))
        db.createObjectStore('daily',{keyPath:['record_date','draw_kind']});
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('無法開啟本機符文紀錄。'));
  });
}
async function transact(stores,mode,work){
  const db=await openDatabase();
  return new Promise((resolve,reject)=>{
    let value,failed=null,finished=false;
    const tx=db.transaction(stores,mode);
    const close=()=>{if(!finished){finished=true;db.close();}};
    tx.oncomplete=()=>{close();resolve(value);};
    tx.onabort=()=>{close();reject(failed||tx.error||new Error('本機紀錄交易取消。'));};
    tx.onerror=()=>{ /* onabort supplies the transaction error */ };
    const fail=error=>{
      failed=error instanceof Error?error:new Error(String(error));
      try{tx.abort();}catch{close();reject(failed);}
    };
    try{work(tx,next=>{value=next;},fail);}catch(error){fail(error);}
  });
}
function validateDaily(input){
  const record_date=String(input?.record_date||'').slice(0,10);
  const draw_kind=String(input?.draw_kind||'');
  const rune_number=Number(input?.rune_number);
  const direction=String(input?.direction||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(record_date)||!DAILY_KINDS.has(draw_kind)||
      !Number.isInteger(rune_number)||rune_number<1||rune_number>66||
      !DIRECTION_VALUES.has(direction))throw new Error('每日符文紀錄的日期、種類、符文或位向不正確。');
  return {record_date,draw_kind,rune_number,direction,
    recorded_phase:String(input?.recorded_phase||'').slice(0,50),
    source:String(input?.source||'local').slice(0,24)};
}
function validateDraw(input){
  const draw_id=String(input?.draw_id||'').trim();
  const draw_key=String(input?.draw_key||'');
  const created_at=String(input?.created_at||'');
  const reading=String(input?.reading||'');
  const cards_json=String(input?.cards_json||'');
  let cards;
  try{cards=JSON.parse(cards_json);}catch{throw new Error('抽牌卡片資料格式錯誤。');}
  if(!draw_id||draw_id.length>200||!DRAW_MODES.has(draw_key)||
      !/^\d{4}-\d{2}-\d{2}T/.test(created_at)||
      reading.length>20000||cards_json.length>20000||
      !Array.isArray(cards)||!cards.length||cards.length>11||
      cards.some(card=>!Number.isInteger(Number(card.rune_number))||
        Number(card.rune_number)<1||Number(card.rune_number)>66||
        !DIRECTION_VALUES.has(card.direction)))
    throw new Error('抽牌紀錄格式不符合 LunaRunes 規格。');
  return {draw_id,draw_key,created_at,
    moon_phase:String(input?.moon_phase||'').slice(0,50),
    cards_json:JSON.stringify(cards),reading};
}
export async function listLocalRuneDraws(){
  const rows=await transact(['draws'],'readonly',(tx,set)=>{
    const req=tx.objectStore('draws').getAll();
    req.onsuccess=()=>set(req.result||[]);
  });
  return (rows||[]).sort((a,b)=>b.created_at.localeCompare(a.created_at))
    .slice(0,100).map(row=>({...row,cards:JSON.parse(row.cards_json)}));
}
export async function listLocalDailyRunes(){
  const rows=await transact(['daily'],'readonly',(tx,set)=>{
    const req=tx.objectStore('daily').getAll();
    req.onsuccess=()=>set(req.result||[]);
  });
  return (rows||[]).sort((a,b)=>a.record_date.localeCompare(b.record_date)||
    a.draw_kind.localeCompare(b.draw_kind));
}
export async function saveLocalRuneDraw(draw,mode,moonPhase){
  const cards=(draw?.cards||[]).map((card,index)=>({
    rune_number:Number(card.rune_id),rune_name:String(card.rune_name||''),
    direction:String(draw?.directions?.[index]||'')
  }));
  const row=validateDraw({
    draw_id:draw?.id,draw_key:mode,created_at:draw?.createdAt,
    moon_phase:moonPhase,cards_json:JSON.stringify(cards),
    reading:draw?.reading?.sentence
  });
  const daily=mode==='daily'?validateDaily({
    record_date:new Date(draw.createdAt).toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'}),
    draw_kind:'main',rune_number:cards[0]?.rune_number,direction:cards[0]?.direction,
    recorded_phase:moonPhase,source:'local'
  }):null;
  return transact(['draws','daily'],'readwrite',(tx,set,fail)=>{
    const draws=tx.objectStore('draws'),dates=tx.objectStore('daily');
    const check=draws.get(row.draw_id);
    check.onsuccess=()=>{
      if(check.result)return fail(new Error('這次抽牌已經儲存，不會重複新增。'));
      draws.add(row);set(1);
      if(!daily)return;
      const main=dates.get([daily.record_date,'main']);
      main.onsuccess=()=>{
        if(!main.result)dates.add(daily);
        else{
          const supplement=dates.get([daily.record_date,'supplement']);
          supplement.onsuccess=()=>{
            if(!supplement.result)dates.add({...daily,draw_kind:'supplement'});
          };
        }
      };
    };
  });
}
export async function importLocalDailyTransfer(input){
  if(!Array.isArray(input)||input.length>MAX_IMPORT_ROWS)
    throw new Error('每日符文匯入資料超過 50,000 筆上限。');
  const rows=input.map(row=>validateDaily({...row,source:'imported'}));
  const seen=new Set();
  for(const row of rows){
    const key=row.record_date+'|'+row.draw_kind;
    if(seen.has(key))throw new Error('來源內有重複每日紀錄：'+key);
    seen.add(key);
  }
  return transact(['daily'],'readwrite',(tx,set,fail)=>{
    const store=tx.objectStore('daily'),read=store.getAll();
    read.onsuccess=()=>{
      const current=new Map((read.result||[])
        .map(row=>[row.record_date+'|'+row.draw_kind,row]));
      const fresh=[],conflicts=[];let identical=0;
      for(const row of rows){
        const key=row.record_date+'|'+row.draw_kind,old=current.get(key);
        if(!old){fresh.push(row);continue;}
        if(Number(old.rune_number)===row.rune_number&&
           old.direction===row.direction&&
           String(old.recorded_phase||'')===row.recorded_phase)identical++;
        else conflicts.push(key);
      }
      for(const row of fresh)store.add(row);
      set({newCount:fresh.length,duplicateCount:identical,
        conflictCount:conflicts.length,conflicts});
    };
  });
}
export async function updateLocalDailyRune({recordDate,drawKind,runeNumber,direction}={}){
  const patch=validateDaily({record_date:recordDate,draw_kind:drawKind,
    rune_number:Number(runeNumber),direction});
  return transact(['daily'],'readwrite',(tx,set,fail)=>{
    const store=tx.objectStore('daily'),req=store.get([patch.record_date,patch.draw_kind]);
    req.onsuccess=()=>{
      if(!req.result)return fail(new Error('本機沒有這筆每日紀錄。'));
      store.put({...req.result,rune_number:patch.rune_number,direction:patch.direction});
      set(true);
    };
  });
}
export async function deleteLocalDailyRune({recordDate,drawKind}={}){
  const date=String(recordDate||''),kind=String(drawKind||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!DAILY_KINDS.has(kind))
    throw new Error('每日符文日期或類別不正確。');
  return transact(['daily'],'readwrite',(tx,set,fail)=>{
    const store=tx.objectStore('daily'),req=store.get([date,kind]);
    req.onsuccess=()=>{
      if(!req.result)return fail(new Error('本機沒有這筆每日紀錄。'));
      store.delete([date,kind]);set(true);
    };
  });
}
