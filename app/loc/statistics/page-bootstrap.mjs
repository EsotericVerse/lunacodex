import {calendarYearWindow} from '../preferences/default-year-window.mjs';
import {SCOPE_ROUTE_INDEX} from '../../modular/routing/scope-route-index.js';
import {scopeFeatureEnabled} from '../scope/scope-config-fields.mjs';

const SCOPE_ID=/^[a-z][a-z0-9]{0,14}$/;

function taipeiDateKey(date){
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(date);
  const value=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return value.year+'-'+value.month+'-'+value.day;
}

// RSC owns the first public Statistics snapshot. Follow-up ranges and selected
// dimensions remain on their existing feature-owned Server Actions.
export async function loadStatisticsPageInitialData(scopeValue,{
  now=new Date(),query=null
}={}){
  const scopeId=String(scopeValue||'').trim().toLowerCase();
  if(!SCOPE_ID.test(scopeId)||scopeId==='admin'||scopeId==='local')return null;
  const published=SCOPE_ROUTE_INDEX.find(row=>
    row.scope_id===scopeId&&row.active!==false);
  if(!published||!scopeFeatureEnabled(published.config,'statistics_able'))return null;

  const {startDate}=calendarYearWindow(now);
  const endDate=taipeiDateKey(now);
  if(endDate<startDate)return null;
  const params=new URLSearchParams({
    kind:scopeId==='loc'?'loc':'daily_total',
    scope:scopeId,start:startDate,end:endDate
  });
  const runQuery=query||((value)=>import('../actions/statics/queries.mjs')
    .then(module=>module.queryStaticsContent(value)));
  const result=await runQuery(params.toString());
  const data=result?.data;
  if(!data||!Array.isArray(data.rows)||
    scopeId==='loc'&&!Array.isArray(data.scopes))
    throw new Error('Invalid Statistics page bootstrap');
  return {scopeId,startDate,endDate,data};
}
