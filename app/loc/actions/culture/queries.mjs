'use server';
import {withAuthorizedLocRead,withPublicLocRead} from '../read-context.mjs';
import {sql} from 'kysely';
import {portableRelation} from '../../providers/sql-engine-ports.mjs';
import {galaxyReadColumns} from '../../../../packages/zenstack/galaxy-read-models.mjs';
import {LUCUS_TYPE_GROUPS} from '../../../../packages/zenstack/lucus-hierarchy.mjs';
import {assertZModelLucusFeatureRows,assertZModelSelectRows}
  from '../../../../packages/zenstack/import-validation.mjs';
import {MAX_ROWS,TIME_LUCUS_MAX_PAGE_ROWS}
  from '../../query/query-batch-size.mjs';
import {readDateRangeAggregates}
  from '../../query/date-range-aggregate.mjs';
import {PUBLIC_GALAXY_PRIVATE_SITES}
  from '../../model/galaxy-feature-queries.mjs';
import {PUBLISHED_SITE_BOOTSTRAP} from '../../../modular/published-site-bootstrap.js';

const DAY=/^\d{4}-\d{2}-\d{2}$/;
const UID=/^[A-Za-z0-9]{8}$/;
const id=value=>{
  const scope=String(value||'').trim().toLowerCase();
  if(!/^[a-z][a-z0-9]{0,14}$/.test(scope)||scope==='admin')
    throw Error('Invalid Culture Scope');
  return scope;
};
const date=value=>{
  if(value==null||value==='')return '';
  const result=String(value);
  if(!DAY.test(result))throw Error('Invalid Culture date');
  return result;
};
function exactKeys(value,allowed){
  return value&&typeof value==='object'&&!Array.isArray(value)&&
    Object.keys(value).every(key=>allowed.includes(key));
}
function relation(scope,suffix,port){
  return portableRelation(scope+'_'+suffix,port.engine,
    port.namespace||(port.engine==='postgres'?'silver':'dbo'));
}


const RANGE_LIMIT=80;
function locCultureMemberScopes(){
  return [...new Set((PUBLISHED_SITE_BOOTSTRAP.registry||[])
    // LRS is an independent framework; its legacy parent pointer to LOC
    // must never pull rune data into the LOC Culture rivers.
    .filter(row=>row?.scope_kind==='scope'&&row?.parent_scope_id==='loc'&&
      row?.scope_id!=='lrunes'&&row?.active!==false)
    .map(row=>String(row.scope_id||'').trim().toLowerCase())
    .filter(value=>/^[a-z][a-z0-9]{0,14}$/.test(value)&&value!=='admin'))]
    .sort();
}
function dateWindows(value){
  if(!Array.isArray(value)||!value.length||value.length>RANGE_LIMIT)
    throw Error('Invalid Culture time windows');
  return value.map(range=>{
    if(!exactKeys(range,['startDate','endDate']))throw Error('Invalid Culture time window');
    const start=date(range.startDate),end=date(range.endDate);
    if(!start||!end||start>end)throw Error('Invalid Culture time window');
    return {startDate:start,endDate:end};
  }).sort((a,b)=>a.startDate.localeCompare(b.startDate)||a.endDate.localeCompare(b.endDate));
}
function jsonDateExpression(engine,alias='t'){
  const attr=sql.ref(alias+'.attr');
  if(engine==='postgres')return sql`(${attr}->>'date')`;
  if(engine==='mysql')return sql`JSON_UNQUOTE(JSON_EXTRACT(${attr}, '$.date'))`;
  if(engine==='mssql')return sql`JSON_VALUE(${attr}, '$.date')`;
  throw Error('Unsupported Culture SQL dialect');
}
function timeDatePredicate(engine,windows,alias='t'){
  const value=jsonDateExpression(engine,alias);
  return sql`(${sql.join(windows.map(range=>
    sql`(${value} >= ${range.startDate} and ${value} <= ${range.endDate})`
  ),sql` or `)})`;
}
function periodEndpointUidQuery(engine,table){
  const relation=sql.ref(table);
  if(engine==='postgres')return sql`select jsonb_array_elements_text(
    case when jsonb_typeof(p.attr->'uid')='array' then p.attr->'uid' else '[]'::jsonb end
  ) from ${relation} as p where p.type='period' and p.invisible=false`;
  if(engine==='mysql')return sql`select refs.uid from ${relation} as p
    join JSON_TABLE(
      case when JSON_TYPE(JSON_EXTRACT(p.attr,'$.uid'))='ARRAY'
        then JSON_EXTRACT(p.attr,'$.uid') else JSON_ARRAY() end,
      '$[*]' COLUMNS(uid CHAR(8) PATH '$')
    ) as refs where p.type='period' and p.invisible=false`;
  if(engine==='mssql')return sql`select refs.value from ${relation} as p
    cross apply openjson(p.attr,'$.uid') as refs
    where p.type='period' and p.invisible=0`;
  throw Error('Unsupported Culture SQL dialect');
}

