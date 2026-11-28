import {flashMessage} from '../notifications/flash-message.js';
import {assertPlainGalaxyAttributes} from '../content/content-policy.js';
import {DB_QUERY_BATCH_SIZE,MAX_ROWS,HEAVY_QUERY_ROWS,ARTICLE_UID_PAGE_ROWS,IMPORT_WRITE_TARGET_BYTES} from '../query/query-batch-size.mjs';
import {clearAuthorization,readAuthorization,canAuthorizeLocAccess} from '../auth/authorization-runtime.mjs';
import {assertEditorSession} from '../auth/edit-session-ttl.mjs';
import {editorTransactionLease,assertEditorTransactionLease}
  from './editor-transaction-lifecycle.mjs';
import {invalidateScopedReadCache} from '../../../packages/zenstack/scoped-read-cache.mjs';
import {isScopedGalaxy,prepareGalaxyInsertRows,prepareGalaxyUpdateValues} from '../model/galaxy-able.mjs';
import {queryGalaxyDuplicates} from '../actions/galaxy/management-queries.mjs';
import {queryStatics,queryStaticsContent} from '../actions/statics/queries.mjs';
import {scopeTableDescriptor,scopeTableName} from '../../../packages/zenstack/scope-table-names.mjs';

// Database contract transports physical Galaxy/Anchor rows. Keyword Tree
// adapters may expose legacy lists for editor compatibility; new persistent
// relationships are child Anchor UIDs; Pattern stores no article postings.
// Do not revive retired Item/Group hit caches or build separate Keyword tables.
// Keyword read, write and reset use the shared MaxRows.
export {MAX_ROWS as KEYWORD_CLASSIFICATION_BATCH_SIZE,MAX_ROWS as KEYWORD_CLASSIFICATION_WRITE_BATCH_SIZE,MAX_ROWS as KEYWORD_CLASSIFICATION_WRITE_PAUSE_INTERVAL};
export const KEYWORD_CLASSIFICATION_WRITE_COOLDOWN_MS=1000;

// The existing management-write boundary enforces Galaxy metadata rules
// consistently for publisher, search, culture and import paths.
// MediaAnchor and Blocks are typed separately from Galaxy records.
function validateGalaxyWrite(table,values){
  if(scopeTableDescriptor(String(table||'').split('.').at(-1))?.kind!=='galaxy')return values;
  const {content:body,...attributes}=values||{};
  assertPlainGalaxyAttributes(attributes);
  return values;
}

