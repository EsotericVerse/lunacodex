import {dbAuthRelation} from './db-client.mjs';
import {selectAllRows,selectRows} from './db-query.mjs';
import {realMoonPhase} from './model/moon-phase';
import {revalidateServerMetadata} from './scope-data';
import {lRunes66ColumnString} from '../../zenstack/lrunes-read-model.mjs';


async function attachRuneMeta(rows){
  const source=Array.isArray(rows)?rows:[];
  const ids=[...new Set(source.map(row=>Number(row.rune_number)).filter(number=>Number.isInteger(number)&&number>=0&&number<=66))];
  const runes=ids.length?(await selectRows('silver.runes',{
    columns:lRunes66ColumnString('rune_id','rune_name','english_name','totem','group_name','moon_phase','card_attr','rune_description','archetype','positive_keywords','negative_keywords'),
    filters:[{column:'rune_id',operator:'in',value:ids}],
    limit:ids.length,
    offset:0
  })).rows:[];
  const meta=new Map(runes.map(row=>[Number(row.rune_id),row]));
  return source.map(row=>{
    const rune=meta.get(Number(row.rune_number))||{};
    return {
      ...row,
      ...rune,
      rune_id:rune.rune_id??row.rune_number,
      rune_name:rune.rune_name||String(row.rune_number)
    };
  });
}

async function selectDailyRangeRows(filters=[],orders=[]){
  return (await selectAllRows('silver.lrunes_daily',{
    columns:'record_date,draw_kind,rune_number,direction,recorded_phase',
    filters,
    orders
  })).rows;
}

// Daily Rune is standalone LOC comparison test data, not a source category.
export async function selectFirstDailyRuneDate(){
  const {rows}=await selectRows('silver.lrunes_daily',{
    columns:'record_date',orders:[{column:'record_date',ascending:true}],limit:1
  });
  return String(rows[0]?.record_date||'').slice(0,10);
}

export async function selectDailyRuneRange({startDate,endDate}={}){
  const start=String(startDate||'').slice(0,10);
  const end=String(endDate||'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end))return [];
  const low=start<=end?start:end;
  const high=start<=end?end:start;
  const rows=await selectDailyRangeRows([
    {column:'record_date',operator:'gte',value:low},
    {column:'record_date',operator:'lte',value:high}
  ],[
    {column:'record_date',ascending:true},
    {column:'draw_kind',ascending:true}
  ]);
  return attachRuneMeta(rows);
}

export async function selectPreviousDailyRuneOccurrence({runeNumber,beforeDate}={}){
  const rune=Number(runeNumber);
  const before=String(beforeDate||'').slice(0,10);
  if(!Number.isInteger(rune)||rune<0||rune>66)return null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(before))return null;
  const {rows}=await selectRows('silver.lrunes_daily',{
    columns:'record_date,draw_kind,rune_number,direction',
    filters:[
      {column:'rune_number',operator:'eq',value:rune},
      {column:'record_date',operator:'lt',value:before}
    ],
    orders:[
      {column:'record_date',ascending:false},
      {column:'draw_kind',ascending:true}
    ],
    limit:1,
    offset:0
  });
  if(!rows?.length)return null;
  const attached=await attachRuneMeta(rows);
  return attached[0]||null;
}

const DIRECTION_CODE=Object.freeze({
  '正位':1,
  '半正位':2,
  '半逆位':3,
  '逆位':4
});

async function selectDailyRuneTexts({runeNumber,direction,recordDate,types=[]}={}){
  const rune=Number(runeNumber);
  const dir=DIRECTION_CODE[String(direction||'').trim()];
  const date=String(recordDate||'').slice(0,10);
  if(!Number.isInteger(rune)||rune<0||rune>66||!dir)return {moonPhase:'未知',texts:{}};
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return {moonPhase:'未知',texts:{}};
  const moonPhase=realMoonPhase(new Date(date+'T12:00:00+08:00'));
  if(!moonPhase||moonPhase==='未知')return {moonPhase:'未知',texts:{}};
  const wanted=[...new Set((types||[]).map(String).filter(Boolean))];
  if(!wanted.length)return {moonPhase,texts:{}};
  const {rows}=await selectRows('silver.runes_etc',{
    columns:'type,desc',
    filters:[
      {column:'rune_id',operator:'eq',value:rune},
      {column:'dir',operator:'eq',value:dir},
      {column:'type',operator:'in',value:wanted},
      {column:'current_moon',operator:'eq',value:moonPhase}
    ],
    limit:wanted.length,
    offset:0
  });
  return {
    moonPhase,
    texts:Object.fromEntries((rows||[]).map(row=>[String(row.type),String(row.desc||'').trim()]))
  };
}

