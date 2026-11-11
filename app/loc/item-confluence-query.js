'use client';

import {DB_QUERY_BATCH_SIZE,selectRows} from './db-query.mjs';
import {selectDailyRuneRange} from './daily-runes';
import {dbPublicClient} from './db-client.mjs';
import {realMoonPhase} from './model/moon-phase';
import {
  validateItemConfluenceRange,validateItemLane,groupItemConfluenceRunes
} from './item-confluence-model.mjs';

// Read pages use the shared transport chunk (5000), not the 1,000-row write
// batch, so a 30,000-row lane takes 6 requests instead of 30.
const PER_PAGE=DB_QUERY_BATCH_SIZE;
// Guardrail: no full-table reads. Date and source filters are pushed to SQL,
// pages contain timestamps only; reject excessive windows rather than truncate.
const MAX_LANE_ROWS=30000;
const PLATFORM_FILTERS=Object.freeze({
  'galaxy:facebook':'site.ilike.*facebook*,site.ilike.fb',
  'galaxy:threads':'site.ilike.*threads*',
  'galaxy:instagram':'site.ilike.*instagram*,site.ilike.ig,site.ilike.*reels*'
});

function taipeiDay(timestamp){
  if(!timestamp)return '';
  const date=new Date(timestamp);
  if(Number.isNaN(date.getTime()))return String(timestamp).slice(0,10);
  const parts=new Intl.DateTimeFormat('en-CA',{
    timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(date);
  const fields=Object.fromEntries(parts.filter(item=>item.type!=='literal').map(item=>[item.type,item.value]));
  return fields.year+'-'+fields.month+'-'+fields.day;
}

// One server-side GROUP BY: the database counts per Taipei day and returns
// at most one row per day, so no row-level paging is needed.
async function selectLaneDailyGrouped({scope,spec,range}){
  const media=spec.source.startsWith('media:');
  const platform=spec.source.startsWith('galaxy:')&&spec.source!=='galaxy:exact'
    ?spec.source.slice('galaxy:'.length):null;
  const {data,error}=await dbPublicClient.schema('silver').analytics({
    p_scope_id:scope.id,p_view:'lane_daily',
    p_start:range.startDate,p_end:range.endDate,
    p_options:{media,platform,exact:spec.source.endsWith(':exact')?spec.exact:null}
  });
  if(error)throw error;
  if(!Array.isArray(data))throw new Error('Invalid lane daily response');
  return data.map(row=>({day:String(row.day).slice(0,10),count:Number(row.item_count)||0}))
    .filter(row=>row.day>=range.startDate&&row.day<=range.endDate)
    .sort((a,b)=>a.day.localeCompare(b.day));
}

async function pageLaneDays({scope,spec,range,totals}){
  const media=spec.source.startsWith('media:');
  const table=media?scope.galaxyMedia:scope.galaxy;
  const filters=[
    {column:'createtime',operator:'gte',value:range.startDate+'T00:00:00+08:00'},
    {column:'createtime',operator:'lte',value:range.endDate+'T23:59:59.999+08:00'},
    ...(media?[]:[
      {column:'keyword',operator:'eq',value:'true'},
      {column:'content',operator:'neq',value:''}
    ]),
    ...(spec.source==='galaxy:exact'?[{column:'site',operator:'eq',value:spec.exact}]:[]),
    ...(spec.source==='media:exact'?[{column:'type',operator:'eq',value:spec.exact}]:[])
  ];
  const orFilter=PLATFORM_FILTERS[spec.source]||'';
  let offset=0;
  while(true){
    const page=await selectRows(table,{
      columns:'createtime',
      filters,orFilter,
      orders:[{column:'createtime',ascending:true}],
      limit:PER_PAGE,offset,
      count:offset===0?'exact':null,
      maxLimit:PER_PAGE
    });
    if(offset===0&&Number(page.count)>MAX_LANE_ROWS)
      throw new Error('此河道的三個月紀錄超過 '+MAX_LANE_ROWS.toLocaleString()+' 筆，請縮小日期區間。');
    for(const row of page.rows||[]){
      const day=taipeiDay(row.createtime);
      if(day<range.startDate||day>range.endDate)continue;
      totals.set(day,(totals.get(day)||0)+1);
    }
    offset+=(page.rows||[]).length;
    if(offset>MAX_LANE_ROWS)throw new Error('項目交會資料量過大，請縮小日期區間。');
    if((page.rows||[]).length<PER_PAGE)break;
  }
}

export async function selectLocItemDailySeries({scope,lane,startDate,endDate,knownScopes=[]}={}){
  const range=validateItemConfluenceRange(startDate,endDate);
  if(!range.valid)throw new Error(range.reason);
  const spec=validateItemLane(lane,knownScopes);
  if(!spec.valid||spec.scopeId!==scope?.id)throw new Error(spec.reason||'Scope 與河道不符。');
  const totals=new Map();
  if(spec.source==='daily:rune'){
    const rows=await selectDailyRuneRange(range);
    // A dedicated semantic source. The astronomical phase is calculated from
    // the draw date even if an old recorded_phase value exists.
    return groupItemConfluenceRunes(rows,day=>
      realMoonPhase(new Date(day+'T12:00:00+08:00'))
    );
  }else{
    try{
      return await selectLaneDailyGrouped({scope,spec,range});
    }catch(error){
      // Older/backup SQL targets may lack the grouped view; page the rows instead.
      if(error?.name==='AbortError')throw error;
    }
    await pageLaneDays({scope,spec,range,totals});
  }
  return [...totals.entries()].map(([day,count])=>({day,count}))
    .sort((a,b)=>a.day.localeCompare(b.day));
}
