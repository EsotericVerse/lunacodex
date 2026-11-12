import {flashMessage} from './flash-message.js';
import {isUnifiedAnchorScope} from './unified-anchor-compat.mjs';
import {assertPlainGalaxyAttributes} from './content-policy.js';
import {DB_QUERY_BATCH_SIZE,MAX_ROWS} from './query-batch-size.mjs';
import {assertAuthorizationForTable,clearAuthorization,readAuthorization} from './authorization-runtime.mjs';
import {assertEditorSession} from './edit-session-ttl.mjs';
import {unifiedAnchorSpec} from './unified-anchor-compat.mjs';
import {isScopedGalaxy,prepareGalaxyInsertRows,prepareGalaxyUpdateValues} from './galaxy-able.mjs';

// Keyword read, write and reset use the shared MaxRows.
export {MAX_ROWS as KEYWORD_CLASSIFICATION_BATCH_SIZE,MAX_ROWS as KEYWORD_CLASSIFICATION_WRITE_BATCH_SIZE,MAX_ROWS as KEYWORD_CLASSIFICATION_WRITE_PAUSE_INTERVAL};
export const KEYWORD_CLASSIFICATION_WRITE_COOLDOWN_MS=1000;

// The existing management-write boundary enforces Galaxy metadata rules
// consistently for publisher, search, culture and import paths.
// Galaxy Media and Blocks are different schemas and are not affected.
function validateGalaxyWrite(table,values){
  if(!/^silver\.[a-z][a-z0-9_]{0,40}_galaxy(?:_media)?$/.test(String(table||'')))return values;
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

  async function selectAuthRow(table,{idColumn,id,columns}={}){
    const {data,error}=await dbAuthRelation(table).select(columns).eq(idColumn,String(id)).limit(1);
    if(error)throw new Error(error.message||('DB SELECT '+table+' failed'));
    return data?.[0]||null;
  }

  function preflightWrite(table){
    // JS-only first gate; local SQLite is an independent device-private scope.
    // The database RPC/RLS is always the second, authoritative gate.
    if(typeof window!=='undefined'){
      assertEditorSession(window.sessionStorage);
      assertAuthorizationForTable(table);
    }
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
  const WRITE_FAILED_NOTICE='儲存失敗，資料尚未寫入資料庫，請稍後再試。';
  function withWriteNotice(run){
    return async(...args)=>{
      try{return await run(...args);}
      catch(error){flashMessage(WRITE_FAILED_NOTICE);throw error;}
    };
  }
  const managementWrite=withWriteNotice(managementWriteUnchecked);
  const insertRows=withWriteNotice(insertRowsUnchecked);
  // Import batch retries handle UID conflicts themselves. Keep auth checks and
  // failures, but do not flash a global notice for every bisected retry.
  const insertImportRows=async(table,rows,{onValidationProgress}={})=>{
    // Normalize once and validate the EXACT rows that reach Kysely. Legacy
    // source flags are expanded before the model-derived Zod parse, while
    // the original authoring/content guard still checks incoming attributes.
    // The private normalizedGalaxy flag does not cross the HTTP boundary.
    if(!isScopedGalaxy(table))return insertRowsUnchecked(table,rows);
    for(const row of rows)validateGalaxyWrite(table,row);
    const prepared=prepareGalaxyInsertRows(table,rows);
    const {assertZModelImportRows}=await import('../../zenstack/import-validation.mjs');
    assertZModelImportRows(table,prepared,{onProgress:onValidationProgress});
    return insertRowsUnchecked(table,prepared,{normalizedGalaxy:true});
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

  async function managementWriteUnchecked(payload,{normalizedGalaxy=false}={}){
    preflightWrite(payload?.p_table);
    // The import-only caller already normalized and Zod-validated this exact
    // batch. Other management inserts keep the unchanged normalization path.
    if(!normalizedGalaxy&&isScopedGalaxy(payload?.p_table)&&payload?.p_operation==='insert')
      payload={...payload,p_rows:prepareGalaxyInsertRows(payload.p_table,payload.p_rows||[])};
    if(isScopedGalaxy(payload?.p_table)&&payload?.p_operation==='update')
      payload={...payload,p_values:prepareGalaxyUpdateValues(payload.p_table,payload.p_values)};
    // The unified anchor store is already governed by the LOC Auth-verified
    // authenticated Kysely client and its database RLS. Legacy management
    // SQL RPCs are never used for this cutover.
    const parts=String(payload?.p_table||'').split('.');
    const spec=unifiedAnchorSpec(parts[0],parts[1]);
    if(spec){
      const relation=()=>dbAuthRelation(payload.p_table);
      const filters=Array.isArray(payload.p_filters)?payload.p_filters:[];
      const op=String(payload.p_operation||'');
      const filtered=q=>{
        for(const f of filters){
          if(!['eq','neq','gt','gte','lt','lte','like','ilike','is','in'].includes(f.operator))
            throw Error('Unsupported unified write filter: '+f.operator);
          q=q[f.operator](f.column,f.value);
        }
        return q;
      };
      if(op==='insert'){
        const rows=Array.isArray(payload.p_rows)?payload.p_rows:[];
        const {data,error}=await relation().insert(rows).select('uid');
        if(error)throw Error(error.message||'Unified insert failed');
        return {count:data?.length||0};
      }
      if(op==='update'||op==='delete'){
        if(!filters.length)throw Error('Unsafe unfiltered unified write');
        const q=op==='update'?relation().update(payload.p_values||{}):relation().delete();
        const {data,error}=await filtered(q).select('uid');
        if(error)throw Error(error.message||'Unified write failed');
        return {count:data?.length||0};
      }
      throw Error('Unsupported unified operation: '+op);
    }
    const {data,error}=await authClient.schema('silver').managedWrite(payload);
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

  async function insertRowsUnchecked(table,rows,{normalizedGalaxy=false}={}){
    const list=Array.isArray(rows)?rows:[];
    // Import rows passed through the original content guard and the strict
    // model-derived Zod validator before reaching this shared batch writer.
    if(!normalizedGalaxy)
      for(const row of list)validateGalaxyWrite(table,row);
    const batchSize=MAX_ROWS;
    let count=0;
    for(let offset=0;offset<list.length;offset+=batchSize){
      const batch=list.slice(offset,offset+batchSize);
      const result=await managementWriteUnchecked({
        p_table:table,
        p_operation:'insert',
        p_rows:batch,
        p_values:null,
        p_filters:[]
      },{normalizedGalaxy});
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
    // Preserve the database update_batch boundary: only Galaxy article tables.
    if(!/^silver\.[a-z][a-z0-9_]*_galaxy$/.test(String(table||'')))
      throw Error('文章批次更新資料表無效');
    const list=Array.isArray(rows)?rows:[];
    // Keep the existing update_batch RPC contract: it intentionally accepts
    // only these five fields. Source metadata already belongs to Galaxy,
    // but must use the existing, authorized single-row update operation.
    const batchFields=new Set(['title','content','place_id','url','media_link']);
    const allowedFields=new Set([...batchFields,'location','site_id','ref_id','source_id','target_id']);
    const bulk=[],metadata=[],seen=new Set();
    for(const row of list){
      const uid=String(row?.uid||'');
      const keys=Object.keys(row||{}).filter(key=>key!=='uid');
      if(!/^[A-Za-z0-9]{8}$/.test(uid)||!keys.length||
          keys.some(key=>!allowedFields.has(key))||seen.has(uid))
        throw Error('無效文章更新資料');
      seen.add(uid);
      validateGalaxyWrite(table,row);
      if(keys.some(key=>!batchFields.has(key)))metadata.push(row);
      else bulk.push(row);
    }
    let count=0;
    try{
      for(let start=0;start<bulk.length;start+=MAX_ROWS){
        const batch=bulk.slice(start,start+MAX_ROWS);
        const result=await managementWriteUnchecked({
          p_table:table,p_operation:'update_batch',
          p_rows:batch,p_values:null,p_filters:[]
        });
        count+=Number(result?.count||0);
      }
      // An existing per-row 'update' RPC handles additional Galaxy fields
      // without a new table, column, index or RPC. Concurrency is bounded to
      // avoid overwhelming the database during large reimports.
      for(let start=0;start<metadata.length;start+=6){
        const group=metadata.slice(start,start+6);
        const results=await Promise.all(group.map(async row=>{
          const {uid,...values}=row;
          const result=await managementWriteUnchecked({
            p_table:table,p_operation:'update',
            p_rows:null,p_values:values,
            p_filters:[{column:'uid',operator:'eq',value:uid}]
          });
          return Number(result?.count||0);
        }));
        for(const affected of results){
          if(affected!==1)throw Error('既有文章更新筆數不符：'+affected);
          count+=affected;
        }
      }
    }catch(error){
      throw new Error('文章重匯更新失敗；已確認成功 '+count+' 筆，其他批次可能部分寫入。原始錯誤：'+
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
    const rows=[],size=500;
    for(let offset=0;;offset+=size){
      const {data,error}=await dbAuthRelation(table)
        .select('uid,type,name,desc,lists')
        .order('name',{ascending:true}).range(offset,offset+size-1);
      if(error)throw new Error(error.message||'Cannot read Keywords tree');
      rows.push(...(data||[]));
      if((data||[]).length<size)break;
    }
    return rows;
  }

  async function resetKeywordClassification(scopeId,{classUid='',onProgress}={}){
    const scope=normalizeScopeId(scopeId);
    const uid=String(classUid||'');
    if(!/^[A-Za-z0-9]{8}$/.test(uid))
      throw new Error('尚未選取 Keywords Class');
    const {keywordService}=await import('./keyword-service-client.mjs');
    onProgress?.({phase:'resetting',completed:0,total:1});
    const result=await keywordService('reset',{scopeId:scope,classUid:uid});
    onProgress?.({phase:'completed',completed:1,total:1});
    return result;
  }

  async function verifiedKeywordOwner(){
    // No database-auth fallback: only an independently Authority-verified
    // identity may access owner-only keyword functions.
    if(typeof auth.getVerifiedSession!=='function')
      throw new Error('LOC verified identity provider is required');
    const verified=await auth.getVerifiedSession();
    return Boolean(verified?.user?.id&&verified?.oauth?.email&&
      String(verified.user.email||'').toLowerCase()===String(verified.oauth.email).toLowerCase());
  }

  async function analyticsRead(scope,view,{startDate='',endDate='',options={}}={},client=publicClient){
    const day=value=>/^\d{4}-\d{2}-\d{2}/.test(String(value||''))?String(value).slice(0,10):null;
    const {data,error}=await client.schema('silver').analytics({
      p_scope_id:scope,p_view:view,p_start:day(startDate),p_end:day(endDate),p_options:options
    });
    if(error){const failure=new Error(error.message||'Scope analytics unavailable');failure.code=error.code;throw failure;}
    return data;
  }

  async function keywordRead(args,{isEmpty=data=>!data}={}){
    const publicResult=await publicClient.schema('silver').analytics(args);
    if(publicResult.error)throw new Error(publicResult.error.message||'Keyword analytics unavailable');
    if(!isEmpty(publicResult.data))return publicResult.data;
    if(!await verifiedKeywordOwner())return publicResult.data;
    const privateResult=await authClient.schema('silver').analytics(args);
    if(privateResult.error)throw new Error(privateResult.error.message||'Private keyword analytics unavailable');
    return privateResult.data;
  }

  async function readUnifiedKeywordCatalog(scope,requestedUid){
    // Owner-only shortcut: current Keywords content is in the shared Anchor
    // relation, not in the legacy Keywords table read by the older RPC.
    // Guests keep the verified public/shared RPC (which redacts private data).
    if(!isUnifiedAnchorScope(scope)||!await verifiedKeywordOwner())return null;
    let uid=String(requestedUid||'');
    if(!uid){
      const config=await selectAuthRow('silver.'+scope,{
        idColumn:'id',id:scope,columns:'current_keyword_class_uid'
      });
      uid=String(config?.current_keyword_class_uid||'');
    }
    if(!/^[A-Za-z0-9]{4}(?:[A-Za-z0-9]{4})?$/.test(uid))return null;
    const table='silver.'+scope+'_keywords';
    const {data:classes,error:classError}=await dbAuthRelation(table)
      .select('uid,type,name,desc,lists').eq('uid',uid).eq('type','class').limit(1);
    if(classError)throw Error(classError.message||'Unified Class read failed');
    const klass=classes?.[0];
    if(!klass)return null; // Not the Scope owner: use public shared RPC.
    const fetchNodes=async (ids,type)=>{
      if(!ids.length)return [];
      const {data,error}=await dbAuthRelation(table)
        .select('uid,type,name,desc,lists').eq('type',type).in('uid',ids).limit(ids.length);
      if(error)throw Error(error.message||'Unified Keyword nodes read failed');
      const byUid=new Map((data||[]).map(row=>[row.uid,row]));
      return ids.map(id=>byUid.get(id)).filter(Boolean);
    };
    const groups=await fetchNodes(klass.lists||[],'group');
    const items=await fetchNodes([...new Set(groups.flatMap(row=>row.lists||[]))],'item');
    // The legacy read contract intentionally redacts Item descriptions and
    // judgement lists. Keep exactly the same response on the new backing table.
    const view=row=>({uid:row.uid,type:row.type,name:row.name,
      desc:row.type==='item'?'':String(row.desc||''),
      lists:row.type==='item'?[]:[...(row.lists||[])],uid_lists:[]});
    return {class_uid:uid,rows:[klass,...groups,...items].map(view)};
  }

  async function readKeywordClass(scopeId,classUid){
    const scope=normalizeScopeId(scopeId),uid=String(classUid||'');
    if(!/^[A-Za-z0-9]{4}(?:[A-Za-z0-9]{4})?$/.test(uid))return null;
    const direct=await readUnifiedKeywordCatalog(scope,uid);
    if(direct)return direct;
    const data=await keywordRead({p_scope_id:scope,p_view:'keyword_catalog',p_options:{classUid:uid}},{
      isEmpty:result=>!result?.class_uid||!Array.isArray(result.rows)||result.rows.length===0
    });
    return data?.class_uid===uid?data:null;
  }

  async function readKeywordTreeSummary(scopeId,{classUid='',startDate='',endDate='',source=''}={}){
    const scope=normalizeScopeId(scopeId);
    const day=value=>/^\d{4}-\d{2}-\d{2}/.test(String(value||''))?String(value).slice(0,10):null;
    const data=await keywordRead({
      p_scope_id:scope,p_view:'keyword_summary',p_start:day(startDate),p_end:day(endDate),
      p_options:{classUid:classUid||null,source:String(source||'').trim()||null}
    },{isEmpty:value=>!Array.isArray(value)||value.length===0});
    return Array.isArray(data)?data:[];
  }

  async function readKeywordTreeCatalog(scopeId,{classUid=''}={}){
    const scope=normalizeScopeId(scopeId);
    const direct=await readUnifiedKeywordCatalog(scope,classUid);
    if(direct)return direct;
    const data=await keywordRead({
      p_scope_id:scope,p_view:'keyword_catalog',p_options:{classUid:classUid||null}
    },{
      isEmpty:value=>!value?.class_uid||!Array.isArray(value.rows)||value.rows.length===0
    });
    return data&&Array.isArray(data.rows)?data:{class_uid:'',rows:[]};
  }

  async function readSharedKeywordClasses(scopeId){
    const scope=normalizeScopeId(scopeId);
    if(isUnifiedAnchorScope(scope)&&await verifiedKeywordOwner()){
      const {data,error}=await dbAuthRelation('silver.'+scope+'_keywords')
        .select('uid,type,name').eq('type','class').order('name',{ascending:true}).limit(500);
      if(error)throw Error(error.message||'Unified Class directory read failed');
      if(data?.length)return data.map(row=>({
        scopeId:scope,classUid:row.uid,name:row.name,category:row.uid
      }));
    }
    // An authenticated caller sees its authorized Classes; guests use the
    // public reader without requiring a login just to see shared Classes.
    const client=await verifiedKeywordOwner()?authClient:publicClient;
    const data=await analyticsRead(scope,'shared_classes',{},client);
    return Array.isArray(data)?data:[];
  }

  async function readScopeStatistics(scopeId,{startDate='',endDate='',includeUndated=false}={}){
    const data=await analyticsRead(normalizeScopeId(scopeId),'daily',{
      startDate,endDate,options:{includeUndated:Boolean(includeUndated)}
    });
    return Array.isArray(data)?data:[];
  }
  async function readScopeCategoryTotals(scopeId,{startDate='',endDate=''}={}){
    const data=await analyticsRead(normalizeScopeId(scopeId),'totals',{startDate,endDate});
    return Array.isArray(data)?data:[];
  }

  const dayOrNull=value=>/^\d{4}-\d{2}-\d{2}/.test(String(value||''))?String(value).slice(0,10):null;
  async function readScopeOverview(scopeId,{startDate='',endDate=''}={}){
    const data=await analyticsRead(normalizeScopeId(scopeId),'overview',{startDate,endDate});
    return {
      earliest:dayOrNull(data?.earliest)||'',
      rows:Array.isArray(data?.rows)?data.rows:[],
      categories:Array.isArray(data?.categories)?data.categories:[],
      aliases:Array.isArray(data?.aliases)?data.aliases:[]
    };
  }
  async function readScopeEarliest(scopeId){
    return dayOrNull(await analyticsRead(normalizeScopeId(scopeId),'earliest'))||'';
  }
  async function readLocStatistics({startDate='',endDate=''}={}){
    const data=await analyticsRead('loc','loc',{startDate,endDate});
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
    const {data,error}=await authClient.schema('silver').managedAction(
      'find_galaxy_duplicates',{p_scope_id:scope});
    if(error)throw new Error(error.message||'Duplicate scan failed');
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

  async function writeKeywordLibraryItem(scopeId,operation,node={}){
    const scope=normalizeScopeId(scopeId);
    const table='silver.'+scope+'_keywords';
    preflightWrite(table);
    const op=String(operation||'').toLowerCase();
    if(!['insert','update','delete'].includes(op))throw new Error('Unsupported Keywords operation');
    const {normalizeKeywordTreeRow,keywordUidListRecord}=await import('./keyword-tree.mjs');
    const normalized=normalizeKeywordTreeRow(node);
    const relation=dbAuthRelation(table);
    let query;
    if(op==='insert')query=relation.insert({...normalized,uid_lists:keywordUidListRecord(normalized.type,normalized.uid_lists)}).select('uid');
    else if(op==='update')query=relation.update({
      type:normalized.type,name:normalized.name,desc:normalized.desc,
      lists:normalized.lists
    }).eq('uid',normalized.uid).select('uid');
    else query=relation.delete().eq('uid',normalized.uid).select('uid');
    const {data,error}=await query;
    if(error||data?.length!==1)throw new Error(error?.message||'Keywords write affected no rows');
    return {uid:normalized.uid,count:1};
  }

  async function copyKeywordLibraryClass(scopeId,sourceClassUid,targetClassName){
    const scope=normalizeScopeId(scopeId),source=String(sourceClassUid||''),
      target=String(targetClassName||'').trim();
    if(!/^[0-9A-Za-z]{4}(?:[0-9A-Za-z]{4})?$/.test(source)||!target)throw new Error('Keywords Class 識別或名稱不正確');
    const table='silver.'+scope+'_keywords';
    preflightWrite(table);
    const data=await readOwnedKeywordNodes(table);
    const {indexKeywordTree,descendantsOfKeyword}=await import('./keyword-tree.mjs');
    const {generateKeywordClassUid}=await import('./keyword-uidlist.mjs');
    const {allocateAnchorUid}=await import('./unified-anchor-compat.mjs');
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
      const uid=isUnifiedAnchorScope(scope)?allocateAnchorUid(new Set(occupied)):
        generateKeywordClassUid(occupied);
      occupied.push(uid);mapping.set(node.uid,uid);
    }
    const saved=[];
    try{
      // Child nodes first so a published Class cannot reference missing nodes.
      for(const node of [...descendants].reverse()){
        const copy={...node,uid:mapping.get(node.uid),
          name:node.uid===original.uid?target:node.name,
          lists:node.type==='item'?[...node.lists]:node.lists.map(uid=>mapping.get(uid)),
          uid_lists:[]};
        await writeKeywordLibraryItem(scope,'insert',copy);
        saved.push(copy);
      }
      // Category is Scope Group managed. Preserve legacy parent links if present,
      // but never force new Class trees to create a Category.
      if(category)await writeKeywordLibraryItem(scope,'update',{
        ...category,lists:[...category.lists,mapping.get(original.uid)]});
    }catch(error){
      for(const node of saved.reverse())
        await writeKeywordLibraryItem(scope,'delete',node).catch(()=>{});
      throw error;
    }
    return {count:saved.length,class_uid:mapping.get(original.uid),uid:mapping.get(original.uid)};
  }


  async function copyRune66KeywordClassUnchecked(scopeId,sourceClassUid){
    const {generateKeywordClassUid}=await import('./keyword-uidlist.mjs');
    const uid=generateKeywordClassUid();
    return copyKeywordLibraryClass(scopeId,sourceClassUid,'符文66副本-'+uid);
  }

  async function moveScopeBlockUnchecked(scopeId,pageName,uid,direction){
    const scope=normalizeScopeId(scopeId);
    const page=String(pageName||'').trim().toLowerCase();
    const blockUid=String(uid||'').trim();
    if(!scope||!page||!(/^[A-Za-z0-9]{8}$/.test(blockUid))||![1,-1].includes(direction))throw new Error('無效的區塊移動參數。');
    preflightWrite('silver.'+scope+'_blocks');
    const {data,error}=await authClient.schema('silver').managedAction('move_scope_block',{
      p_scope_id:scope,p_page_name:page,p_uid:blockUid,p_direction:direction
    });
    if(error)throw new Error(error.message||'區塊移動失敗');
    return data||{};
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

  async function signInWithGoogle(callbackURL){
    const target=String(callbackURL||'').trim();
    if(!target)throw new Error('Google sign-in callback URL is required');
    // Interactive sign-in uses the configured independent identity adapter.
    // The database provider must never own the LOC login session.
    const {error}=await auth.signInWithOAuth({
      provider:'google',options:{redirectTo:target,queryParams:{prompt:'select_account'}}
    });
    if(error)throw new Error(error.message||'Google sign-in failed');
  }

  async function signOutAccount(){
    const {error}=await auth.signOut({scope:'local'});
    if(error)throw new Error(error.message||'Account sign-out failed');
  }

  return {publicClient,authClient,dbAuthRelation,selectAuthRow,insertRows,insertImportRows,updateRows,deleteRows,updateImportRows,resetKeywordClassification,readKeywordClass,readScopeStatistics,readScopeCategoryTotals,readScopeOverview,readScopeEarliest,readLocStatistics,findGalaxyDuplicates,readKeywordTreeSummary,readKeywordTreeCatalog,readSharedKeywordClasses,writeKeywordLibraryItem,copyKeywordLibraryClass,copyRune66KeywordClass,deleteScope,moveScopeBlock,provisionScope,manageScopeRegistry,getAccountSession,signInWithGoogle,signOutAccount};
}

// One universal hard ceiling for all database read adapters and selected columns.
// A ceiling does not require fetching that many rows: callers still paginate.
export {DB_QUERY_BATCH_SIZE};
export function queryBatchSize(){
  return DB_QUERY_BATCH_SIZE;
}

// List UI loading knobs (merged from the former list-loading-contract.mjs).
export const DEFAULT_LIST_BATCH_SIZE=100;
export const LIST_LOAD_COOLDOWN_MS=1500;