// LOC's Group Culture uses one fixed SQL projection across its published
// member Scopes. Index mode returns all Era/Period metadata, only linked Date
// endpoints, and Date rows inside the requested windows. Range mode returns
// only Date rows from every member Scope inside the selected Era's exact windows.
export async function queryLocCultureTimeRiver(args={}){
  if(!exactKeys(args,['mode','ranges'])||
    !['index','range'].includes(args.mode))
    throw Error('Invalid LOC Culture TimeLucus request');
  const windows=dateWindows(args.ranges);
  const members=locCultureMemberScopes();
  if(!members.length)return {data:{rows:[]},count:null};
  const scopes=members;
  return withPublicLocRead({scope:'loc'},async(db,port)=>{
    const namespace=port.namespace||(port.engine==='postgres'?'silver':'dbo');
    const visible=port.engine==='mssql'?sql`t.invisible=0`:sql`t.invisible=false`;
    const branches=scopes.map(scope=>{
      const table=portableRelation(scope+'_lucus',port.engine,namespace);
      const relation=sql.ref(table);
      const rangePredicate=timeDatePredicate(port.engine,windows,'t');
      if(args.mode==='range'){
        return sql`select ${scope} as scope_id,t.uid,t.type,t.title,t.description,t.attr
          from ${relation} as t
          where ${visible} and t.type='date' and ${rangePredicate}`;
      }
      const endpoints=periodEndpointUidQuery(port.engine,table);
      return sql`select ${scope} as scope_id,t.uid,t.type,t.title,t.description,t.attr
        from ${relation} as t
        where ${visible} and (
          t.type in ('era','period') or
          (t.type='date' and (
            t.uid in (${endpoints}) or ${rangePredicate}
          ))
        )`;
    });
    const result=await sql`select scope_id,uid,type,title,description,attr
      from (${sql.join(branches,sql` union all `)}) as loc_time_river
      order by scope_id,type,uid`.execute(db);
    const rows=assertZModelLucusFeatureRows(result.rows||[]);
    return {data:{rows:rows.map(row=>({...row,
      scope_id:String(row.scope_id||''),
      attr:typeof row.attr==='string'?JSON.parse(row.attr||'{}'):row.attr||{}
    }))},count:null};
  });
}

// One LOC-wide SQL aggregation for the lower Culture river. Each member
// Galaxy is date-filtered before UNION ALL; the database groups by Scope,
// date and source, so no per-Scope Server Action fan-out or article rows are
// materialized in the browser.
export async function queryLocCultureDensity(args={}){
  if(!exactKeys(args,['ranges']))throw Error('Invalid LOC Culture density request');
  const windows=dateWindows(args.ranges);
  const members=locCultureMemberScopes();
  if(!members.length)return {data:{rows:[]},count:null};
  return withPublicLocRead({scope:'loc'},async(db,port)=>{
    const namespace=port.namespace||(port.engine==='postgres'?'silver':'dbo');
    const cultureEnabled=port.engine==='mssql'?sql`g.culture=1`:sql`g.culture=true`;
    const privateSites=sql.join(PUBLIC_GALAXY_PRIVATE_SITES.map(site=>sql`${site}`),sql`, `);
    const branches=members.map(scope=>{
      const relation=sql.ref(portableRelation(scope+'_galaxy',port.engine,namespace));
      const datePredicate=sql`(${sql.join(windows.map(range=>
        sql`(g.date >= ${range.startDate} and g.date <= ${range.endDate})`
      ),sql` or `)})`;
      return sql`select ${scope} as scope_id,g.date as day,g.site
        from ${relation} as g
        where ${cultureEnabled} and g.date is not null and g.site is not null
          and lower(g.site) not in (${privateSites}) and ${datePredicate}`;
    });
    const result=await sql`select scope_id,day,site,count(*) as item_count
      from (${sql.join(branches,sql` union all `)}) as loc_culture_rows
      group by scope_id,day,site
      order by day,site,scope_id`.execute(db);
    return {data:{rows:result.rows||[]},count:null};
  });
}

