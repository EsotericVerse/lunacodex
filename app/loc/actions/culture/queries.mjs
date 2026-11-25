'use server';
import {withAuthorizedLocRead,withPublicLocRead} from '../read-context.mjs';
import {portableRelation} from '../../providers/sql-engine-ports.mjs';
import {galaxyReadColumns} from '../../../../packages/zenstack/galaxy-read-models.mjs';
import {ANCHOR_TYPE_GROUPS} from '../../../../packages/zenstack/anchor-hierarchy.mjs';
import {assertZModelAnchorFeatureRows,assertZModelSelectRows}
  from '../../../../packages/zenstack/import-validation.mjs';
import {MAX_ROWS,TIME_ANCHOR_MAX_PAGE_ROWS}
  from '../../query/query-batch-size.mjs';
import {readDateRangeAggregates}
  from '../../query/date-range-aggregate.mjs';

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
    !['culture_anchors','culture_density'].includes(kind))
    throw Error('Invalid Culture query');
  const start=date(params.get('start')),end=date(params.get('end'));
  if(kind==='culture_density'&&(!start||!end||start>end)||
    kind==='culture_anchors'&&(start||end))
    throw Error('Invalid Culture query range');
  return withPublicLocRead({scope,modelCache:{model:kind,args:[start,end]}},
    async(db,port)=>{
    if(kind==='culture_anchors'){
      const table=relation(scope,'anchor',port);
      const rows=await db.selectFrom(table).select(['uid','type','title','attr'])
        .where('type','in',ANCHOR_TYPE_GROUPS.time)
        .where('invisible','=',false).execute();
      assertZModelSelectRows(port.namespace+'.'+scope+'_anchor',
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

export async function queryTimeAnchors({scope:scopeValue,mode='public',
  cursor='',limit=MAX_ROWS}={}){
  const scope=id(scopeValue);
  if(!['public','editor'].includes(mode)||typeof cursor!=='string'||
    cursor&&!UID.test(cursor)||!Number.isSafeInteger(limit)||limit<1||
    limit>TIME_ANCHOR_MAX_PAGE_ROWS)
    throw Error('Invalid TimeAnchor page');
  const read=async(db,port)=>{
      let query=db.selectFrom(relation(scope,'anchor',port))
        .select(['uid','type','title','description','attr','invisible'])
        .where('type','in',ANCHOR_TYPE_GROUPS.time)
        .orderBy('uid','asc').limit(limit+1);
      if(mode==='public')query=query.where('invisible','=',false);
      if(cursor)query=query.where('uid','>',cursor);
      const rows=await query.execute();
      const data=assertZModelAnchorFeatureRows(rows.slice(0,limit));
      return {data,nextCursor:rows.length>limit?String(data.at(-1).uid):null};
    };
  return mode==='public'?withPublicLocRead({scope,modelCache:{
    model:'time_anchors',args:[cursor,limit]}},read):
    withAuthorizedLocRead({scope,writeScopes:[scope]},read);
}
