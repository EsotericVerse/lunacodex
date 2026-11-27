'use server';
import {withAuthorizedLocRead} from '../read-context.mjs';
import {readImportSitePresence,readImportSiteCandidates,
  readImportOccupiedTimes,readImportAnchorPage,readImportMediaCandidates}
  from '../../providers/kysely-management.mjs';
import {sql} from 'kysely';
import {portableRelation} from '../../providers/sql-engine-ports.mjs';
import {MAX_ROWS} from '../../query/query-batch-size.mjs';
import {galaxyReadColumnsFor}
  from '../../../../packages/zenstack/galaxy-read-models.mjs';
import {assertZModelSelectRows}
  from '../../../../packages/zenstack/import-validation.mjs';

const UID=/^[A-Za-z0-9]{8}$/;
const SITE_ID_COLUMNS=Object.freeze([...new Set([
  ...galaxyReadColumnsFor('GalaxyUidRead'),'site_id','keyword'
])]);
const TIME_COLUMNS=Object.freeze(['uid','site','site_id','createtime','date']);
const ARTICLE_UID_COLUMNS=SITE_ID_COLUMNS;
const linkedMediaColumns=Object.freeze(['uid','url','media_link']);

function importScope(args){
  const scope=String(args?.p_scope_id||'').trim().toLowerCase();
  if(!/^[a-z][a-z0-9]{0,14}$/.test(scope)||scope==='admin'||scope==='local')
    throw Error('Invalid LOC import Scope');
  return scope;
}

async function withImportScope(args,read){
  const scope=importScope(args);
  return withAuthorizedLocRead({scope,writeScopes:[scope]},async(db,port)=>
    read(db,args,port,scope));
}

function galaxyTable(scope,port){
  return portableRelation(scope+'_galaxy',port.engine,
    port.namespace||(port.engine==='postgres'?'silver':'dbo'));
}
function pageLimit(value,maximum=MAX_ROWS){
  const limit=Number(value);
  if(!Number.isSafeInteger(limit)||limit<1||limit>maximum)
    throw Error('Invalid import read page size');
  return limit;
}
function uidList(value,{min=1,max=MAX_ROWS}={}){
  if(!Array.isArray(value)||value.length<min||value.length>max||
    value.some(uid=>typeof uid!=='string'||!UID.test(uid)))
    throw Error('Invalid import UID list');
  return [...new Set(value)];
}
function stringList(value,{min=1,max=200,length=2048}={}){
  if(!Array.isArray(value)||value.length<min||value.length>max||
    value.some(item=>typeof item!=='string'||!item.length||item.length>length))
    throw Error('Invalid import key list');
  return [...new Set(value)];
}

export async function queryImportSitePresence(args={}){
  return withImportScope(args,readImportSitePresence);
}

export async function queryImportSiteIdCandidates(args={}){
  return withImportScope(args,db=>readImportSiteCandidates(db,
    'import_site_id_candidates',args));
}

export async function queryImportCreatedAtCandidates(args={}){
  return withImportScope(args,db=>readImportSiteCandidates(db,
    'import_created_at_candidates',args));
}

export async function queryImportOccupiedTimes(args={}){
  return withImportScope(args,readImportOccupiedTimes);
}

export async function queryImportAnchorPage(args={}){
  return withImportScope(args,readImportAnchorPage);
}

export async function queryImportMediaCandidates(args={}){
  return withImportScope(args,readImportMediaCandidates);
}

export async function queryImportGalaxyIdentityRows(args={}){
  const scope=importScope(args),uids=uidList(args.p_uids);
  return withImportScope(args,async(db,_args,port)=>{
    const rows=await db.selectFrom(galaxyTable(scope,port))
      .select(ARTICLE_UID_COLUMNS).where('uid','in',uids).execute();
    assertZModelSelectRows('silver.'+scope+'_galaxy',ARTICLE_UID_COLUMNS,rows);
    return {data:rows,count:rows.length};
  });
}

