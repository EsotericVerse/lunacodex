'use server';
import {withKeywordScope} from './context.mjs';
import {readKeywordClasses,readKeywordStatistics,readKeywordCatalog,
  readKeywordDaily,readKeywordWorkspace,readKeywordAnalysisCompletion,
  suggestKeywordPatterns} from '../../keywords/sql-service.mjs';
import {queryAnchorArticles} from '../../keywords/anchor-search.mjs';

const UID=/^[A-Za-z0-9]{8}$/;
const ATTEMPT=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const DAY=/^\d{4}-\d{2}-\d{2}$/;
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
  return withKeywordScope(scopeId,{},({db,scope,owner})=>
    readKeywordStatistics(db,scope,uid,{owner,...range}));
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
  return withKeywordScope(scopeId,{},({db,scope,owner})=>
    readKeywordDaily(db,scope,uid,{owner,...range,places}));
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
  return withKeywordScope(args.scopeId,{},({db,scope,owner})=>
    queryAnchorArticles(db,{scopeId:scope,uid:String(args.uid||''),
      type:String(args.type||''),owner,offset,
      limit,sortDirection:String(args.sortDirection||'desc'),
      startDate,endDate,
      contentType,
      sourceFilter}));
}
