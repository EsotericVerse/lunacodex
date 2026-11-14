// Read-only article statistics exposed as a bounded MCP Function.
// Reuses LOC Web's existing public Galaxy numeric aggregation. No SQL input,
// SQL execution, article content, ScopeID registration, or new grant registry.
import {executeKyselyAnalytics} from '../providers/kysely-analytics.mjs';
import {directMcpKysely} from './native-kysely.mjs';

function invalid(message,status=400){
  return Object.assign(new Error(message),{httpStatus:status});
}
function localToday(now){
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(now);
  const values=Object.fromEntries(parts.filter(x=>x.type!=='literal')
    .map(x=>[x.type,Number(x.value)]));
  return values;
}
function monthKey(year,month){
  return `${year}-${String(month).padStart(2,'0')}`;
}
export function articleWindow(args={},now=new Date()){
  const today=localToday(now);
  const period=args.period||'calendar_year';
  if(period!=='calendar_year'&&period!=='rolling_12_months')
    throw invalid('Invalid article statistics period');
  if(period==='rolling_12_months'&&args.year!==undefined)
    throw invalid('Year is not used for a rolling period');
  const year=args.year??today.year;
  if(!Number.isInteger(year)||year<2020||year>today.year)
    throw invalid('Invalid article statistics year');
  const months=[];
  if(period==='calendar_year'){
    const last=year===today.year?today.month:12;
    for(let m=1;m<=last;m++)months.push(monthKey(year,m));
  }else{
    for(let offset=11;offset>=0;offset--){
      const d=new Date(Date.UTC(today.year,today.month-1-offset,1));
      months.push(monthKey(d.getUTCFullYear(),d.getUTCMonth()+1));
    }
  }
  const start=months[0]+'-01';
  const end=period==='rolling_12_months'||year===today.year
    ?`${monthKey(today.year,today.month)}-${String(today.day).padStart(2,'0')}`
    :`${year}-12-31`;
  return {period,start,end,months};
}
export function aggregateArticleMonths(months,rows){
  if(!Array.isArray(rows))throw invalid('Article statistics unavailable',503);
  const totals=new Map(months.map(month=>[month,0]));
  for(const row of rows){
    if(!row||typeof row.day!=='string')continue;
    const key=row.day.slice(0,7),count=Number(row.item_count);
    if(!totals.has(key)||!Number.isSafeInteger(count)||count<0)
      continue;
    const next=totals.get(key)+count;
    if(!Number.isSafeInteger(next))throw invalid('Statistics count overflow',503);
    totals.set(key,next);
  }
  return [...totals].map(([month,count])=>({month,count}));
}
export async function articleDistribution(args={},env={},{
  database=directMcpKysely,analytics=executeKyselyAnalytics,now=new Date()
}={}){
  const {period,start,end,months}=articleWindow(args,now);
  const {db}=await database(env);
  // "loc" uses the website's published, aggregate-only Galaxy statistics.
  // The active api.manage email eligibility is verified once by the caller.
  // No user supplied ScopeID; no private article text or arbitrary SQL.
  const result=await db.transaction().execute(trx=>analytics(trx,{args:{
    p_scope_id:'loc',p_view:'loc',p_start:start,p_end:end,p_options:{}
  }},{role:'anon'}));
  const rows=aggregateArticleMonths(months,result?.data?.rows);
  return {function:'analytics.article_distribution',metric:'article_count',
    period,start,end,timezone:'Asia/Taipei',group_by:'month',
    visibility:'published_aggregate',rows,
    total:rows.reduce((sum,row)=>sum+row.count,0),
    source:'LOC Galaxy statistics'};
}