export async function queryImportLinkedMediaRows(args={}){
  const scope=importScope(args),uids=uidList(args.p_uids);
  return withImportScope(args,async(db,_args,port)=>{
    const rows=await db.selectFrom(galaxyTable(scope,port))
      .select(linkedMediaColumns).where('uid','in',uids).execute();
    assertZModelSelectRows('silver.'+scope+'_galaxy',linkedMediaColumns,rows);
    return {data:rows,count:rows.length};
  });
}

export async function queryImportImageGalaxyPage(args={}){
  const scope=importScope(args),urls=stringList(args.p_urls,{max:200,length:8192});
  const limit=pageLimit(args.p_limit);
  const after=args.p_after_uid??null;
  if(after!==null&&!UID.test(String(after)))throw Error('Invalid import UID cursor');
  return withImportScope(args,async(db,_args,port)=>{
    const table=galaxyTable(scope,port);
    let query=db.selectFrom(table).select(['uid','source_id','url'])
      .where('url','in',urls).orderBy('uid','asc').limit(limit);
    if(after!==null)query=query.where('uid','>',after);
    const rows=await query.execute();
    assertZModelSelectRows('silver.'+scope+'_galaxy',['uid','source_id','url'],rows);
    return {data:rows,count:rows.length};
  });
}

export async function queryImportUidConflicts(args={}){
  const scope=importScope(args),uids=uidList(args.p_uids);
  return withImportScope(args,async(db,_args,port)=>{
    const rows=await db.selectFrom(galaxyTable(scope,port)).select('uid')
      .where('uid','in',uids).execute();
    assertZModelSelectRows('silver.'+scope+'_galaxy',['uid'],rows);
    return {data:rows.map(row=>String(row.uid)),count:rows.length};
  });
}

export async function queryImportSiteIdRows(args={}){
  const scope=importScope(args),site=String(args.p_site||'').trim();
  const ids=stringList(args.p_site_ids,{max:200,length:4096});
  const limit=pageLimit(args.p_limit),after=args.p_after_uid??null;
  if(!site||site.length>512||after!==null&&!UID.test(String(after)))
    throw Error('Invalid import source identity page');
  return withImportScope(args,async(db,_args,port)=>{
    const table=galaxyTable(scope,port);
    let query=db.selectFrom(table).select(SITE_ID_COLUMNS)
      .where(sql`lower(${sql.ref('site')})`,'=',site.toLowerCase())
      .where('site_id','in',ids).orderBy('uid','asc').limit(limit);
    if(after!==null)query=query.where('uid','>',after);
    const rows=await query.execute();
    assertZModelSelectRows('silver.'+scope+'_galaxy',SITE_ID_COLUMNS,rows);
    return {data:rows,count:rows.length};
  });
}

export async function queryImportSourceTimePage(args={}){
  const scope=importScope(args),site=String(args.p_site||'').trim();
  const undated=args.p_undated===true,after=args.p_after_uid??null;
  const limit=pageLimit(args.p_limit);
  const from=String(args.p_from_date||''),to=String(args.p_to_date||'');
  const day=/^\d{4}-\d{2}-\d{2}$/;
  if(!site||site.length>512||after!==null&&!UID.test(String(after))||
    !undated&&(!day.test(from)||!day.test(to)||from>to)||
    Object.keys(args).some(key=>!['p_scope_id','p_site','p_undated',
      'p_after_uid','p_limit','p_from_date','p_to_date'].includes(key)))
    throw Error('Invalid import source-time page');
  return withImportScope(args,async(db,_args,port)=>{
    let query=db.selectFrom(galaxyTable(scope,port)).select(TIME_COLUMNS)
      .where(sql`lower(${sql.ref('site')})`,'=',site.toLowerCase())
      .orderBy('uid','asc').limit(limit);
    if(undated)query=query.where('date','is',null);
    else query=query.where('date','>=',from).where('date','<=',to);
    if(after!==null)query=query.where('uid','>',after);
    const rows=await query.execute();
    assertZModelSelectRows('silver.'+scope+'_galaxy',TIME_COLUMNS,rows);
    return {data:rows,count:rows.length};
  });
}

