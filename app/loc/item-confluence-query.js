'use client';

import {selectDailyRuneRange} from './daily-runes';
import {dbPublicClient} from './db-client.mjs';
import {realMoonPhase} from './model/moon-phase';
import {
  validateItemConfluenceRange,validateItemLane,groupItemConfluenceRunes
} from './item-confluence-model.mjs';

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

export async function selectLocItemDailySeries({scope,lane,startDate,endDate,knownScopes=[]}={}){
  const range=validateItemConfluenceRange(startDate,endDate);
  if(!range.valid)throw new Error(range.reason);
  const spec=validateItemLane(lane,knownScopes);
  if(!spec.valid||spec.scopeId!==scope?.id)throw new Error(spec.reason||'Scope 與河道不符。');
  if(spec.source==='daily:rune'){
    const rows=await selectDailyRuneRange(range);
    // A dedicated semantic source. The astronomical phase is calculated from
    // the draw date even if an old recorded_phase value exists.
    return groupItemConfluenceRunes(rows,day=>
      realMoonPhase(new Date(day+'T12:00:00+08:00'))
    );
  }
  // One Kysely aggregate is the only LOC Galaxy/MediaAnchor lane pipeline.
  return selectLaneDailyGrouped({scope,spec,range});
}
