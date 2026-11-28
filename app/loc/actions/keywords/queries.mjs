'use server';
import {withKeywordScope} from './context.mjs';
import {readKeywordClasses,readKeywordStatistics,readKeywordCatalog,
  readKeywordDaily,readKeywordWorkspace,readKeywordAnalysisCompletion,
  suggestKeywordPatterns} from '../../keywords/sql-service.mjs';
import {queryLucusArticles} from '../../keywords/lucus-search.mjs';
import {portableRelation} from '../../providers/sql-engine-ports.mjs';
import {KEYWORD_DISCOVERY_MAX_ROWS} from '../../query/query-batch-size.mjs';
import {assertZModelSelectRows} from '../../../../packages/zenstack/import-validation.mjs';
import {scopeTableName} from '../../../../packages/zenstack/scope-table-names.mjs';

const UID=/^[A-Za-z0-9]{8}$/;
const ATTEMPT=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const DISCOVERY_COLUMNS=Object.freeze(['uid','date','title','content']);
function exact(value,keys){
  return value&&typeof value==='object'&&!Array.isArray(value)&&
    Object.keys(value).every(key=>keys.includes(key));
}
function filters({startDate='',endDate='',source=''}={}){
  const start=String(startDate||''),end=String(endDate||''),from=String(source||'');
  if(start&&!DAY.test(start)||end&&!DAY.test(end)||start&&end&&start>end||from.length>120)
    throw Error('Invalid Keyword filters');
  return {start,end,source:from};
}
function validClassUid(value){
  const uid=String(value||'');
  if(!UID.test(uid))throw Error('Invalid Keyword Class');
  return uid;
}
function validScopeId(value){
  if(typeof value!=='string')throw Error('Invalid Keyword Scope');
  const scope=value.trim().toLowerCase();
  if(!SCOPE.test(scope))throw Error('Invalid Keyword Scope');
  return scope;
}
function keywordGalaxy(scope,port){
  return portableRelation(scopeTableName(scope,'galaxy'),port.engine,
    port.namespace||(port.engine==='postgres'?'silver':'dbo'));
}

// This owner-started discovery scan reads only a fixed, minimal Galaxy
// projection. Each bounded page rechecks the JS Scope grant and opens its own
// direct connection; it is not exposed through an HTTP query dispatcher.
export async function queryKeywordDiscoveryCount(value){
  const scopeId=validScopeId(value);
  return withKeywordScope(scopeId,{write:true,owner:true},async({db,scope,port})=>{
    const row=await db.selectFrom(keywordGalaxy(scope,port))
      .select(eb=>eb.fn.count('uid').as('total')).executeTakeFirst();
    const total=Number(row?.total??0);
    if(!Number.isSafeInteger(total)||total<0)
      throw Error('Keyword discovery count is invalid');
    return total;
  });
}

export async function queryKeywordDiscoveryPage(args={}){
  const allowed=['p_scope_id','p_mode','p_after_date','p_after_uid','p_limit'];
  if(!exact(args,allowed))throw Error('Invalid Keyword discovery page');
  const scopeId=validScopeId(args.p_scope_id);
  const mode=args.p_mode;
  const afterDate=args.p_after_date??null,afterUid=args.p_after_uid??null;
  const limit=args.p_limit;
  if(typeof mode!=='string'||!['dated','undated'].includes(mode)||
    afterDate!==null&&(typeof afterDate!=='string'||!DAY.test(afterDate))||
    afterUid!==null&&(typeof afterUid!=='string'||!UID.test(afterUid))||
    mode==='undated'&&afterDate!==null||
    mode==='dated'&&(afterDate===null)!==(afterUid===null)||
    !Number.isSafeInteger(limit)||limit<1||limit>KEYWORD_DISCOVERY_MAX_ROWS)
    throw Error('Invalid Keyword discovery page');
  return withKeywordScope(scopeId,{write:true,owner:true},async({db,scope,port})=>{
    const table=keywordGalaxy(scope,port);
    let query=db.selectFrom(table).select(DISCOVERY_COLUMNS)
      .orderBy(mode==='dated'?'date':'uid','asc');
    if(mode==='dated'){
      query=query.where('date','is not',null);
      if(afterDate!==null){
        // Keep the date lower bound for the existing index while preserving
        // the strict date/UID cursor with no duplicate boundary rows.
        query=query.where('date','>=',afterDate).where(eb=>eb.or([
          eb('date','>',afterDate),
          eb.and([eb('date','=',afterDate),eb('uid','>',afterUid)])
        ]));
      }
      query=query.orderBy('uid','asc');
    }else{
      query=query.where('date','is',null);
      if(afterUid!==null)query=query.where('uid','>',afterUid);
    }
    const rows=await query.limit(limit).execute();
    assertZModelSelectRows('silver.'+scopeTableName(scope,'galaxy'),DISCOVERY_COLUMNS,rows);
    return {data:rows,count:rows.length};
  });
}