export async function queryImportOccupiedDatePage(args={}){
  const scope=importScope(args),days=stringList(args.p_dates,{max:40,length:10});
  const limit=pageLimit(args.p_limit),afterDate=args.p_after_date??null;
  const afterUid=args.p_after_uid??null;
  if(days.some(day=>!/^\d{4}-\d{2}-\d{2}$/.test(day))||
    afterDate!==null&&!/^\d{4}-\d{2}-\d{2}$/.test(String(afterDate))||
    afterDate!==null&&!UID.test(String(afterUid||''))||
    afterUid!==null&&!UID.test(String(afterUid)))
    throw Error('Invalid occupied import date cursor');
  return withImportScope(args,async(db,_args,port)=>{
    let query=db.selectFrom(galaxyTable(scope,port)).select(['uid','createtime','date'])
      .where('date','in',days).orderBy('date','asc').orderBy('uid','asc')
      .limit(limit);
    if(afterDate!==null){
      query=query.where(eb=>eb.or([
        eb('date','>',afterDate),
        eb.and([eb('date','=',afterDate),eb('uid','>',afterUid)])
      ]));
    }
    const rows=await query.execute();
    assertZModelSelectRows('silver.'+scope+'_galaxy',['uid','createtime','date'],rows);
    return {data:rows,count:rows.length};
  });
}

export async function queryImportUndatedTimesPage(args={}){
  const scope=importScope(args),limit=pageLimit(args.p_limit);
  const after=args.p_after_uid??null;
  if(after!==null&&!UID.test(String(after)))throw Error('Invalid import UID cursor');
  return withImportScope(args,async(db,_args,port)=>{
    let query=db.selectFrom(galaxyTable(scope,port)).select(['uid','createtime'])
      .where('date','is',null).orderBy('uid','asc').limit(limit);
    if(after!==null)query=query.where('uid','>',after);
    const rows=await query.execute();
    assertZModelSelectRows('silver.'+scope+'_galaxy',['uid','createtime'],rows);
    return {data:rows,count:rows.length};
  });
}

export async function queryImportPointUidRows(args={}){
  const scope=importScope(args),uids=uidList(args.p_uids);
  return withImportScope(args,async(db,_args,port)=>{
    const table=portableRelation(scope+'_anchor',port.engine,
      port.namespace||(port.engine==='postgres'?'silver':'dbo'));
    const columns=['uid','type','title','attr','createtime'];
    const rows=await db.selectFrom(table).select(columns)
      .where('uid','in',uids).where('type','=','point').execute();
    assertZModelSelectRows('silver.'+scope+'_anchor',columns,rows);
    return {data:rows,count:rows.length};
  });
}

export async function queryImportAnchorArticlesPage(args={}){
  const scope=importScope(args),limit=pageLimit(args.p_limit);
  const after=args.p_after_uid??null;
  if(after!==null&&!UID.test(String(after)))throw Error('Invalid import UID cursor');
  return withImportScope(args,async(db,_args,port)=>{
    const columns=['uid','title','location','place_id','date','createtime'];
    const table=galaxyTable(scope,port);
    let query=db.selectFrom(table).select(columns)
      .where(eb=>eb.or([
        eb.and([eb('location','is not',null),eb('location','!=','')]),
        eb.and([eb('place_id','is not',null),eb('place_id','!=','')])
      ])).orderBy('uid','asc').limit(limit);
    if(after!==null)query=query.where('uid','>',after);
    const rows=await query.execute();
    assertZModelSelectRows('silver.'+scope+'_galaxy',columns,rows);
    return {data:rows,count:rows.length};
  });
}
