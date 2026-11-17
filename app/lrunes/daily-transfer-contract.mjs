// Daily rune portable format shared by iOS native and website. No implicit correction.
import {MAX_ROWS,MAX_DAILY_TRANSFER_BYTES} from '../loc/query/query-batch-size.mjs';
export const DAILY_TRANSFER_FORMAT='loc.lrunes.daily.v1';
export const DAILY_TRANSFER_MAX_BYTES=MAX_DAILY_TRANSFER_BYTES;
export {MAX_ROWS as DAILY_TRANSFER_BATCH};
const KINDS=new Set(['main','supplement','history_1','history_2']);
const DIRECTIONS=new Set(['正位','半正位','半逆位','逆位']);
export const dailyTransferKey=row=>row.record_date+'|'+row.draw_kind;
const isDate=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const d=new Date(value+'T00:00:00Z');
  return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;
};
export function normalizeDailyTransferRow(source){
  const r=source&&typeof source==='object'&&!Array.isArray(source)?source:{};
  const record_date=r.record_date;
  const draw_kind=r.draw_kind;
  const rune_number=r.rune_number;
  const direction=r.direction;
  if(!isDate(record_date)||!KINDS.has(draw_kind)||!Number.isInteger(rune_number)||
    rune_number<1||rune_number>66||!DIRECTIONS.has(direction))
    throw new Error('每日符文日期、類別、符文編號或位向無效；原始資料沒有修改。');
  const phase=r.recorded_phase==null?'':r.recorded_phase;
  if(typeof phase!=='string'||phase.length>70)throw new Error('月相欄位不符合規格。');
  return {record_date,draw_kind,rune_number,direction,recorded_phase:phase};
}
export function makeDailyTransfer(rows){
  const normalized=rows.map(normalizeDailyTransferRow);
  const keys=new Set();
  for(const r of normalized){const key=dailyTransferKey(r);if(keys.has(key))throw new Error('來源資料具有相同日期與類別的重複紀錄：'+key);keys.add(key);}
  return {format:DAILY_TRANSFER_FORMAT,exported_at:new Date().toISOString(),records:normalized};
}
export function parseDailyTransfer(data){
  const parsed=typeof data==='string'?JSON.parse(data):data;
  if(!parsed||parsed.format!==DAILY_TRANSFER_FORMAT||!Array.isArray(parsed.records))
    throw new Error('只接受 LunaRunes 每日符文 v1 備份，不猜測其他 JSON。');
  if(parsed.records.length>50000)throw new Error('來源資料超過 50,000 筆，拒絕一次匯入。');
  return makeDailyTransfer(parsed.records).records;
}
export function planDailyTransfer(incoming,existing){
  const seen=new Map(existing.map(row=>[dailyTransferKey(row),normalizeDailyTransferRow(row)]));
  const fresh=[],conflicts=[],identical=[];
  for(const row of incoming.map(normalizeDailyTransferRow)){
    const key=dailyTransferKey(row),prev=seen.get(key);
    if(!prev){fresh.push(row);continue;}
    if(prev.rune_number===row.rune_number&&prev.direction===row.direction&&prev.recorded_phase===row.recorded_phase)
      identical.push(row);
    else conflicts.push({key,existing:prev,incoming:row});
  }
  return {total:incoming.length,newCount:fresh.length,duplicateCount:identical.length,
    conflictCount:conflicts.length,batches:Math.ceil(fresh.length/MAX_ROWS),
    fresh,conflicts};
}

