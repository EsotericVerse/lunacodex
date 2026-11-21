// LOC Pages fixed-purpose Keyword API. No generic SQL Gateway and no
// database credentials are sent to browsers. Every private request carries
// a cryptographically verified LOC Auth Scope delegation.
import {directMcpKysely,closeLocDatabase,bindLocRequestAbort} from '../../app/loc/mcp/native-kysely.mjs';
import {bindLocAuthorization,canLocAccess} from '../../app/loc/providers/loc-authorization.mjs';
import {verifiedIdentity} from '../_loc-delegation.mjs';
import {readLocAccess} from '../../app/loc/permissions/loc_access.mjs';
import {
  readKeywordClasses,readKeywordStatistics,readKeywordCatalog,readKeywordDaily,
  suggestKeywordPatterns,analyzeKeywordScope,resetKeywordScope,
  readKeywordAnalysisCompletion,saveKeywordItem,deleteKeywordItem,synchronizeKeywordLibrary,setKeywordClassShare
} from '../../app/loc/keywords/sql-service.mjs';
import {queryAnchorArticles} from '../../app/loc/keywords/anchor-search.mjs';

const SCOPE=/^[a-z][a-z0-9]{0,14}$/;
const UID=/^[A-Za-z0-9]{8}$/;
const ATTEMPT=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const OPERATIONS=new Set(['analyze','analyzeStatus','reset','classes','catalog','summary','stats','suggest',
  'anchorSearch','saveItem','deleteItem','syncLibrary','setClassShare']);