export async function selectDailyRuneSituation(args={}){
  const result=await selectDailyRuneTexts({...args,types:['sit_q']});
  return {text:result.texts.sit_q||'',moonPhase:result.moonPhase};
}

export async function selectDailyRuneContext(args={}){
  const result=await selectDailyRuneTexts({...args,types:['sit_q','daily_r','daily_g','daily_b']});
  return {
    moonPhase:result.moonPhase,
    situation:result.texts.sit_q||'',
    reminder:result.texts.daily_r||'',
    guidance:result.texts.daily_g||'',
    blessing:result.texts.daily_b||''
  };
}

export async function selectDailyRuneMonth({year,month}={}){
  const safeYear=Math.max(2000,Math.min(9999,Math.floor(Number(year)||2026)));
  const safeMonth=Math.max(1,Math.min(12,Math.floor(Number(month)||8)));
  const start=`${safeYear}-${String(safeMonth).padStart(2,'0')}-01`;
  const nextDate=new Date(Date.UTC(safeYear,safeMonth,1));
  const end=`${nextDate.getUTCFullYear()}-${String(nextDate.getUTCMonth()+1).padStart(2,'0')}-01`;
  const rows=await selectDailyRangeRows([
    {column:'record_date',operator:'gte',value:start},
    {column:'record_date',operator:'lt',value:end}
  ],[
    {column:'record_date',ascending:true},
    {column:'draw_kind',ascending:true}
  ]);
  return attachRuneMeta(rows);
}


const DAILY_DRAW_KINDS=new Set(['main','supplement']);
const DAILY_DIRECTIONS=new Set(['正位','半正位','半逆位','逆位']);

export async function insertDailyRuneRecord({recordDate,drawKind,runeNumber,direction}={}){
  const date=String(recordDate||'').slice(0,10);
  const kind=String(drawKind||'').trim();
  const rune=Number(runeNumber);
  const dir=String(direction||'').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('日期格式不正確。');
  if(!DAILY_DRAW_KINDS.has(kind))throw new Error('紀錄類型不正確。');
  if(!Number.isInteger(rune)||rune<0||rune>66)throw new Error('符文編號不正確。');
  if(!DAILY_DIRECTIONS.has(dir))throw new Error('符文方向不正確。');
  const row={
    record_id:'manual:'+date+':'+kind,
    record_date:date,
    draw_kind:kind,
    rune_number:rune,
    direction:dir
  };
  const {data,error}=await dbAuthRelation('silver.lrunes_daily')
    .insert(row)
    .select('record_date,draw_kind,rune_number,direction');
  if(error){
    if(String(error.code||'')==='23505')throw new Error('這一天已經有相同種類的紀錄。');
    throw new Error(error.message||'每日符文紀錄新增失敗');
  }
  const attached=await attachRuneMeta(data||[]);
  // A successful public Daily write invalidates the same numeric ISR used
  // by Culture and Statistics. The native SQLite adapter remains separate.
  await revalidateServerMetadata();
  return attached[0]||null;
}


export async function updateDailyRuneRecord({recordDate,drawKind,runeNumber,direction}={}){
  const date=String(recordDate||'').slice(0,10);
  const kind=String(drawKind||'').trim();
  const rune=Number(runeNumber);
  const dir=String(direction||'').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('日期格式不正確。');
  if(!DAILY_DRAW_KINDS.has(kind))throw new Error('紀錄類型不正確。');
  if(!Number.isInteger(rune)||rune<0||rune>66)throw new Error('符文編號不正確。');
  if(!DAILY_DIRECTIONS.has(dir))throw new Error('符文方向不正確。');
  const {data,error}=await dbAuthRelation('silver.lrunes_daily')
    .update({rune_number:rune,direction:dir,updated_at:new Date().toISOString()})
    .eq('record_date',date)
    .eq('draw_kind',kind)
    .select('record_date,draw_kind,rune_number,direction');
  if(error)throw new Error(error.message||'每日符文紀錄修改失敗');
  if(!data?.length)throw new Error('找不到紀錄或目前沒有修改權限。');
  const attached=await attachRuneMeta(data);
  await revalidateServerMetadata();
  return attached[0]||null;
}

export async function deleteDailyRuneRecord({recordDate,drawKind}={}){
  const date=String(recordDate||'').slice(0,10);
  const kind=String(drawKind||'').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('日期格式不正確。');
  if(!DAILY_DRAW_KINDS.has(kind))throw new Error('紀錄類型不正確。');
  const {data,error}=await dbAuthRelation('silver.lrunes_daily')
    .delete()
    .eq('record_date',date)
    .eq('draw_kind',kind)
    .select('record_date,draw_kind');
  if(error)throw new Error(error.message||'每日符文紀錄刪除失敗');
  if(!data?.length)throw new Error('找不到紀錄或目前沒有刪除權限。');
  await revalidateServerMetadata();
  return data[0];
}