export async function queryKeywordClasses(args={}){
  if(!exact(args,['scopeId']))throw Error('Invalid Keyword class request');
  const {scopeId}=args;
  return withKeywordScope(scopeId,{},({db,scope,owner})=>
    readKeywordClasses(db,scope,{owner}));
}

export async function queryKeywordStatistics(args={}){
  if(!exact(args,['scopeId','classUid','startDate','endDate','source']))
    throw Error('Invalid Keyword statistics request');
  const {scopeId,classUid}=args,uid=validClassUid(classUid);
  const range=filters(args);
  return withKeywordScope(scopeId,{},({db,scope,owner,port})=>
    readKeywordStatistics(db,scope,uid,{owner,...range,
      engine:port.engine,namespace:port.namespace}));
}

export async function queryKeywordCatalog(args={}){
  if(!exact(args,['scopeId','classUid']))throw Error('Invalid Keyword catalog request');
  const {scopeId,classUid}=args;
  const uid=validClassUid(classUid);
  return withKeywordScope(scopeId,{},({db,scope,owner})=>
    readKeywordCatalog(db,scope,uid,{owner}));
}

export async function queryKeywordDaily(args={}){
  if(!exact(args,['scopeId','classUid','startDate','endDate','source','places']))
    throw Error('Invalid Keyword daily request');
  const {scopeId,classUid}=args,uid=validClassUid(classUid);
  const range=filters(args),places=args.places??null;
  if(places!==null&&(!Array.isArray(places)||places.length>100||
    places.some(value=>typeof value!=='string'||value.length>200)))
    throw Error('Invalid Keyword place filter');
  return withKeywordScope(scopeId,{},({db,scope,owner,port})=>
    readKeywordDaily(db,scope,uid,{owner,...range,places,
      engine:port.engine,namespace:port.namespace}));
}

export async function queryKeywordWorkspace(args={}){
  if(!exact(args,['scopeId','cursor','limit']))
    throw Error('Invalid Keyword editor page');
  const {scopeId,cursor='',limit=250}=args;
  if(typeof cursor!=='string'||cursor&&!UID.test(cursor)||
    !Number.isSafeInteger(limit)||limit<1||limit>250)
    throw Error('Invalid Keyword editor page');
  return withKeywordScope(scopeId,{write:true,owner:true},({db,scope})=>
    readKeywordWorkspace(db,scope,{cursor,limit}));
}

export async function queryKeywordAnalysisCompletion(args={}){
  if(!exact(args,['scopeId','classUid','attemptId']))
    throw Error('Invalid Keyword analysis status request');
  const {scopeId,classUid,attemptId}=args;
  const uid=validClassUid(classUid);
  if(!ATTEMPT.test(String(attemptId||'')))throw Error('Invalid Keyword analysis attempt');
  return withKeywordScope(scopeId,{write:true,owner:true},({db,scope})=>
    readKeywordAnalysisCompletion(db,scope,uid,attemptId));
}

export async function queryKeywordSuggestions(args={}){
  if(!exact(args,['scopeId','query']))throw Error('Invalid Keyword suggestion request');
  const {scopeId,query=''}=args;
  const text=String(query||'');
  if(text.length>120)throw Error('Invalid Keyword suggestion request');
  return withKeywordScope(scopeId,{write:true,owner:true},({db,scope})=>
    suggestKeywordPatterns(db,[scope],text,{ownerScopes:new Set([scope])}));
}

export async function queryKeywordAnchorArticles(args={}){
  const allowed=['scopeId','uid','type','offset','limit','sortDirection',
    'startDate','endDate','contentType','sourceFilter'];
  if(!exact(args,allowed))throw Error('Invalid Anchor navigation request');
  const offset=args.offset??0,limit=args.limit??20;
  const startDate=String(args.startDate||''),endDate=String(args.endDate||'');
  const sourceFilter=String(args.sourceFilter||'');
  const contentType=String(args.contentType||'');
  if(!UID.test(String(args.uid||''))||
    !['date','point','item','pattern'].includes(String(args.type||''))||
    !Number.isSafeInteger(offset)||offset<0||offset>200000||
    !Number.isSafeInteger(limit)||limit<1||limit>100||
    !['asc','desc'].includes(String(args.sortDirection||'desc'))||
    startDate&&!DAY.test(startDate)||endDate&&!DAY.test(endDate)||
    startDate&&endDate&&startDate>endDate||sourceFilter.length>150||
    !['','galaxy','lyrics_work','text_work'].includes(contentType))
    throw Error('Invalid Anchor navigation request');
  return withKeywordScope(args.scopeId,{},({db,scope,owner,port})=>
    queryLucusArticles(db,{scopeId:scope,uid:String(args.uid||''),
      type:String(args.type||''),owner,offset,
      limit,sortDirection:String(args.sortDirection||'desc'),
      startDate,endDate,
      contentType,
      sourceFilter,engine:port.engine,namespace:port.namespace}));
}
