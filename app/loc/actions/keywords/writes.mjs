'use server';
import {withKeywordScope} from './context.mjs';
import {analyzeKeywordScope,resetKeywordScope,saveKeywordItem,
  deleteKeywordItem,setKeywordClassShare} from '../../keywords/sql-service.mjs';

const UID=/^[A-Za-z0-9]{8}$/;
const ATTEMPT=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function analysisInput(args={}){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(key=>!['scopeId','classUid','analysisEpoch','attemptId'].includes(key)))
    throw Object.assign(new Error('Invalid Keyword analysis request'),{httpStatus:400});
  const classUid=String(args.classUid||'');
  if(!UID.test(classUid)||!Number.isSafeInteger(args.analysisEpoch)||
    args.analysisEpoch<1||!ATTEMPT.test(String(args.attemptId||'')))
    throw Object.assign(new Error('Invalid Keyword analysis generation'),{httpStatus:400});
  return {classUid,analysisEpoch:args.analysisEpoch,
    attemptId:String(args.attemptId||'')};
}

export async function runKeywordAnalysisBatch(args={}){
  try{
    const {classUid,analysisEpoch,attemptId}=analysisInput(args);
    return await withKeywordScope(args.scopeId,{write:true,owner:true},
      ({db,scope,authorizeTransaction})=>analyzeKeywordScope(db,scope,classUid,{
        authorizeTransaction,attemptId,analysisEpoch
      }));
  }catch(error){
    const status=Number(error?.httpStatus);
    if(status>=400&&status<500)return {__keywordError:{status,
      message:String(error?.message||'Keyword analysis rejected')}};
    throw error;
  }
}

export async function resetKeywordClass(args={}){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(key=>!['scopeId','classUid'].includes(key)))
    throw Error('Invalid Keyword reset request');
  const {scopeId,classUid}=args;
  const uid=String(classUid||'');
  if(!UID.test(uid))throw Error('Invalid Keyword Class');
  return withKeywordScope(scopeId,{write:true,owner:true},
    ({db,scope,authorizeTransaction})=>resetKeywordScope(db,scope,uid,
      {authorizeTransaction}));
}

export async function saveKeywordItemAction(args={}){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(key=>!['scopeId','item'].includes(key)))
    throw Error('Invalid Keyword Item request');
  const {scopeId,item}=args;
  if(!item||typeof item!=='object'||Array.isArray(item)||
    Object.keys(item).some(key=>!['uid','name','desc','words','mode','parentUid'].includes(key)))
    throw Error('Invalid Keyword Item');
  return withKeywordScope(scopeId,{write:true,owner:true},
    ({db,scope,authorizeTransaction})=>saveKeywordItem(db,scope,item,
      {authorizeTransaction}));
}

export async function deleteKeywordItemAction(args={}){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(key=>!['scopeId','itemUid'].includes(key)))
    throw Error('Invalid Keyword Item delete request');
  const {scopeId,itemUid}=args;
  const uid=String(itemUid||'');
  if(!UID.test(uid))throw Error('Invalid Item UID');
  return withKeywordScope(scopeId,{write:true,owner:true},
    ({db,scope,authorizeTransaction})=>deleteKeywordItem(db,scope,uid,
      {authorizeTransaction}));
}

export async function setKeywordClassShareAction(args={}){
  if(!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(key=>!['scopeId','classUid','enabled'].includes(key)))
    throw Error('Invalid Keyword sharing request');
  const {scopeId,classUid,enabled}=args;
  const uid=String(classUid||'');
  if(!UID.test(uid)||typeof enabled!=='boolean')
    throw Error('Invalid Keyword sharing choice');
  return withKeywordScope(scopeId,{write:true,owner:true},
    ({db,scope,authorizeTransaction})=>setKeywordClassShare(db,scope,uid,enabled,
      {authorizeTransaction}));
}