// Any table the universal import module can read (csv/tsv/xlsx/ods/json...) is
// mapped onto the same strict row contract; headers are matched by alias only,
// values are never guessed beyond the documented kind / date spellings.
const DAILY_ALIASES=Object.freeze({
  record_date:['record_date','date','日期','紀錄日期','記錄日期'],
  draw_kind:['draw_kind','kind','type','類別','種類','抽牌種類'],
  rune_number:['rune_number','rune_id','rune','number','符文編號','編號','符文'],
  direction:['direction','位向','方向','牌位'],
  recorded_phase:['recorded_phase','phase','moon_phase','月相','紀錄月相']
});
const KIND_WORDS=Object.freeze({
  main:'main',主抽:'main',主:'main',
  supplement:'supplement',補抽:'supplement',補:'supplement',
  history_1:'history_1',歷史1:'history_1',
  history_2:'history_2',歷史2:'history_2'
});
function pick(row,field,fieldMap={}){
  const custom=String(fieldMap?.[field]||'').trim();
  if(custom&&Object.prototype.hasOwnProperty.call(row,custom))return row[custom];
  const wanted=DAILY_ALIASES[field];
  for(const key of Object.keys(row)){
    if(wanted.includes(String(key).replace(/^\uFEFF/,'').trim().toLowerCase()))return row[key];
  }
  return undefined;
}
function toDate(value){
  const text=String(value??'').trim();
  const match=text.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if(!match)return text;
  return match[1]+'-'+match[2].padStart(2,'0')+'-'+match[3].padStart(2,'0');
}
export const DAILY_IMPORT_FIELDS=Object.freeze(Object.keys(DAILY_ALIASES));
export const DAILY_IMPORT_FIELD_LABELS=Object.freeze({
  record_date:'日期',draw_kind:'種類',rune_number:'符文編號',direction:'位向',recorded_phase:'月相'
});
export const DAILY_IMPORT_ALIASES=DAILY_ALIASES;
// Row-by-row analysis in the same valid / skipped shape the management import
// preview uses: a bad row is skipped with its reason, never silently corrected.
export function analyzeDailyImport(list,fieldMap={}){
  if(!Array.isArray(list)||!list.length)throw new Error('沒有可匯入的資料列。');
  if(list.length>50000)throw new Error('來源資料超過 50,000 筆，拒絕一次匯入。');
  const valid=[],invalid=[],seen=new Set();
  list.forEach((source,index)=>{
    const row=source&&typeof source==='object'&&!Array.isArray(source)?source:{};
    try{
      if(pick(row,'record_date',fieldMap)===undefined||pick(row,'rune_number',fieldMap)===undefined||pick(row,'direction',fieldMap)===undefined)
        throw new Error('缺少必要欄位（日期、符文編號、位向）');
      const kindRaw=pick(row,'draw_kind',fieldMap);
      const kind=kindRaw===undefined||String(kindRaw).trim()===''?'main':KIND_WORDS[String(kindRaw).trim().toLowerCase()]||String(kindRaw).trim();
      const phase=pick(row,'recorded_phase',fieldMap);
      const record=normalizeDailyTransferRow({
        record_date:toDate(pick(row,'record_date',fieldMap)),
        draw_kind:kind,
        rune_number:Number(String(pick(row,'rune_number',fieldMap)).trim()),
        direction:String(pick(row,'direction',fieldMap)).trim(),
        recorded_phase:phase==null?'':String(phase).trim()
      });
      const key=dailyTransferKey(record);
      if(seen.has(key))throw new Error('檔案內重複的日期與種類 '+key);
      seen.add(key);
      valid.push(record);
    }catch(error){invalid.push({index:index+1,error:'第 '+(index+1)+' 列：'+String(error?.message||error)});}
  });
  return {valid,invalid};
}

// Daily-rune CSV is our own fixed format, so it has its own tiny RFC 4180 reader
// (quoted cells, doubled quotes, CRLF) -- no document parser module involved.
export function parseDailyCsv(text){
  const source=String(text||'').replace(/^\uFEFF/,'');
  const rows=[];
  let row=[],cell='',quoted=false;
  for(let i=0;i<source.length;i++){
    const ch=source[i];
    if(quoted){
      if(ch==='"'){
        if(source[i+1]==='"'){cell+='"';i++;}else quoted=false;
      }else cell+=ch;
    }else if(ch==='"')quoted=true;
    else if(ch===','){row.push(cell);cell='';}
    else if(ch==='\n'||ch==='\r'){
      if(ch==='\r'&&source[i+1]==='\n')i++;
      row.push(cell);cell='';
      if(row.some(value=>value!==''))rows.push(row);
      row=[];
    }else cell+=ch;
  }
  if(quoted)throw new Error('CSV 引號未結束。');
  if(cell!==''||row.length){row.push(cell);if(row.some(value=>value!==''))rows.push(row);}
  if(rows.length<2)throw new Error('CSV 沒有資料列。');
  const header=rows[0].map(value=>value.trim());
  return {header,records:rows.slice(1).map((values,index)=>{
    if(values.length!==header.length)throw new Error('第 '+(index+2)+' 行欄位數量不符。');
    return Object.fromEntries(header.map((key,column)=>[key,values[column]]));
  })};
}