export function createDatabaseClient({publicClient,authClient,auth}){
    if(!publicClient?.schema||!authClient?.schema||!auth?.getSession||!auth?.getUser||!auth?.signInWithOAuth||!auth?.signOut){
      throw new Error('Database adapter must implement public/authenticated clients and the account boundary');
    }
  function dbAuthRelation(table){
    const [schema,name]=String(table).split('.');
    return authClient.schema(schema).from(name);
  }

  function preflightWrite(table){
    // The local editor's idle lock is UI state only; no browser-made ACL.
    // Better Auth + ZModel/PolicyPlugin authorize every management write in
    // the trusted write handler and inside its SQL transaction. Ordinary
    // website writes call the handler in-process; the HTTP route is reserved
    // for the separately gated bulk-import path.
    // Keep this activity guard for the current editing UX, not as identity.
    if(typeof window!=='undefined')assertEditorSession(window.sessionStorage);
  }
  function invalidateRelevantAuthorization(scopeid,newEmail=''){
    const saved=readAuthorization();
    if(!saved)return;
    const changed=String(scopeid||'').trim().toLowerCase();
    const targetEmail=String(newEmail||'').trim().toLowerCase();
    if((changed&&saved.entries.some(row=>row.scopeid===changed))||
      (targetEmail&&targetEmail===saved.email))clearAuthorization();
  }
  // A failed write must never look saved: show a visible notice, then rethrow so the caller also sees the error.
  const WRITE_FAILED_NOTICE='儲存失敗或結果未確認，請重新讀取確認後再重試。';
  function withWriteNotice(run){
    return async(...args)=>{
      try{return await run(...args);}
      catch(error){
        if(error?.code!=='LOC_EDITOR_CANCELLED')flashMessage(WRITE_FAILED_NOTICE);
        throw error;
      }
    };
  }
  const managementWrite=withWriteNotice(managementWriteUnchecked);
  const transactionWrites=withWriteNotice(transactionWritesUnchecked);
  const insertRows=withWriteNotice(insertRowsUnchecked);
  // Import batch retries handle UID conflicts themselves. Keep auth checks and
  // failures, but do not flash a global notice for every bisected retry.
  const insertImportRows=async(table,rows,{onValidationProgress}={})=>{
    const lease=editorTransactionLease();
    assertEditorTransactionLease(lease);
    // Normalize once and validate the EXACT rows that reach Kysely. Legacy
    // source flags are expanded before the model-derived Zod parse, while
    // the original authoring/content guard still checks incoming attributes.
    // The private normalizedGalaxy flag does not cross the HTTP boundary.
    if(!isScopedGalaxy(table))return insertRowsUnchecked(table,rows,{importBatch:true});
    for(const row of rows)validateGalaxyWrite(table,row);
    const prepared=prepareGalaxyInsertRows(table,rows);
    const {assertZModelImportRows}=await import('../../../packages/zenstack/import-validation.mjs');
    assertZModelImportRows(table,prepared,{onProgress:onValidationProgress});
    assertEditorTransactionLease(lease);
    return insertRowsUnchecked(table,prepared,{normalizedGalaxy:true,importBatch:true});
  };
  const updateRows=withWriteNotice(updateRowsUnchecked);
  const deleteRows=withWriteNotice(deleteRowsUnchecked);
  // Import can have already committed earlier batches. Preserve the actual
  // error and partial-write diagnostics rather than claiming nothing was saved.
  const updateImportRows=updateImportRowsUnchecked;
  const copyRune66KeywordClass=withWriteNotice(copyRune66KeywordClassUnchecked);
  const moveScopeBlock=withWriteNotice(moveScopeBlockUnchecked);
  const deleteScope=withWriteNotice(deleteScopeUnchecked);
  const provisionScope=withWriteNotice(provisionScopeUnchecked);
  const manageScopeRegistry=withWriteNotice(manageScopeRegistryUnchecked);

  // A complete logical Save uses one trusted server write action. It checks
  // identity and api.manage once and runs all steps atomically.
  // Keywords and imports retain their own explicit large-batch protocols.
  async function transactionWritesUnchecked(operations){
    const lease=editorTransactionLease();
    assertEditorTransactionLease(lease);
    if(!Array.isArray(operations)||!operations.length)
      throw new Error('LOC transaction requires at least one write');
    preflightWrite();
    const normalized=operations.map(item=>{
      if(!item||typeof item!=='object'||Array.isArray(item))
        throw new Error('Invalid LOC transaction write');
      const table=item.p_table;
      const operation=item.p_operation;
      if(operation==='insert'){
        const rows=Array.isArray(item.p_rows)?item.p_rows:[];
        for(const row of rows)validateGalaxyWrite(table,row);
        return {...item,p_rows:isScopedGalaxy(table)
          ?prepareGalaxyInsertRows(table,rows):rows};
      }
      if(operation==='update'){
        validateGalaxyWrite(table,item.p_values);
        return {...item,p_values:isScopedGalaxy(table)
          ?prepareGalaxyUpdateValues(table,item.p_values):item.p_values};
      }
      return item;
    });
    assertEditorTransactionLease(lease);
    const {data,error,homeCacheSync}=await authClient.schema('silver').managedTransaction(normalized);
    assertEditorTransactionLease(lease);
    if(error)throw new Error(error.message||'LOC transaction failed');
    if(!Array.isArray(data?.results)||data.results.length!==normalized.length)
      throw new Error('LOC transaction result is unconfirmed; reload before retrying');
    for(const item of normalized){
      if(item.p_table!=='api.manage')continue;
      const scopeFilter=(item.p_filters||[]).find(filter=>filter?.column==='id');
      invalidateRelevantAuthorization(scopeFilter?.value,item.p_values?.email);
    }
    return homeCacheSync===false?{...data,home_cache_sync:false}:data;
  }

  async function managementWriteUnchecked(payload,{normalizedGalaxy=false}={}){
    const lease=editorTransactionLease();
    assertEditorTransactionLease(lease);
    preflightWrite(payload?.p_table);
    // The import-only caller already normalized and Zod-validated this exact
    // batch. Other management inserts keep the unchanged normalization path.
    if(!normalizedGalaxy&&isScopedGalaxy(payload?.p_table)&&payload?.p_operation==='insert')
      payload={...payload,p_rows:prepareGalaxyInsertRows(payload.p_table,payload.p_rows||[])};
    if(isScopedGalaxy(payload?.p_table)&&payload?.p_operation==='update')
      payload={...payload,p_values:prepareGalaxyUpdateValues(payload.p_table,payload.p_values)};
    // ZModel physical relations only; the server rejects retired SQL names.
    assertEditorTransactionLease(lease);
    const {data,error}=await authClient.schema('silver').managedWrite(payload);
    assertEditorTransactionLease(lease);
    if(error)throw new Error(error.message||'Management write failed');
    if(payload?.p_table==='api.manage'){
      const values=payload.p_values||{};
      const isAuthorityChange=payload.p_operation!=='update'||
        ['id','email','manage_role'].some(key=>Object.hasOwn(values,key));
      if(isAuthorityChange){
        const scopeFilter=(payload.p_filters||[]).find(filter=>filter?.column==='id');
        invalidateRelevantAuthorization(scopeFilter?.value,values.email);
      }
    }
    return data||{count:0};
  }

  async function insertRowsUnchecked(table,rows,{normalizedGalaxy=false,importBatch=false}={}){
    const lease=editorTransactionLease();
    assertEditorTransactionLease(lease);
    const list=Array.isArray(rows)?rows:[];
    if(!list.length)return {count:0};
    if(!normalizedGalaxy)
      for(const row of list)validateGalaxyWrite(table,row);
    if(!importBatch){
      // Every ordinary multi-row Save is one server write action + one SQL Transaction,
      // regardless of how many physical INSERT statements the DB chooses.
      // Only the explicit high-volume import API retains batch checkpoints.
      const receipt=await transactionWritesUnchecked([{
        p_table:table,p_operation:'insert',p_rows:list
      }]);
      const count=Number(receipt?.results?.[0]?.count??0);
      if(count!==list.length)
        throw new Error('LOC insert receipt incomplete; reload before retrying');
      return {count};
    }
    // Heavy import rows are already bounded by the caller's real payload
    // bytes. Do not silently re-split them at the ordinary 1k ceiling.
    const batchSize=HEAVY_QUERY_ROWS;
    let count=0;
    for(let offset=0;offset<list.length;offset+=batchSize){
      assertEditorTransactionLease(lease);
      const batch=list.slice(offset,offset+batchSize);
      const result=await managementWriteUnchecked({
        p_table:table,
        p_operation:'insert',
        p_rows:batch,
        p_values:null,
        p_filters:[]
      },{normalizedGalaxy});
      assertEditorTransactionLease(lease);
      const affected=Number(result?.count||0);
      if(affected!==batch.length)throw new Error(`DB INSERT ${table} incomplete: expected ${batch.length}, affected ${affected}`);
      count+=affected;
    }
    return {count};
  }

  async function updateRowsUnchecked(table,values,{filters=[]}={}){
    validateGalaxyWrite(table,values);
    const result=await managementWrite({
      p_table:table,
      p_operation:'update',
      p_rows:null,
      p_values:values||{},
      p_filters:filters
    });
    const affected=Number(result?.count||0);
    if(affected<1)throw new Error(`DB UPDATE ${table} affected 0 rows; record may not exist or filter did not match`);
    return {...result,count:affected};
  }

  async function updateImportRowsUnchecked(table,rows){
    const lease=editorTransactionLease();
    assertEditorTransactionLease(lease);
    if(scopeTableDescriptor(String(table||'').split('.').at(-1))?.kind!=='galaxy')
      throw Error('文章批次更新資料表無效');
    const list=Array.isArray(rows)?rows:[];
    const allowedFields=new Set(['title','content','place_id','url','media_link',
      'location','site_id','ref_id','source_id','target_id']);
    const seen=new Set();
    for(const row of list){
      const uid=String(row?.uid||'');
      const keys=Object.keys(row||{}).filter(key=>key!=='uid');
      if(!/^[A-Za-z0-9]{8}$/.test(uid)||!keys.length||
        keys.some(key=>!allowedFields.has(key))||seen.has(uid))
        throw Error('無效文章更新資料');
      seen.add(uid);
      validateGalaxyWrite(table,row);
    }
    // Keep each authorized import chunk atomic. A single typed update_batch
    // handles ordinary and special Galaxy fields in ONE PostgreSQL statement.
    // Bound the serialized payload below LOC Native's 700k request limit.
    // Never retry a batch whose COMMIT receipt may already have been lost.
    const maxChunkBytes=IMPORT_WRITE_TARGET_BYTES;
    const encoder=new TextEncoder();
    let pending=[],bytes=0,count=0,committed=0;
    const flush=async()=>{
      assertEditorTransactionLease(lease);
      if(!pending.length)return;
      const payload={p_table:table,p_operation:'update_batch',
        p_rows:pending,p_values:null,p_filters:[]};
      const result=await managementWriteUnchecked(payload);
      assertEditorTransactionLease(lease);
      count+=Number(result?.count||0);
      committed+=pending.length;
      pending=[];bytes=0;
    };
    try{
      for(const row of list){
        assertEditorTransactionLease(lease);
        const size=encoder.encode(JSON.stringify(row)).length+1;
        if(size>maxChunkBytes)throw Error('單筆文章更新超出批次傳輸限制');
        if(pending.length>=HEAVY_QUERY_ROWS||bytes+size>maxChunkBytes)await flush();
        pending.push(row);bytes+=size;
      }
      await flush();
    }catch(error){
      if(error?.code==='LOC_WRITE_RESULT_UNKNOWN'||error?.code==='LOC_EDITOR_CANCELLED')
        throw error;
      throw new Error('文章重匯更新失敗；已確認提交 '+committed+
        ' 筆資料的批次，當前批次已回滾或提交結果未確認。原始錯誤：'+
        String(error?.message||error));
    }
    return {count};
  }

  async function deleteRowsUnchecked(table,{filters=[]}={}){
    const result=await managementWrite({
      p_table:table,
      p_operation:'delete',
      p_rows:null,
      p_values:null,
      p_filters:filters
    });
    const affected=Number(result?.count||0);
    if(affected<1)throw new Error(`DB DELETE ${table} affected 0 rows; record may not exist or filter did not match`);
    return {...result,count:affected};
  }

  function normalizeScopeId(value){
    const scope=String(value||'').trim().toLowerCase();
    if(!/^[a-z][a-z0-9]{0,14}$/.test(scope))throw new Error('Scope ID 格式無效');
    return scope;
  }

  async function readOwnedKeywordNodes(table){
    const scope=String(table||'').match(/^silver\.([a-z][a-z0-9]{0,14})_[a-z][a-z0-9_]*$/)?.[1];
    if(!scope)throw Error('KeywordAnchor Scope is invalid');
    const {queryKeywordNodesForCopy}=await import('../actions/keywords/queries.mjs');
    const rows=[];
    let after=null;
    for(;;){
      const result=await queryKeywordNodesForCopy({p_scope_id:scope,
        p_after_uid:after,p_limit:MAX_ROWS});
      const page=result?.data;
      if(!Array.isArray(page)||page.length>MAX_ROWS)
        throw Error('KeywordAnchor query returned an invalid page');
      rows.push(...page);
      if(page.length<MAX_ROWS)break;
      const next=String(page.at(-1)?.uid||'');
      if(!/^[A-Za-z0-9]{8}$/.test(next)||next===after)
        throw Error('KeywordAnchor query cursor did not advance');
      after=next;
    }
    return rows;
  }
  async function resetKeywordClassification(scopeId,{classUid='',onProgress}={}){
    const scope=normalizeScopeId(scopeId);
    const uid=String(classUid||'');
    if(!/^[A-Za-z0-9]{8}$/.test(uid))
      throw new Error('尚未選取 Keywords Class');
    const {keywordService}=await import('../keywords/service-client.mjs');
    onProgress?.({phase:'resetting',completed:0,total:1});
    const result=await keywordService('reset',{scopeId:scope,classUid:uid});
    // Do not tell the editor it is cleared merely because an HTTP request
    // returned 200; require the server's committed epoch+cursor reset receipt.
    if(result?.cleared!==true||!Number.isSafeInteger(result.resetEpoch)||
      result.resetEpoch<1)
      throw new Error('清空結果未經資料庫確認，請重新讀取後核對。');
    onProgress?.({phase:'completed',completed:1,total:1});
    return result;
  }

  // Keyword reads use the fixed Keyword feature actions.
  async function readKeywordClass(scopeId,classUid){
    const scope=normalizeScopeId(scopeId),uid=String(classUid||'');
    if(!/^[A-Za-z0-9]{4}(?:[A-Za-z0-9]{4})?$/.test(uid))return null;
    const {data}=await queryStatics({p_scope_id:scope,p_view:'keyword_catalog',
      p_options:{classUid:uid}});
    return data?.class_uid===uid?data:null;
  }

  async function readKeywordTreeSummary(scopeId,{classUid='',startDate='',endDate='',source=''}={}){
    const scope=normalizeScopeId(scopeId);
    const day=value=>/^\d{4}-\d{2}-\d{2}/.test(String(value||''))?String(value).slice(0,10):null;
    const {data}=await queryStatics({
      p_scope_id:scope,p_view:'keyword_summary',p_start:day(startDate),p_end:day(endDate),
      p_options:{classUid:classUid||null,source:String(source||'').trim()||null}
    });
    return Array.isArray(data)?data:[];
  }

  async function readKeywordTreeCatalog(scopeId,{classUid=''}={}){
    const scope=normalizeScopeId(scopeId);
    const {data}=await queryStatics({
      p_scope_id:scope,p_view:'keyword_catalog',p_options:{classUid:classUid||null}
    });
    return data&&Array.isArray(data.rows)?data:{class_uid:'',rows:[]};
  }

  async function readSharedKeywordClasses(scopeId){
    const scope=normalizeScopeId(scopeId);
    const {data}=await queryStatics({p_scope_id:scope,p_view:'shared_classes',
      p_options:{}});
    return Array.isArray(data)?data:[];
  }
  async function readScopeStatistics(scopeId,{startDate='',endDate=''}={}){
    const scope=normalizeScopeId(scopeId);
    const params=new URLSearchParams({kind:'daily',scope});
    if(startDate)params.set('start',String(startDate).slice(0,10));
    if(endDate)params.set('end',String(endDate).slice(0,10));
    const {data}=await queryStaticsContent(params.toString());
    return Array.isArray(data)?data:[];
  }
  async function readScopeCategoryTotals(scopeId,{startDate='',endDate=''}={}){
    const scope=normalizeScopeId(scopeId);
    const params=new URLSearchParams({kind:'totals',scope});
    if(startDate)params.set('start',String(startDate).slice(0,10));
    if(endDate)params.set('end',String(endDate).slice(0,10));
    const {data}=await queryStaticsContent(params.toString());
    return Array.isArray(data)?data:[];
  }

  const dayOrNull=value=>/^\d{4}-\d{2}-\d{2}/.test(String(value||''))?String(value).slice(0,10):null;
  async function readScopeOverview(scopeId,{startDate='',endDate='',signal=null}={}){
    if(signal?.aborted)throw signal.reason||new DOMException('Aborted','AbortError');
    const scope=normalizeScopeId(scopeId);
    const params=new URLSearchParams({kind:'overview',scope,
      start:String(startDate||'').slice(0,10),end:String(endDate||'').slice(0,10)});
    const {data}=await queryStaticsContent(params.toString());
    if(signal?.aborted)throw signal.reason||new DOMException('Aborted','AbortError');
    return {
      earliest:dayOrNull(data?.earliest)||'',
      rows:Array.isArray(data?.rows)?data.rows:[],
      categories:Array.isArray(data?.categories)?data.categories:[],
      aliases:Array.isArray(data?.aliases)?data.aliases:[]
    };
  }
  async function readScopeEarliest(scopeId){
    const params=new URLSearchParams({kind:'earliest',scope:normalizeScopeId(scopeId)});
    const {data}=await queryStaticsContent(params.toString());
    return dayOrNull(data)||'';
  }
  async function readLocStatistics({startDate='',endDate=''}={}){
    const params=new URLSearchParams({kind:'loc',scope:'loc'});
    if(startDate)params.set('start',String(startDate).slice(0,10));
    if(endDate)params.set('end',String(endDate).slice(0,10));
    const {data}=await queryStaticsContent(params.toString());
    return {
      earliest:dayOrNull(data?.earliest)||'',
      scopes:Array.isArray(data?.scopes)?data.scopes:[],
      rows:Array.isArray(data?.rows)?data.rows:[]
    };
  }

  // "資料重整": run on demand (typically right after an import), never
  // automatically. The database does the grouping -- exact createtime match
  // first, then exact canonicalized content match within that group -- so
  // nothing is paged through the client; see silver.find_galaxy_duplicates.
  // Groups that don't match on both stay apart (false negatives preferred
  // over ever auto-merging two different posts). No row is ever deleted
  // here -- the caller reviews each group and deletes explicitly.
  async function findGalaxyDuplicates(scopeId){
    const scope=normalizeScopeId(scopeId);
    const {data}=await queryGalaxyDuplicates(scope);
    return (Array.isArray(data)?data:[]).map(row=>{
      const uids=(Array.isArray(row?.uids)?row.uids:[]).map(String);
      const newlineFlags=Array.isArray(row?.newline_flags)?row.newline_flags:[];
      return {
        sourceName:String(row?.site||''),
        createtime:String(row?.createtime||''),
        uids,
        titles:(Array.isArray(row?.titles)?row.titles:[]).map(String),
        updateTimes:(Array.isArray(row?.update_times)?row.update_times:[])
          .map(value=>String(value||'')),
        hasNewline:uids.map((_,index)=>newlineFlags[index]===true)
      };
    });
  }

  async function prepareKeywordLibraryWrite(scopeId,operation,node={}){
    const scope=normalizeScopeId(scopeId),table='silver.'+scopeTableName(scope,'lucus');
    preflightWrite(table);
    const op=String(operation||'').toLowerCase();
    if(!['insert','update','delete'].includes(op))
      throw Error('Invalid KeywordAnchor operation');
    const {normalizeKeywordTreeRow}=await import('../keywords/tree.mjs');
    const v=normalizeKeywordTreeRow(node);
    const field=v.type==='item'?'keyword':'uid';
    const attr={...(node.attr&&typeof node.attr==='object'?node.attr:{}),[field]:v.lists};
    if(['item','group'].includes(v.type)){
      for(const key of ['uidlists','articles','hits','total'])delete attr[key];
    }
    if(v.type==='class'){
      const {classSkipArticleWords}=await import('../keywords/class-exceptions.mjs');
      classSkipArticleWords(attr);
    }
    const filters=[{column:'uid',operator:'eq',value:v.uid},
      {column:'type',operator:'eq',value:v.type}];
    const p_table=table;
    if(op==='insert')
      return {p_table,p_operation:'insert',
        p_rows:[{uid:v.uid,type:v.type,title:v.name,
          description:v.desc,attr}]};
    if(op==='update')
      return {p_table,p_operation:'update',
        p_values:{title:v.name,description:v.desc,attr},p_filters:filters};
    return {p_table,p_operation:'delete',p_filters:filters};
  }
  async function writeKeywordLibraryItem(scopeId,operation,node={}){
    const write=await prepareKeywordLibraryWrite(scopeId,operation,node);
    // The same single-transaction writer as other management Anchors.
    await transactionWrites([write]);
    return {uid:node.uid,count:1};
  }
  async function copyKeywordLibraryClass(scopeId,sourceClassUid,targetClassName){
    const scope=normalizeScopeId(scopeId),source=String(sourceClassUid||''),
      target=String(targetClassName||'').trim();
    if(!/^[0-9A-Za-z]{8}$/.test(source)||!target)throw new Error('Keywords Class 識別或名稱不正確');
    const table='silver.'+scopeTableName(scope,'lucus');
    preflightWrite(table);
    const data=await readOwnedKeywordNodes(table);
    const {indexKeywordTree,descendantsOfKeyword}=await import('../keywords/tree.mjs');
    const {allocateLucusUid}=await import('../model/uid.js');
    const tree=indexKeywordTree(data);
    const original=tree.index.get(source);
    if(!original||original.type!=='class')throw new Error('找不到來源 Class');
    const categoryUid=tree.parent.get(original.uid);
    const category=categoryUid?tree.index.get(categoryUid):null;
    const descendants=descendantsOfKeyword(data,original.uid);
    const occupied=[...tree.index.keys()],mapping=new Map();
    // Native Anchor UIDs are cryptographically random Base62. Do not scan
    // and sort every Anchor just to allocate new UIDs; the database PK is the
    // authoritative collision check and this batch owns its allocated set.
    for(const node of descendants){
      const uid=allocateLucusUid(new Set(occupied));
      occupied.push(uid);mapping.set(node.uid,uid);
    }
    const operations=[];
    // Insert children before the Class that references them. A failed
    // dependency, parent update or key collision ROLLBACKS the entire copy.
    for(const node of [...descendants].reverse()){
      const copy={...node,uid:mapping.get(node.uid),
        name:node.uid===original.uid?target:node.name,
        lists:node.type==='item'?[...node.lists]:node.lists.map(uid=>mapping.get(uid)),
        uid_lists:[]};
      operations.push(await prepareKeywordLibraryWrite(scope,'insert',copy));
    }
    if(category)operations.push(await prepareKeywordLibraryWrite(scope,'update',{
      ...category,lists:[...category.lists,mapping.get(original.uid)]}));
    await transactionWrites(operations);
    return {count:descendants.length,class_uid:mapping.get(original.uid),
      uid:mapping.get(original.uid)};
  }


  async function copyRune66KeywordClassUnchecked(scopeId,sourceClassUid){
    const {allocateLucusUid}=await import('../model/uid.js');
    const uid=allocateLucusUid();
    return copyKeywordLibraryClass(scopeId,sourceClassUid,'符文66副本-'+uid);
  }

  async function moveScopeBlockUnchecked(scopeId,pageName,uid,direction){
    const scope=normalizeScopeId(scopeId);
    const page=String(pageName||'').trim();
    const normalizedPage=scope==='loc'?page:page.toLowerCase();
    const blockUid=String(uid||'').trim();
    if(!scope||!normalizedPage||!(/^[A-Za-z0-9]{8}$/.test(blockUid))||![1,-1].includes(direction))throw new Error('無效的區塊移動參數。');
    if(scope==='loc'&&normalizedPage==='index'){
      // Existing LOC group permission for the homepage is preserved.
      if(typeof window!=='undefined'){
        assertEditorSession(window.sessionStorage);
        if(!canAuthorizeLocAccess('group','loc'))throw new Error('LOC 群組首頁編輯權限不足。');
      }
    }else preflightWrite(scope==='loc'?'silver.'+scopeTableName(scope,'lucus'):'silver.'+scope+'_blocks');
    const {data,error,homeCacheSync}=await authClient.schema('silver').managedAction('move_scope_block',{
      p_scope_id:scope,p_page_name:normalizedPage,p_uid:blockUid,p_direction:direction
    });
    if(error)throw new Error(error.message||'區塊移動失敗');
    return homeCacheSync===false&&data&&typeof data==='object'
      ?{...data,home_cache_sync:false}:data||{};
  }

  async function deleteScopeUnchecked(scopeId){
    const scope=normalizeScopeId(scopeId);
    if(!scope)throw new Error('Scope ID 格式不正確。');
    preflightWrite('api.manage');
    const {data,error}=await authClient.schema('silver').managedAction('delete_scope',{p_scope_id:scope});
    if(error)throw new Error(error.message||'Scope 刪除失敗。');
    invalidateRelevantAuthorization(scope);
    return data||{};
  }

  async function provisionScopeUnchecked(values={}){
    const scopeId=normalizeScopeId(values.scope_id);
    preflightWrite('api.manage');
    const payload={
      p_scope_id:scopeId,
      p_display_name:String(values.display_name||'').trim(),
      p_email:String(values.email||'').trim().toLowerCase(),
      p_birthday:values.birthday||null,
      p_domain:String(values.domain||'').trim()||null,
      p_directory:String(values.directory||'').trim()||null,
      p_parent_scope_id:String(values.parent_scope_id||'loc').trim()||'loc',
      p_theme:String(values.theme||'system-default').trim()||'system-default',
      p_locale:String(values.locale||'zh-Hant').trim()||'zh-Hant',
      p_copy_keywords:values.copy_keywords!==false
    };
    const {data,error}=await authClient.schema('silver').managedAction('provision_scope',payload);
    if(error)throw new Error(error.message||'Scope provisioning failed');
    invalidateRelevantAuthorization(scopeId,values.email);
    return data||{};
  }

  async function manageScopeRegistryUnchecked(operation,scopeId,values={}){
    const scope=normalizeScopeId(scopeId);
    const op=String(operation||'').trim().toLowerCase();
    if(!['create_group','update'].includes(op))throw new Error('Unsupported Scope Registry operation');
    preflightWrite('api.manage');
    const {data,error}=await authClient.schema('silver').managedAction('manage_scope_registry',{
      p_operation:op,
      p_scope_id:scope,
      p_values:values&&typeof values==='object'?values:{}
    });
    if(error)throw new Error(error.message||'Scope Registry management failed');
    if(['email','manage_role','role','scopeid','id'].some(key=>Object.hasOwn(values||{},key)))
      invalidateRelevantAuthorization(scope,values.email);
    return data||{};
  }

  async function getAccountSession(){
    // A configured identity provider must prove its identity through LOC
    // Authority. database SDK sessions are never a fallback.
    if(typeof auth.getVerifiedSession!=='function')
      throw new Error('LOC verified identity provider is required');
    return auth.getVerifiedSession();
  }

  async function signInWithLocAuth(callbackURL){
    const target=String(callbackURL||'').trim();
    if(!target)throw new Error('LOC Auth return URL is required');
    // Interactive sign-in uses the configured independent identity adapter.
    // The database provider must never own the LOC login session.
    const {error}=await auth.signInWithOAuth({
      provider:'google',options:{redirectTo:target}
    });
    if(error)throw new Error(error.message||'LOC Auth sign-in failed');
  }

  async function signOutAccount(){
    const {error}=await auth.signOut({scope:'local'});
    if(error)throw new Error(error.message||'Account sign-out failed');
  }

  return {publicClient,authClient,dbAuthRelation,transactionWrites,prepareKeywordLibraryWrite,insertRows,insertImportRows,updateRows,deleteRows,updateImportRows,resetKeywordClassification,readKeywordClass,readScopeStatistics,readScopeCategoryTotals,readScopeOverview,readScopeEarliest,readLocStatistics,findGalaxyDuplicates,readKeywordTreeSummary,readKeywordTreeCatalog,readSharedKeywordClasses,writeKeywordLibraryItem,copyKeywordLibraryClass,copyRune66KeywordClass,deleteScope,moveScopeBlock,provisionScope,manageScopeRegistry,getAccountSession,signInWithLocAuth,signOutAccount};
}

// One universal hard ceiling for all database read adapters and selected columns.
// A ceiling does not require fetching that many rows: callers still paginate.
export {DB_QUERY_BATCH_SIZE};
export function queryBatchSize(){
  return DB_QUERY_BATCH_SIZE;
}

// List UI loading knobs (merged from the former list-loading-contract.mjs).
export const DEFAULT_LIST_BATCH_SIZE=ARTICLE_UID_PAGE_ROWS;
export const LIST_LOAD_COOLDOWN_MS=1500;
