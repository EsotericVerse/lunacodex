// LOC Pages fixed-purpose Keyword API. No generic SQL Gateway and no
// database credentials are sent to browsers. Every private request carries
// a cryptographically verified LOC Auth Scope delegation.
import {directMcpKysely} from '../../app/loc/mcp/native-kysely.mjs';
import {bindLocAuthorization,canLocAccess} from '../../app/loc/providers/loc-authorization.mjs';
import {verifiedIdentity} from '../_loc-delegation.mjs';
import {readLocAccess} from '../../app/loc/permissions/loc_access.mjs';
import {
  readKeywordClasses,readKeywordStatistics,readKeywordCatalog,readKeywordDaily,
  suggestKeywordPatterns,analyzeKeywordScope,resetKeywordScope,
  saveKeywordItem,deleteKeywordItem,synchronizeKeywordLibrary
} from '../../app/loc/keyword-sql-service.mjs';
import {queryAnchorArticles} from '../../app/loc/keyword-anchor-search.mjs';

const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const UID=/^[A-Za-z0-9]{8}$/;
const OPERATIONS=new Set(['analyze','reset','classes','catalog','summary','stats','suggest',
  'anchorSearch','saveItem','deleteItem','syncLibrary']);
function respond(data,status=200){
  return new Response(JSON.stringify(data),{
    status,headers:{'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store','x-content-type-options':'nosniff'}
  });
}
const error=(message,status=400)=>{
  const e=new Error(message);e.httpStatus=status;throw e;
};
async function permission(db,role,claims,scope){
  return db.transaction().execute(async trx=>{
    bindLocAuthorization(trx,{role,claims});
    return canLocAccess(trx,'scope',scope);
  });
}

export async function onRequestPost(context){
  try{
    const request=context.request;
    if(Number(request.headers.get('content-length')||0)>16000)
      error('Keyword request too large',413);
    const raw=await request.text();
    if(raw.length>16000)error('Keyword request too large',413);
    let input;
    try{input=JSON.parse(raw);}catch{error('Invalid Keyword request JSON');}
    if(!input||typeof input!=='object'||Array.isArray(input)||
       !OPERATIONS.has(input.operation)||!input.args||
       typeof input.args!=='object'||Array.isArray(input.args))
      error('Unknown Keyword operation');
    const {operation,args}=input;
    const {role,claims}=await verifiedIdentity(request,context.env);
    const scope=String(args.scopeId||'');
    if(operation!=='suggest'&&!SCOPE.test(scope))
      error('Invalid Keyword Scope');
    if(['catalog','stats','summary','analyze','reset'].includes(operation)&&
       !UID.test(String(args.classUid||'')))
      error('Invalid Keyword Class');
    // The existing Pages native Kysely connection is server-selected; never
    // accept a target URL, SQL dialect or credential from HTTP arguments.
    const entry=await directMcpKysely(context.env);
    const db=entry.db;
    // This is the independent database role decision, not LOC Auth.
    const rights=await readLocAccess(db,claims.email,{
      dialect:entry.dialect,engine:entry.engine,website:true
    });
    claims.me=rights.canWrite;
    claims.grants=rights.grants;
    let result;
    if(operation==='suggest'){
      // Management-only suggestion; a single verified Scope.
      if(!await permission(db,role,claims,scope))
        error('Scope Keyword management permission required',403);
      result=await suggestKeywordPatterns(db,[scope],String(args.query||''),{
        ownerScopes:new Set([scope])
      });
    }else{
      const owner=await permission(db,role,claims,scope);
      if(['analyze','reset','saveItem','deleteItem','syncLibrary'].includes(operation)){
        if(!owner)error('Scope Keyword management permission required',403);
        const authorizeTransaction=async trx=>{
          bindLocAuthorization(trx,{role,claims});
          if(!await canLocAccess(trx,'scope',scope))
            error('Scope Keyword authorization expired',403);
        };
        if(operation==='reset')
          result=await resetKeywordScope(db,scope,args.classUid,{authorizeTransaction});
        else if(operation==='analyze')
          result=await analyzeKeywordScope(db,scope,args.classUid,{authorizeTransaction});
        else if(operation==='saveItem')
          result=await saveKeywordItem(db,scope,args.item,{authorizeTransaction});
        else if(operation==='deleteItem')
          result=await deleteKeywordItem(db,scope,args.itemUid,{authorizeTransaction});
        else result=await synchronizeKeywordLibrary(db,scope,{authorizeTransaction});
      }else if(operation==='anchorSearch'){
        result=await queryAnchorArticles(db,{scopeId:scope,
          uid:String(args.uid||''),type:String(args.type||''),owner,
          offset:args.offset??0,limit:args.limit??20,
          sortDirection:String(args.sortDirection||'desc'),
          startDate:String(args.startDate||''),endDate:String(args.endDate||''),
          contentType:String(args.contentType||''),sourceFilter:String(args.sourceFilter||'')});
      }else if(operation==='classes'){
        result=await readKeywordClasses(db,scope,{owner});
      }else if(operation==='catalog'){
        result=await readKeywordCatalog(db,scope,args.classUid,{owner});
      }else{
        const opt={owner,start:String(args.startDate||''),
          end:String(args.endDate||''),source:String(args.source||'')};
        result=operation==='stats'
          ?await readKeywordStatistics(db,scope,args.classUid,opt)
          :await readKeywordDaily(db,scope,args.classUid,opt);
      }
    }
    return respond({data:result});
  }catch(e){
    const status=Number.isInteger(e?.httpStatus)?e.httpStatus:
      Number.isInteger(e?.status)?e.status:503;
    return respond({error:status<500?String(e?.message||'Keyword request rejected'):
      '關鍵詞資料來源目前無法處理此請求'},status);
  }
}
export function onRequestGet(){return respond({error:'POST required'},405);}
export function onRequestOptions(){return respond({error:'POST required'},405);}