export async function queryCulture(args={}){
  if(!exactKeys(args,['p_scope_id','p_view','p_start','p_end','p_options'])||
    args.p_view!=='culture_list'||!exactKeys(args.p_options||{},['site','offset']))
    throw Error('Invalid Culture list request');
  const scope=id(args.p_scope_id),start=date(args.p_start),end=date(args.p_end);
  const site=String(args.p_options?.site||'').trim();
  const offset=Number(args.p_options?.offset||0);
  if(!start||!end||start>end||!site||site.length>120||
    !Number.isSafeInteger(offset)||offset<0||offset>100000)
    throw Error('Invalid Culture list selection');
  return withPublicLocRead({scope},async(db,port)=>{
    const rows=await db.selectFrom(relation(scope,'galaxy',port))
      .select(galaxyReadColumns('GalaxyList'))
      .where('date','>=',start).where('date','<=',end)
      .where('site','=',site).where('culture','=',true)
      .orderBy('createtime','desc').orderBy('uid','asc')
      .limit(100).offset(offset).execute();
    const projected=rows.map(row=>row.list===false
      ?{hidden:true,title:'本文已隱藏',list:false}
      :{uid:String(row.uid),date:row.date instanceof Date
        ?row.date.toISOString().slice(0,10):String(row.date||'').slice(0,10),
        title:String(row.title||''),list:true,hidden:false});
    return {data:{rows:projected,hasMore:rows.length===100,
      nextCursor:rows.length===100?{offset:offset+rows.length}:null},count:null};
  });
}

export async function queryCultureContent(searchParams){
  const params=new URLSearchParams(String(searchParams||''));
  const kind=params.get('kind'),scope=id(params.get('scope'));
  const keys=[...params.keys()];
  if(keys.some(key=>!['kind','scope','start','end'].includes(key))||
    !['culture_lucus','culture_density'].includes(kind))
    throw Error('Invalid Culture query');
  const start=date(params.get('start')),end=date(params.get('end'));
  if(kind==='culture_density'&&(!start||!end||start>end)||
    kind==='culture_lucus'&&(start||end))
    throw Error('Invalid Culture query range');
  return withPublicLocRead({scope},async(db,port)=>{
    if(kind==='culture_lucus'){
      const table=relation(scope,'lucus',port);
      const rows=await db.selectFrom(table).select(['uid','type','title','attr'])
        .where('type','in',LUCUS_TYPE_GROUPS.time)
        .where('invisible','=',false).execute();
      assertZModelSelectRows(table,
        ['uid','type','title','attr'],rows);
      return {data:rows.map(row=>({...row,attr:typeof row.attr==='string'
        ?JSON.parse(row.attr||'{}'):row.attr||{}})),count:null};
    }
    const table=relation(scope,'galaxy',port);
    const build=(rangeStart,rangeEnd)=>db.selectFrom(table)
      .where('culture','=',true).where('date','>=',rangeStart)
      .where('date','<=',rangeEnd).where('date','is not',null);
    const grouped=new Map();
    await readDateRangeAggregates({start,end,
      query:({start:rangeStart,end:rangeEnd})=>build(rangeStart,rangeEnd)
        .select(['date','site'])
        .select(eb=>eb.fn.countAll().as('item_count'))
        .groupBy(['date','site']).execute(),
      consume:rows=>{
        for(const row of rows){
          const day=row.date instanceof Date?row.date.toISOString().slice(0,10):
            String(row.date||'').slice(0,10);
          const site=String(row.site||''),key=JSON.stringify([day,site]);
          grouped.set(key,(grouped.get(key)||0)+Number(row.item_count||0));
        }
      }
    });
    const data=[...grouped].map(([key,item_count])=>{
      const [day,site]=JSON.parse(key);
      return {day,site,item_count};
    }).sort((a,b)=>a.day.localeCompare(b.day)||a.site.localeCompare(b.site));
    return {data,count:null};
  });
}

export async function queryTimeLucus({scope:scopeValue,mode='public',
  cursor='',limit=MAX_ROWS}={}){
  const scope=id(scopeValue);
  if(!['public','editor'].includes(mode)||typeof cursor!=='string'||
    cursor&&!UID.test(cursor)||!Number.isSafeInteger(limit)||limit<1||
    limit>TIME_LUCUS_MAX_PAGE_ROWS)
    throw Error('Invalid TimeLucus page');
  const read=async(db,port)=>{
      let query=db.selectFrom(relation(scope,'lucus',port))
        .select(['uid','type','title','description','attr','invisible'])
        .where('type','in',LUCUS_TYPE_GROUPS.time)
        .orderBy('uid','asc').limit(limit+1);
      if(mode==='public')query=query.where('invisible','=',false);
      if(cursor)query=query.where('uid','>',cursor);
      const rows=await query.execute();
      const data=assertZModelLucusFeatureRows(rows.slice(0,limit));
      return {data,nextCursor:rows.length>limit?String(data.at(-1).uid):null};
    };
  return mode==='public'?withPublicLocRead({scope},read):
    withAuthorizedLocRead({scope,writeScopes:[scope]},read);
}