function respond(data,status=200){
  return new Response(JSON.stringify(data),{
    status,headers:{'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store','x-content-type-options':'nosniff'}
  });
}
const error=(message,status=400)=>{
  const e=new Error(message);e.httpStatus=status;throw e;
};
export async function onRequestPost(context){
  let stage='request';
  let entry=null;
  let releaseAbort=()=>{};
  let streamOwnsConnection=false;
  try{
    const request=context.request;
    const {waitUntil}=context;
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
    stage='identity';
    const {role,claims}=await verifiedIdentity(request,context.env);
    const scope=String(args.scopeId||'');
    if(operation!=='suggest'&&!SCOPE.test(scope))
      error('Invalid Keyword Scope');
    if(['catalog','stats','summary','analyze','analyzeStatus','reset'].includes(operation)&&
       !UID.test(String(args.classUid||'')))
      error('Invalid Keyword Class');
    if((operation==='analyzeStatus'||operation==='analyze'&&args.attemptId)&&
       !ATTEMPT.test(String(args.attemptId||'')))
      error('Invalid Keyword analysis attempt');
    // The existing Pages native Kysely connection is server-selected; never
    // accept a target URL, SQL dialect or credential from HTTP arguments.
    stage='database';
    entry=await directMcpKysely(context.env,'',{waitUntil});
    releaseAbort=bindLocRequestAbort(entry,request.signal);
    const db=entry.db;
    stage='authorization';
    // One active Registry read and one Scope grant decision in the same SQL
    // transaction; later keyword batches retain their existing boundaries.
    // A short Keyword write owns its own SQL Transaction. Resolve its ONE
    // api.manage grant inside that transaction, not in an earlier connection
    // lease. Long analysis remains explicitly checkpointed/batched.
    const singleWrite=['reset','saveItem','deleteItem','syncLibrary','setClassShare']
      .includes(operation);
    const verifyScope=async trx=>{
      const rights=await readLocAccess(trx,claims.email,{
        dialect:entry.dialect,engine:entry.engine,website:true,
        transactional:true
      });
      claims.me=rights.canWrite;
      claims.grants=rights.grants;
      bindLocAuthorization(trx,{role,claims});
      if(!canLocAccess(trx,'scope',scope))
        error('Scope Keyword management permission required',403);
      return true;
    };
    const owner=singleWrite?false:
      await db.transaction().execute(verifyScope);
    stage='operation:'+operation;
    let result;
    if(operation==='suggest'){
      // Management-only suggestion; a single verified Scope.
      if(!owner)
        error('Scope Keyword management permission required',403);
      result=await suggestKeywordPatterns(db,[scope],String(args.query||''),{
        ownerScopes:new Set([scope])
      });
    }else{

      if(operation==='analyzeStatus'){
        if(!owner)error('Scope Keyword management permission required',403);
        result=await readKeywordAnalysisCompletion(db,scope,args.classUid,args.attemptId);
      }else if(['analyze','reset','saveItem','deleteItem','syncLibrary','setClassShare'].includes(operation)){
        if(!singleWrite&&!owner)error('Scope Keyword management permission required',403);
        const authorizeTransaction=async trx=>{
          if(singleWrite)await verifyScope(trx);
          else{
            bindLocAuthorization(trx,{role,claims});
            if(!canLocAccess(trx,'scope',scope))
              error('Scope Keyword authorization expired',403);
          }
        };
        if(operation==='reset')
          result=await resetKeywordScope(db,scope,args.classUid,{authorizeTransaction});
        else if(operation==='analyze'){
          // Streaming is opt-in: preserve the ordinary JSON contract for all
          // existing callers. Analysis and authorization still run once.
          if(request.headers.get('accept')?.includes('application/x-ndjson')){
            const encoder=new TextEncoder();
            // The running stream, not the already-returned handler, owns SQL
            // until its analysis finishes or the client disconnects.
            const stream=new ReadableStream({
              start(controller){
                const emit=(kind,data)=>{
                  try{controller.enqueue(encoder.encode(JSON.stringify({kind,data})+'\n'));}
                  catch{/* A disconnected reader cannot change authorized writes. */}
                };
                // Keep long SQL/PELT phases from looking like a dead HTTP
                // connection. Heartbeats do not poll the DB or change progress.
                const heartbeat=setInterval(()=>emit('heartbeat',null),15000);
                emit('heartbeat',null);
                void (async()=>{
                  try{
                    const analyzed=await analyzeKeywordScope(db,scope,args.classUid,{
                      authorizeTransaction,onProgress:data=>emit('progress',data),
                      attemptId:String(args.attemptId||'')
                    });
                    emit('result',analyzed);
                  }catch(failure){
                    const status=Number.isInteger(failure?.httpStatus)
                      ?failure.httpStatus:503;
                    const code=String(failure?.code||failure?.cause?.code||'UNKNOWN');
                    console.error('[LOC keyword analysis]',{
                      code:/^[A-Za-z0-9_]{2,40}$/.test(code)?code:'UNKNOWN',
                      type:String(failure?.name||'Error').slice(0,40)
                    });
                    emit('error',{status,error:status<500
                      ?String(failure?.message||'分析請求被拒絕')
                      :'關鍵詞資料來源目前無法處理此請求'});
                  }finally{
                    clearInterval(heartbeat);
                    releaseAbort();
                    try{await closeLocDatabase(entry);}
                    catch(error){console.error('[LOC keyword stream cleanup]',{code:String(error?.code||'CLOSE_FAILED').slice(0,64)});}
                    try{controller.close();}catch{}
                  }
                })();
              },
              // Closing the page's stream interrupts the unfinished SQL job.
              // Its async finally closes the resource even when no result emits.
              cancel(){void entry?.pool?.abort?.();}
            });
            const response=new Response(stream,{headers:{
              'content-type':'application/x-ndjson; charset=utf-8',
              'cache-control':'no-store','x-content-type-options':'nosniff'
            }});
            streamOwnsConnection=true;
            return response;
          }
          result=await analyzeKeywordScope(db,scope,args.classUid,{
            authorizeTransaction,attemptId:String(args.attemptId||'')
          });
        }
        else if(operation==='saveItem')
          result=await saveKeywordItem(db,scope,args.item,{authorizeTransaction});
        else if(operation==='deleteItem')
          result=await deleteKeywordItem(db,scope,args.itemUid,{authorizeTransaction});
        else if(operation==='setClassShare')
          result=await setKeywordClassShare(db,scope,args.classUid,args.enabled,{authorizeTransaction});
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
    // Only fixed diagnostic categories leave the private backend. Never
    // leak database credentials, SQL text, article bodies, or exception text.
    const rawCode=String(e?.code||e?.cause?.code||'UNKNOWN');
    const code=/^[A-Za-z0-9_]{2,40}$/.test(rawCode)?rawCode:'UNKNOWN';
    if(status>=500)console.error('[LOC keyword API]',{
      stage,code,type:String(e?.name||'Error').slice(0,40)
    });
    return respond({
      error:status<500?String(e?.message||'Keyword request rejected'):
        '關鍵詞資料來源目前無法處理此請求',
      ...(status>=500?{stage,code}:{})
    },status);
  }finally{
    if(!streamOwnsConnection){
      releaseAbort();
      try{await closeLocDatabase(entry);}
      catch(error){console.error('[LOC keyword SQL cleanup]',{code:String(error?.code||'CLOSE_FAILED').slice(0,64)});}
    }
  }
}
export function onRequestGet(){return respond({error:'POST required'},405);}
export function onRequestOptions(){return respond({error:'POST required'},405);}
