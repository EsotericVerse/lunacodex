// Read-only LOC MCP article analytics. Reuses the website's existing
// Kysely aggregation; never reads Galaxy.content or accepts SQL/Scope IDs.
import {executeKyselyAnalytics} from '../providers/kysely-analytics.mjs';
import {directMcpKysely} from './native-kysely.mjs';

const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
function refusal(message,httpStatus=403){
  return Object.assign(new Error(message),{httpStatus});
}
function taipeiToday(now){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
    timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(now).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));
  return parts;
}
function monthString(year,month){return `${year}-${String(month).padStart(2,'0')}`;}
function monthsFor(args={},now=new Date()){
  const today=taipeiToday(now);
  const period=args.period||'calendar_year';
  if(period==='rolling_12_months'&&args.year!==undefined)
    throw refusal('Year cannot be combined with rolling period',400);
  if(period!=='calendar_year'&&period!=='rolling_12_months')
    throw refusal('Invalid statistics period',400);
  const year=args.year??today.year;
  if(!Number.isInteger(year)||year<2020||year>today.year)
    throw refusal('Invalid statistics year',400);
  const keys=[];
  if(period==='calendar_year'){
    const last=year===today.year?today.month:12;
    for(let month=1;month<=last;month++)keys.push(monthString(year,month));
  }else{
    for(let offset=11;offset>=0;offset--){
      const day=new Date(Date.UTC(today.year,today.month-1-offset,1));
      keys.push(monthString(day.getUTCFullYear(),day.getUTCMonth()+1));
    }
  }
  const start=keys[0]+'-01';
  const end=(period==='rolling_12_months'||year===today.year)
    ?`${monthString(today.year,today.month)}-${String(today.day).padStart(2,'0')}`
    :`${keys[keys.length-1]}-31`;
  return {period,keys,start,end};
}
export function articleMonthsFromRows(keys,groups){
  const totals=new Map(keys.map(key=>[key,0]));
  for(const rows of groups){
    if(!Array.isArray(rows))throw refusal('Statistics source is unavailable',503);
    for(const row of rows){
      if(row?.kind!=='total'||typeof row.day!=='string')continue;
      const key=row.day.slice(0,7),count=Number(row.item_count);
      if(totals.has(key)&&Number.isSafeInteger(count)&&count>=0)
        totals.set(key,totals.get(key)+count);
    }
  }
  return [...totals].map(([month,count])=>({month,count}));
}
export async function articleDistribution(args={},env={},permissions={}, {
  database=directMcpKysely,query=executeKyselyAnalytics,now=new Date()
}={}){
  const {period,keys,start,end}=monthsFor(args,now);
  // Only explicit active api.manage Scope grants may be used. A Group grant or
  // Auth login is not permission to inspect arbitrary databases or Scopes.
  const scopes=[...new Set((permissions.roles||[])
    .filter(row=>row?.role==='scope'&&SCOPE.test(row.id))
    .map(row=>row.id))];
  if(!scopes.length)throw refusal('No authorized LOC article dataset');
  if(scopes.length>12)throw refusal('Too many authorized LOC article datasets',400);
  const {db}=await database(env);
  const groups=[];
  for(const scope of scopes){
    const result=await query(db,{args:{p_scope_id:scope,p_view:'daily',
      p_start:start,p_end:end,p_options:{}}},{role:'authenticated'});
    groups.push(result?.data);
  }
  const rows=articleMonthsFromRows(keys,groups);
  return {function:'analytics.article_distribution',metric:'article_count',
    period,start,end,timezone:'Asia/Taipei',group_by:'month',
    source:'LOC Galaxy published statistics',rows,
    total:rows.reduce((sum,row)=>sum+row.count,0)};
}
