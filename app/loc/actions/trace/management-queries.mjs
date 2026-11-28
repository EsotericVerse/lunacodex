'use server';
import {sql} from 'kysely';
import {withAuthorizedLocRead} from '../read-context.mjs';
import {portableRelation} from '../../providers/sql-engine-ports.mjs';
import {modeledBooleanColumns} from '../../../../packages/zenstack/model-column-guard.mjs';
import {scopeTableName} from '../../../../packages/zenstack/scope-table-names.mjs';

const DAY=/^\d{4}-\d{2}-\d{2}$/;
const UID=/^[A-Za-z0-9]{8}$/;
const BULK_FLAGS=new Set(modeledBooleanColumns('silver',scopeTableName('lo3rwang','galaxy')));

function scopeId(value){
  const scope=String(value||'').trim().toLowerCase();
  if(!/^[a-z][a-z0-9]{0,14}$/.test(scope))throw Error('Invalid Trace Scope');
  return scope;
}
function tableFor(scope,port){
  return portableRelation(scopeTableName(scope,'galaxy'),port.engine,
    port.namespace||(port.engine==='postgres'?'silver':'dbo'));
}
function locationIsEmpty(query){
  return query.where(eb=>eb.or([
    eb('location','is',null),
    eb(sql`trim(${sql.ref('location')})`,'=','')
  ]));
}
function day(value){
  const input=String(value||'');
  if(!DAY.test(input)||new Date(input+'T00:00:00Z').toISOString().slice(0,10)!==input)
    throw Error('Invalid Trace date');
  return input;
}
function taipeiDayStart(value){return new Date(value+'T00:00:00+08:00')}
function nextDay(value){
  const result=new Date(value+'T00:00:00Z');
  result.setUTCDate(result.getUTCDate()+1);
  return result.toISOString().slice(0,10);
}
function displayTaipeiDate(value){
  const date=value instanceof Date?value:new Date(value);
  if(Number.isNaN(date.getTime()))return '';
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',
    year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const part=name=>parts.find(item=>item.type===name)?.value||'';
  return part('year')+'-'+part('month')+'-'+part('day');
}
function flagsInput(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||
    Object.keys(value).length===0||
    Object.keys(value).some(key=>!BULK_FLAGS.has(key)||typeof value[key]!=='boolean'))
    throw Error('Bulk update requires explicit Galaxy Boolean values');
  return value;
}
function siteInput(value){
  const site=String(value||'').trim().toLowerCase();
  if(!/^[a-z][a-z0-9_. -]{0,63}$/.test(site))throw Error('Invalid Galaxy source');
  return site;
}
function articleUids(value){
  if(!Array.isArray(value)||value.length<1||value.length>200||
    value.some(uid=>!UID.test(String(uid||''))))
    throw Error('Select 1–200 valid articles');
  return [...new Set(value)];
}

export async function queryGalaxyPlaceFillPreview(args={}){
  const scope=scopeId(args.p_scope_id);
  const start=day(args.p_start_date),end=day(args.p_end_date);
  const place=String(args.p_place||'').trim();
  if(start>end||start<'1900-01-01'||end>='2100-01-01'||
    !place||place.length>200)throw Error('Invalid Trace place-fill preview');
  const from=taipeiDayStart(start),until=taipeiDayStart(nextDay(end));
  return withAuthorizedLocRead({scope,writeScopes:[scope]},async(db,port)=>{
    const table=tableFor(scope,port);
    const matching=locationIsEmpty(db.selectFrom(table)
      .where('createtime','>=',from).where('createtime','<',until));
    const countRow=await matching.select(eb=>eb.fn.countAll().as('count'))
      .executeTakeFirst();
    const project=['uid','title','createtime'];
    const first=await matching.select(project).orderBy('createtime','asc')
      .limit(3).execute();
    const last=await matching.select(project).orderBy('createtime','desc')
      .limit(3).execute();
    const sample=rows=>rows.map(row=>({uid:String(row.uid||''),
      title:String(row.title||''),date:displayTaipeiDate(row.createtime)}));
    const count=Number(countRow?.count||0);
    if(!Number.isSafeInteger(count)||count<0)throw Error('Invalid place-fill count');
    return {count,first:sample(first),last:sample(last)};
  });
}

export async function queryGalaxyLocationBatchPreview(args={}){
  const scope=scopeId(args.p_scope_id),uids=articleUids(args.p_uids);
  return withAuthorizedLocRead({scope,writeScopes:[scope]},async(db,port)=>{
    const table=tableFor(scope,port);
    const rows=await db.selectFrom(table).select(['uid','location'])
      .where('uid','in',uids).execute();
    const found=new Set(rows.map(row=>String(row.uid)));
    if(found.size!==uids.length)throw Error('Article selection changed');
    const eligible=rows.filter(row=>row.location===null||
      String(row.location||'').replace(/^ +| +$/g,'')==='').length;
    return {applied:false,selected:uids.length,eligible,
      skipped:uids.length-eligible};
  });
}

export async function queryGalaxyVisibilityPreview(args={}){
  const scope=scopeId(args.p_scope_id),site=siteInput(args.p_site);
  const flags=flagsInput(args.p_flags);
  if(['mcp','github'].includes(site)&&Object.values(flags).some(Boolean))
    throw Object.assign(new Error('Private MCP and GitHub sources cannot be publicly enabled'),
      {httpStatus:403});
  return withAuthorizedLocRead({scope,writeScopes:[scope]},async(db,port)=>{
    const table=tableFor(scope,port);
    let query=db.selectFrom(table)
      .where(eb=>eb(sql`lower(coalesce(${sql.ref('site')},''))`,'=',site));
    query=query.where(eb=>eb.or(Object.entries(flags).map(([column,value])=>
      eb.or([eb(column,'=',!value),eb(column,'is',null)]))));
    const row=await query.select(eb=>eb.fn.countAll().as('matching'))
      .executeTakeFirst();
    const matching=Number(row?.matching||0);
    if(!Number.isSafeInteger(matching)||matching<0)
      throw Error('Invalid visibility preview count');
    return {matching};
  });
}
