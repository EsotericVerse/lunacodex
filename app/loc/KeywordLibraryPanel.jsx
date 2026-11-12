'use client';

import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import dynamic from 'next/dynamic';
import {useQueryClient} from '../../zenstack/client-queries';
import {useEditDock} from '../modular/edit-dock';
import {dbAuthRelation,dbPublicClient,dbAuthClient,resetKeywordClassification,updateRows,writeKeywordLibraryItem,copyKeywordLibraryClass} from './db-client.mjs';
import {indexKeywordTree,descendantsOfKeyword} from './keyword-tree.mjs';
import {allocateAnchorUid,isUnifiedAnchorScope} from './unified-anchor-compat.mjs';
import ManagementSectionNav from '../modular/ManagementSectionNav';
import ActivityMotion from '../modular/ActivityMotion';
import {keywordClassState,invalidateKeywordClass} from './keyword-class-state.mjs';
import {generateKeywordClassUid} from './keyword-uidlist.mjs';

const KeywordNetworkEditor=dynamic(()=>import('./KeywordNetworkEditor'),{ssr:false});
const TYPES=['class','group','item'];
const LABEL={category:'關鍵字目錄',class:'關鍵字群組科目',group:'關鍵字分類群組',item:'關鍵詞分類'};
const onlyWords=value=>[...new Set(String(value||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean))];
const emptyTree={index:new Map(),parent:new Map(),roots:[]};
const uidFor=(rows,scopeId)=>isUnifiedAnchorScope(scopeId)
  ?allocateAnchorUid(new Set(rows.map(row=>String(row.uid))))
  :generateKeywordClassUid(rows.map(row=>row.uid));
function freshNode(type,rows,scopeId){
  return {uid:uidFor(rows,scopeId),type,name:'',desc:'',lists:[],uid_lists:[]};
}
function childrenOf(tree,uid){
  const parent=tree.index.get(uid);
  return (parent?.lists||[]).map(id=>tree.index.get(id)).filter(Boolean);
}
function parentOf(tree,uid){return tree.index.get(tree.parent.get(uid));}
function classOf(tree,uid){
  let node=tree.index.get(uid);
  while(node&&node.type!=='class')node=parentOf(tree,node.uid);
  return node;
}
export default function KeywordLibraryPanel({scopeId,account}){
  const scope=account.scopeDataFor(scopeId),table=scope?.keywords||'';
  const configTable=scope?.config||'';
  const canEdit=account.canManageScopeSync(scopeId)&&Boolean(table&&configTable);
  const dock=useEditDock(),dockActions=useRef(null);
  const inDock=Boolean(dock?.active&&dock.scopeId===scopeId);
  const queryClient=useQueryClient();
  const [rows,setRows]=useState([]);
  const [patternNodes,setPatternNodes]=useState(new Map());
  const [config,setConfig]=useState({});
  const [savedConfig,setSavedConfig]=useState({});
  const [editor,setEditor]=useState(null);
  const [pendingParent,setPendingParent]=useState('');
  const [keywordText,setKeywordText]=useState('');
  const [workspace,setWorkspace]=useState('manual');
  const workspaceOptions=[
    {value:'manual',label:'群組對應調整'},
    {value:'analysis',label:'基本設定'},
    {value:'run',label:'重新分析'},
    {value:'network',label:'關聯圖'},
    {value:'suggest',label:'建議新增關鍵詞'}
  ];
  const [chosen,setChosen]=useState({category:'',class:'',group:'',item:''});
  const [copyName,setCopyName]=useState('');
  const [importScope,setImportScope]=useState('');
  const [importUid,setImportUid]=useState('');
  const [importClass,setImportClass]=useState(null);
  const [importBusy,setImportBusy]=useState(false);
  const [sharingBusy,setSharingBusy]=useState(false);
  const [progress,setProgress]=useState(null);
  const [discovery,setDiscovery]=useState(null);
  const [discoveryPage,setDiscoveryPage]=useState(1);
  const [discoveryProgress,setDiscoveryProgress]=useState(null);
  const [discoveryBusy,setDiscoveryBusy]=useState(false);
  const discoveryAbort=useRef(null);
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
  const [error,setError]=useState(''),[notice,setNotice]=useState('');
  const tree=useMemo(()=>{
    if(!rows.length)return emptyTree;
    return indexKeywordTree(rows);
  },[rows]);
  const category=tree.index.get(chosen.category);
  // Category identity is maintained by Scope Group, not editable here.
  const classes=[...tree.index.values()].filter(row=>row.type==='class')
    .sort((a,b)=>a.name.localeCompare(b.name,'zh-Hant'));
  const activeClass=tree.index.get(chosen.class);
  const groups=childrenOf(tree,activeClass?.uid);
  const activeGroup=tree.index.get(chosen.group);
  const items=childrenOf(tree,activeGroup?.uid);
  const selected=tree.index.get(chosen.item)||activeGroup||activeClass||null;
  const selectedSourceRow=rows.find(row=>row.uid===selected?.uid);
  const draft=editor?.node||null;
  const classShareEnabled=uid=>{
    if(!uid)return false;
    return config.keyword_meta?.class_shares?.[uid]===true;
  };
  const dirty=Boolean(draft&&(
    !tree.index.has(draft.uid)||
    JSON.stringify(draft)!==JSON.stringify(tree.index.get(draft.uid))
  ))||Boolean(draft?.type==='item'&&keywordText!==((draft.lists||[]).join('\n')));

  const invalidate=useCallback(async()=>{
    const {clearKeywordAnalysisCache}=await import('./keyword-analysis');
    clearKeywordAnalysisCache();
    await queryClient.invalidateQueries({predicate:query=>Array.isArray(query.queryKey)&&/keyword|culture-style-filter|statistics-style-filter/.test(String(query.queryKey[0]||''))});
  },[queryClient]);

  const load=useCallback(async(preferredUid='')=>{
    if(!canEdit)return;
    setLoading(true);setError('');
    try{
      const [found,settings]=await Promise.all([
        (async()=>{
          const owned=[],size=500;
          for(let offset=0;;offset+=size){
            const {data,error}=await dbAuthRelation(table)
              .select('uid,type,name,desc,lists,attr,num')
              .order('name',{ascending:true}).range(offset,offset+size-1);
            if(error)throw new Error(error.message||'Keywords 讀取失敗');
            owned.push(...(data||[]));
            if((data||[]).length<size)break;
          }
          return {rows:owned};
        })(),
        dbAuthRelation(configTable).select(
          'current_keyword_class_uid,keyword_min_chars,keyword_min_documents,keyword_class_share_enabled,keyword_meta,staticstime'
        ).eq('id',scopeId).limit(1)
      ]);
      if(settings.error)throw settings.error;
      const patterns=new Map((found.rows||[]).filter(row=>row.type==='pattern')
        .map(row=>[row.uid,row]));
      const records=(found.rows||[]).filter(row=>row.type!=='pattern')
        .map(row=>{
          if(row.type!=='item')return {...row,uid_lists:[]};
          const references=Array.isArray(row.attr?.uid)?row.attr.uid:[];
          const derived=references.map(uid=>patterns.get(uid)?.name).filter(Boolean)
            .filter(word=>word.normalize('NFKC').toLocaleLowerCase('zh-Hant')!==
              String(row.name||'').normalize('NFKC').toLocaleLowerCase('zh-Hant'));
          const words=[...new Set([...(Array.isArray(row.lists)?row.lists:[]),...derived])];
          return {...row,lists:words,patternUids:references,uid_lists:[]};
        }),index=indexKeywordTree(records);
      const first=index.roots[0];
      const firstClass=[...index.index.values()].find(row=>row.type==='class');
      const current=index.index.get(preferredUid);
      const target=current||index.index.get(settings.data?.[0]?.current_keyword_class_uid)
        ||index.index.get(chosen.item)||index.index.get(chosen.group)
        ||index.index.get(chosen.class)||index.index.get(chosen.category)||firstClass||first;
      const lineage={},nodeType=target?.type;
      let node=target;
      while(node){lineage[node.type]=node.uid;node=parentOf(index,node.uid);}
      setPatternNodes(patterns);setRows(records);setConfig(settings.data?.[0]||{});setSavedConfig(settings.data?.[0]||{});
      setChosen({category:lineage.category||first?.uid||'',
        class:lineage.class||(target?.type==='category'?childrenOf(index,target.uid)[0]?.uid:'')||firstClass?.uid||'',
        group:lineage.group||'',item:lineage.item||''});
      setEditor(null);setPendingParent('');setKeywordText('');
      setNotice('');
    }catch(e){setError(String(e.message||e));}
    finally{setLoading(false);}
  },[canEdit,table,configTable,scopeId]);

  useEffect(()=>{load();},[load]);
  useEffect(()=>{
    discoveryAbort.current?.abort();
    setDiscovery(null);
    setDiscoveryPage(1);
    setDiscoveryProgress(null);
  },[scopeId]);
  useEffect(()=>()=>discoveryAbort.current?.abort(),[]);
  const choose=(type,uid)=>{
    const next={...chosen,[type]:uid};
    if(type==='class')next.category=tree.parent.get(uid)||'';
    if(type==='class'){next.group='';next.item='';}
    if(type==='group')next.item='';
    setChosen(next);setEditor(null);setKeywordText('');
    setError('');setNotice('');
  };
  const edit=(node=selected)=>{
    if(!node||node.type==='category')return;
    setPendingParent('');setEditor({node:{...node,lists:[...node.lists],uid_lists:[...node.uid_lists]}});
    setKeywordText(node.type==='item'?node.lists.join('\n'):'');
    setNotice('');
  };
  const create=(type,parentUid='')=>{
    if(!TYPES.includes(type))return;
    const node=freshNode(type,rows,scopeId);
    setEditor({node});setPendingParent(parentUid);
    setKeywordText('');setNotice('');
  };
  const markStale=async(uid)=>{
    const cl=classOf(tree,uid);
    if(!cl)return;
    const keyword_meta=invalidateKeywordClass(config.keyword_meta,cl.uid);
    const {error:staleError}=await dbAuthRelation(configTable)
      .update({keyword_meta,staticstime:null}).eq('id',scopeId);
    if(staleError)throw staleError;
  };
  const saveNode=async()=>{
    if(!draft||busy)return false;
    setBusy(true);setError('');
    try{
      const node={...draft,
        name:String(draft.name||'').trim(),
        lists:draft.type==='item'?onlyWords(keywordText):[...draft.lists]};
      if(!node.name)throw new Error('請填寫名稱');
      if(!TYPES.includes(node.type))throw new Error('Keywords Type 無效');
      const isNew=!tree.index.has(node.uid);
      if(node.type==='category')throw new Error('群組關鍵字目錄請到群組管理頁面編輯。');
      if(node.type==='item'&&isUnifiedAnchorScope(scopeId)){
         const {keywordService}=await import('./keyword-service-client.mjs');
         await keywordService('saveItem',{scopeId,item:{
           uid:node.uid,name:node.name,desc:String(node.desc||''),
           words:node.lists,mode:isNew?'create':'update',
           ...(isNew?{parentUid:pendingParent}:{})
         }});
       }else if(isNew&&node.type!=='class'){
         const parent=tree.index.get(pendingParent);
         const expected=TYPES[TYPES.indexOf(node.type)-1];
         if(!parent||parent.type!==expected)throw new Error('請先選擇上層分類。');
         await writeKeywordLibraryItem(scopeId,'insert',node);
         try{await writeKeywordLibraryItem(scopeId,'update',{
           ...parent,lists:[...parent.lists,node.uid]
         });}catch(error){
           await writeKeywordLibraryItem(scopeId,'delete',node).catch(()=>{});
           throw error;
         }
         await markStale(parent.uid);
       }else{
         await writeKeywordLibraryItem(scopeId,isNew?'insert':'update',node);
         await markStale(node.uid);
       }
       await load(node.uid);await invalidate();setNotice('已儲存；相關關鍵字群組需重新分析。');
      return true;
    }catch(e){setError(String(e.message||e));return false;}
    finally{setBusy(false);}
  };
  const removeNode=async(node=draft||selected)=>{
    if(!node||busy||node.type==='category')return;
    if(!window.confirm('刪除「'+node.name+'」及其下層分類？原始 Galaxy 文章不受影響。'))return;
    setBusy(true);setError('');
    try{
      if(node.type==='item'&&isUnifiedAnchorScope(scopeId)){
         const {keywordService}=await import('./keyword-service-client.mjs');
         await keywordService('deleteItem',{scopeId,itemUid:node.uid});
         await load(chosen.group||'');await invalidate();
         setNotice('已移除 Item 和無其他關聯的 Pattern，文章保留。');
         return;
       }
       const parent=parentOf(tree,node.uid);
      if(parent)await writeKeywordLibraryItem(scopeId,'update',{
        ...parent,lists:parent.lists.filter(uid=>uid!==node.uid)
      });
      await markStale(node.uid);
      const descendants=descendantsOfKeyword(rows,node.uid).reverse();
      const removedIds=new Set(descendants.map(row=>row.uid));
      const activeRemoved=removedIds.has(config.current_keyword_class_uid);
      for(const child of descendants)await writeKeywordLibraryItem(scopeId,'delete',child);
      const removedClasses=descendants.filter(child=>child.type==='class');
      if(removedClasses.length){
        let keyword_meta=config.keyword_meta||{};
        for(const deleted of removedClasses)
          keyword_meta=invalidateKeywordClass(keyword_meta,deleted.uid);
        const surviving=[...tree.index.values()].find(record=>
          record.type==='class'&&!removedIds.has(record.uid));
        const nextUid=activeRemoved?surviving?.uid||null:config.current_keyword_class_uid;
        const {error:settingsError}=await dbAuthRelation(configTable)
          .update({current_keyword_class_uid:nextUid,
            staticstime:null,keyword_meta})
          .eq('id',scopeId);
        if(settingsError)throw settingsError;
      }
      if(isUnifiedAnchorScope(scopeId)){
         const {keywordService}=await import('./keyword-service-client.mjs');
         await keywordService('syncLibrary',{scopeId});
       }
       await load(parent?.uid||'');await invalidate();
      setNotice('已刪除；不會刪除文章。');
    }catch(e){setError(String(e.message||e));}
    finally{setBusy(false);}
  };
  const saveClassShare=async(classUid,enabled)=>{
    if(busy||sharingBusy||!classUid)return;
    setSharingBusy(true);setError('');
    try{
      const {data,error:readError}=await dbAuthRelation(configTable)
        .select('keyword_meta').eq('id',scopeId).limit(1);
      if(readError||data?.length!==1)throw new Error(readError?.message||'讀取共享設定失敗');
      const currentMeta=data[0].keyword_meta||{};
      const keyword_meta={...currentMeta,
        class_shares:{...(currentMeta.class_shares||{}),[classUid]:Boolean(enabled)}};
      const {data:saved,error:saveError}=await dbAuthRelation(configTable)
        .update({keyword_meta}).eq('id',scopeId).select('id');
      if(saveError||saved?.length!==1)throw new Error(saveError?.message||'共享設定儲存失敗');
      setConfig(current=>({...current,keyword_meta}));
      setSavedConfig(current=>({...current,keyword_meta}));
      await invalidate();
      setNotice(enabled?'已開放此關鍵字群組。':'此關鍵字群組已設為不公開。');
    }catch(e){setError(String(e.message||e));}
    finally{setSharingBusy(false);}
  };
  const saveConfig=async()=>{
    if(busy)return false;
    setBusy(true);setError('');
    try{
      const rulesChanged=['keyword_min_chars','keyword_min_documents'].some(key=>Number(config[key])!==Number(savedConfig[key]));
      const targetUid=String(config.current_keyword_class_uid||'');
      const payload={
        current_keyword_class_uid:targetUid||null,
        keyword_min_chars:Number(config.keyword_min_chars)||0,
        keyword_min_documents:Number(config.keyword_min_documents)||0,
        // Legacy scope-wide date is not an analysis completion date.
        staticstime:null,
        ...(rulesChanged?{keyword_meta:{...(config.keyword_meta||{}),
          by_class:{},pattern_scans:{}}}:{})
      };
      const {data,error:writeError}=await dbAuthRelation(configTable).update(payload)
        .eq('id',scopeId).select('id');
      if(writeError||data?.length!==1)throw new Error(writeError?.message||'儲存設定失敗');
      await load();await invalidate();setNotice('設定已儲存。');return true;
    }catch(e){setError(String(e.message||e));return false;}
    finally{setBusy(false);}
  };
  const run=async(reset=false)=>{
    const runClassUid=activeClass?.uid;
    if(busy||!runClassUid)return;
    setBusy(true);setProgress({phase:'reading',percent:0});setError('');
    try{
      if(reset)await resetKeywordClassification(scopeId,{classUid:runClassUid,onProgress:setProgress});
      else{
        const {runKeywordAnalysisBatch}=await import('./keyword-analysis');
        await runKeywordAnalysisBatch(scopeId,{classUid:runClassUid,onProgress:setProgress});
      }
      await load(runClassUid);await invalidate();
      setNotice(reset?'已清空此關鍵字群組的分析結果。':'此關鍵字群組已重新分析完成。');
    }catch(e){setError(String(e.message||e));}
    finally{setBusy(false);}
  };
  const discoverNewTerms=async()=>{
    if(discoveryBusy||busy||loading)return;
    const controller=new AbortController();
    discoveryAbort.current=controller;
    setWorkspace('suggest');setDiscovery(null);setDiscoveryPage(1);setDiscoveryProgress(null);
    setDiscoveryBusy(true);setError('');setNotice('');
    try{
      const {suggestNewKeywords}=await import('./keyword-discovery-runner.mjs');
      const result=await suggestNewKeywords({
        galaxy:scope.galaxy,existingRows:rows,onProgress:setDiscoveryProgress,signal:controller.signal
      });
      if(!controller.signal.aborted){
        setDiscovery(result);
        setDiscoveryPage(1);
        // Results stay on screen only; reopening the page rescans. Nothing is
        // staged in the database.
      }
    }catch(e){
      if(controller.signal.aborted)setNotice('已停止新關鍵詞掃描，未修改任何資料。');
      else setError(String(e.message||e));
    }finally{
      if(discoveryAbort.current===controller){
        discoveryAbort.current=null;
        setDiscoveryBusy(false);
      }
    }
  };
  const openSuggestedTerms=async()=>{
    if(discoveryBusy||busy||loading)return;
    setWorkspace('suggest');setEditor(null);setError('');
    if(discovery)return;
    await discoverNewTerms();
  };
  const lookupPublicClass=async()=>{
    if(importBusy||busy)return;
    const from=importScope.trim().toLowerCase(),uid=importUid.trim();
    setImportClass(null);setError('');setNotice('');
    if(!/^[a-z][a-z0-9]{0,14}$/.test(from)||
      !(isUnifiedAnchorScope(from)?/^[0-9A-Za-z]{8}$/:/^[0-9A-Za-z]{4}$/).test(uid)){
      setError('請輸入來源資料代碼及公開的群組科目代碼（新版 8 碼、舊版 4 碼）。');return;
    }
    setImportBusy(true);
    try{
      // Anonymous reader returns only publicly shared Class rows, no Group/Item.
      const {data,error}=await dbPublicClient.schema('silver').analytics({
        p_scope_id:from,p_view:'shared_classes',p_start:null,p_end:null,p_options:{}
      });
      if(error)throw new Error(error.message||'查詢公開群組科目失敗');
      const found=(Array.isArray(data)?data:[]).find(item=>item.classUid===uid);
      if(!found)throw new Error('在這個資料來源中找不到指定的公開群組科目。');
      setImportClass({scopeid:from,uid,name:String(found.name||uid)});
    }catch(error){setError(String(error.message||error));}
    finally{setImportBusy(false);}
  };
  const importPublicClass=async()=>{
    const from=importScope.trim().toLowerCase(),uid=importUid.trim();
    if(!importClass||from!==importClass.scopeid||uid!==importClass.uid||busy||importBusy)return;
    setImportBusy(true);setError('');setNotice('');
    try{
      // Server checks actual source Class and published flag. The import
      // transaction allocates fresh UIDs and clears source article hit lists.
      const {data,error}=await dbAuthClient.schema('silver').managedAction('import_shared_keyword_class',{
        p_target_scope:scopeId,p_source_scope:from,p_class_uid:uid
      });
      if(error||!/^[0-9A-Za-z]{4}(?:[0-9A-Za-z]{4})?$/.test(String(data?.uid||'')))
        throw new Error(error?.message||'匯入尚未完成，未新增關鍵字群組科目');
      await load(data.uid);await invalidate();
      setNotice('已匯入群組科目「'+importClass.name+'」，含 '+Number(data.group_count||0)+' 個分類群組、'+Number(data.item_count||0)+' 個關鍵詞分類。分析結果需在目前資料來源重新計算。');
      setImportClass(null);setImportUid('');
    }catch(error){setError(String(error.message||error));}
    finally{setImportBusy(false);}
  };
  const copyClass=async()=>{
    const from=activeClass?.uid,to=copyName.trim();
    if(!from||!to)return;
    setBusy(true);setError('');
    try{
      const result=await copyKeywordLibraryClass(scopeId,from,to);
      await load(result.uid);await invalidate();setCopyName('');
      setNotice('已複製關鍵字群組「'+to+'」。');
    }catch(e){setError(String(e.message||e));}
    finally{setBusy(false);}
  };
  dockActions.current={
    save:()=>workspace==='suggest'?undefined:workspace==='analysis'?saveConfig():saveNode(),
    isDirty:()=>workspace==='suggest'?false:workspace==='analysis'
      ?['current_keyword_class_uid','keyword_min_chars','keyword_min_documents']
        .some(key=>String(config[key]??'')!==String(savedConfig[key]??''))
      :dirty,
    isBusy:()=>busy||loading||sharingBusy||discoveryBusy
  };
  useEffect(()=>{
    if(!dock?.active||dock.scopeId!==scopeId||!canEdit)return;
    return dock.register({
      save:()=>dockActions.current.save(),
      isDirty:()=>dockActions.current.isDirty(),
      isBusy:()=>dockActions.current.isBusy()
    });
  },[dock?.active,dock?.scopeId,dock?.register,scopeId,canEdit]);
  if(!canEdit)return null;
  const selectedClass=activeClass;
  const allClassNodes=[...tree.index.values()].filter(x=>x.type==='class');
  const knownTerms=new Set(rows.filter(item=>item.type==='item').flatMap(item=>[
    item.name,...(Array.isArray(item.lists)?item.lists:[])
  ]).map(value=>String(value||'').normalize('NFKC').trim().toLocaleLowerCase()));
  const suggestedCandidates=(discovery?.candidates||[]).filter(item=>
    !knownTerms.has(String(item.word||'').normalize('NFKC').trim().toLocaleLowerCase()));
  const suggestionPageSize=20;
  const suggestionPages=Math.max(1,Math.ceil(suggestedCandidates.length/suggestionPageSize));
  const currentSuggestionPage=Math.min(discoveryPage,suggestionPages);
  const visibleSuggestions=suggestedCandidates.slice(
    (currentSuggestionPage-1)*suggestionPageSize,currentSuggestionPage*suggestionPageSize);
  // Keep vis-network's data stable while typing in the adjacent inspector.
  const graphItems=useMemo(()=>selectedClass?descendantsOfKeyword(rows,selectedClass.uid,{type:'item'}).map(node=>{
    const group=parentOf(tree,node.uid);
    return {keyword_id:node.uid,item_name:node.name,keywords:node.lists,
      group_uid:group?.uid||'',class_group:group?.name||'',class_name:selectedClass.name};
  }):[],[rows,tree,selectedClass?.uid]);
  const graphGroups=useMemo(()=>groups.map(row=>({uid:row.uid,name:row.name})),
    [groups.map(row=>row.uid+'|'+row.name).join('|')]);
  // Reuse exactly the manual editor in the graph's inspector, including the
  // existing authorization, edit dock, stale-analysis and save behavior.
  const draftEditor=draft?<div className="scope-management-editor">
        <h3>{tree.index.has(draft.uid)?'編輯':'新增'} {LABEL[draft.type]}</h3>
        <div className="scope-management-fields">
          <label><span>名稱</span><input value={draft.name} onChange={e=>setEditor({node:{...draft,name:e.target.value}})}/></label>
          <label><span>說明</span><textarea rows={2} value={draft.desc} onChange={e=>setEditor({node:{...draft,desc:e.target.value}})}/></label>
        </div>
        {draft.type==='item'?<label className="scope-management-wide-field">
          <span>Pattern 關鍵詞（一行一詞，規則保留）</span>
          <textarea rows={9} value={keywordText} onChange={e=>setKeywordText(e.target.value)}/>
          <small className="scope-status">規則範例：家園AND音樂（連結兩個 Item，音樂加 1 筆）；水土TO地（指定計入地）；家園NOR旅館（家園旅館不計入家園，其他詞照常計算）。每行一筆。</small>
        </label>:null}
        <div className="scope-preview-links">
          {!inDock?<button type="button" className="loc-button primary" disabled={busy||!draft.name.trim()} onClick={saveNode}>{busy?'儲存中…':'儲存'}</button>:null}
          {tree.index.has(draft.uid)?<button type="button" className="loc-button scope-danger-button" disabled={busy} onClick={()=>removeNode(draft)}>刪除</button>:null}
          {!inDock?<button type="button" className="loc-button" onClick={()=>setEditor(null)} disabled={busy}>取消</button>:null}
        </div>
      </div>:null;
  return <div className="scope-keyword-management">
    <ManagementSectionNav id="scope-keyword-sections" title="關鍵詞管理"
      panelId="scope-keyword-workspace" items={workspaceOptions}
      value={workspace} onChange={next=>{
        if(next==='suggest'){void openSuggestedTerms();return;}
        setWorkspace(next);setEditor(null);
      }}/>
    <div id="scope-keyword-workspace">
    {loading?<p className="scope-status" role="status">讀取關鍵字資料中…</p>:null}
    {error?<p className="scope-status scope-error" role="alert">{error}</p>:null}
    {notice?<p className="scope-status" role="status">{notice}</p>:null}
    {!loading&&workspace==='manual'?<section className="loc-card scope-feature-card">
      <h2>關鍵字分類與判斷詞編輯</h2>
      <div className="scope-management-fields">
        {TYPES.map((type,index)=>{
          const parent=index?tree.index.get(chosen[TYPES[index-1]]):null;
          const options=index?childrenOf(tree,parent?.uid):classes;
          return <label key={type}><span>{LABEL[type]}</span>
            <select className="scope-select" value={chosen[type]} onChange={e=>choose(type,e.target.value)}
              disabled={index>0&&!parent}>
              <option value="">選擇 {LABEL[type]}</option>
              {options.map(row=><option key={row.uid} value={row.uid}>{row.name}</option>)}
            </select>
            <button type="button" className="loc-button" disabled={busy||(index>0&&!parent)}
              onClick={()=>create(type,parent?.uid||'')}>新增</button>
          </label>;
        })}
      </div>
      {selected?.type==='item'&&Array.isArray(selectedSourceRow?.patternUids)&&selectedSourceRow?.patternUids.length
         ?<div className="scope-search-active-filters" aria-label="Item 關聯 Pattern">
           {selectedSourceRow.patternUids.map(uid=>patternNodes.get(uid)).filter(Boolean).map(row=>
             <span key={row.uid} className="scope-search-chip">
               {row.name} · {config.keyword_meta?.pattern_index_version==='scope_anchor_v1'&&config.keyword_meta?.pattern_scans?.[
                 String(row.name||'').normalize('NFKC').trim().toLocaleLowerCase('zh-Hant')
               ]?Number(row.num||0).toLocaleString()+' 篇':'待解析'}
             </span>)}
         </div>:null}
       {selected?<div className="scope-preview-links">
        <button className="loc-button" type="button" disabled={busy} onClick={()=>edit(selected)}>編輯「{selected.name}」</button>
        <span className="scope-status">{LABEL[selected.type]}：{selected.lists.length}{selected.type==='item'?' 個判斷詞':' 筆'}</span>
      </div>:null}
      {!classes.length?<p className="scope-status">尚無關鍵字群組科目，可先建立科目，再新增分類群組與判斷詞。</p>:null}
      {draftEditor}
      {activeClass?<div className="scope-stat-controls">
        <label><span>「{activeClass.name}」公開設定</span>
          <select className="scope-select" value={classShareEnabled(activeClass.uid)?'yes':'no'}
            disabled={busy||sharingBusy}
            onChange={e=>saveClassShare(activeClass.uid,e.target.value==='yes')}>
            <option value="no">不公開</option><option value="yes">公開</option>
          </select>
        </label>
        {classShareEnabled(activeClass.uid)
          ?<span className="scope-status">公開群組科目代碼：<code>{activeClass.uid}</code></span>:null}
        {classShareEnabled(activeClass.uid)?<p className="scope-status">
          公開群組科目代碼：<code>{activeClass.uid}</code>（來源：{scopeId}）
        </p>:null}
      </div>:null}
      <div className="scope-stat-controls">
        <label><span>複製選定的關鍵字群組科目</span><input value={copyName} placeholder="新科目名稱"
          onChange={e=>setCopyName(e.target.value)}/></label>
        <button type="button" className="loc-button" disabled={!selectedClass||!copyName.trim()||busy} onClick={copyClass}>複製整套科目</button>
      </div>
      <details className="scope-import-maintenance">
        <summary>關鍵字群組科目匯入</summary>
        <div className="scope-import-maintenance-content">
          <p className="scope-status">輸入資料來源代碼與公開群組科目代碼（新版 8 碼、舊版 4 碼）。只會匯入分類規則，不會複製文章。</p>
          <div className="scope-management-fields">
            <label><span>資料來源代碼（Scope ID）</span>
              <input value={importScope} autoCapitalize="off" spellCheck={false}
                placeholder="例如 lo3rwang" onChange={event=>{
                  setImportScope(event.target.value.toLowerCase());setImportClass(null);
                }}/></label>
            <label><span>公開群組科目代碼（8 碼／舊版 4 碼）</span>
              <input value={importUid} maxLength={8} autoCapitalize="off" spellCheck={false}
                placeholder="例如 ZCBXGIGR" onChange={event=>{setImportUid(event.target.value);setImportClass(null);}}/></label>
          </div>
          <div className="scope-preview-links">
            <button type="button" className="loc-button" disabled={busy||importBusy}
              onClick={lookupPublicClass}>{importBusy?<ActivityMotion kind="import"/>:null}{importBusy?'核對中…':'查詢公開科目'}</button>
            {importClass?<button type="button" className="loc-button primary" disabled={busy||importBusy}
              onClick={importPublicClass}>匯入「{importClass.name}」</button>:null}
          </div>
          {importClass?<p className="scope-status">已核對：{importClass.scopeid}／{importClass.uid}（只匯入分類規則，不含文章或統計結果）</p>:null}
        </div>
      </details>
    </section>:null}
    {!loading&&workspace==='analysis'?<section className="loc-card scope-feature-card">
      <h2>基本設定（適用於目前資料來源）</h2>
      <div className="scope-management-fields">
        <label><span>目前使用的關鍵字群組</span><select className="scope-select" value={config.current_keyword_class_uid||''}
          onChange={e=>setConfig(v=>({...v,current_keyword_class_uid:e.target.value}))}>
          <option value="">未選擇</option>
          {allClassNodes.map(row=><option value={row.uid} key={row.uid}>{row.name}</option>)}
        </select></label>
        <label><span>文章最少字元</span><input type="number" min="0" value={config.keyword_min_chars??32}
          onChange={e=>setConfig(v=>({...v,keyword_min_chars:e.target.value}))}/></label>
        <label><span>統計最低文章數</span><input type="number" min="0" value={config.keyword_min_documents??100}
          onChange={e=>setConfig(v=>({...v,keyword_min_documents:e.target.value}))}/></label>
      </div>
      {!inDock?<button type="button" className="loc-button primary" disabled={busy} onClick={saveConfig}>儲存設定</button>:null}
    </section>:null}
    {!loading&&workspace==='run'?<section className="loc-card scope-feature-card">
      <h2>重新分析</h2>
      <label>選擇要解析的關鍵詞科目（Class）
        <select className="scope-select" value={activeClass?.uid||''}
          disabled={busy} onChange={event=>choose('class',event.target.value)}>
          <option value="">請選擇科目</option>
          {allClassNodes.map(node=><option key={node.uid} value={node.uid}>
            {node.name} · {keywordClassState(config,node.uid)?.completedAt
              ?new Date(keywordClassState(config,node.uid).completedAt).toLocaleDateString('zh-TW')
              :'未解析'}
          </option>)}
        </select>
      </label>
      <p className="scope-status">所選科目：{activeClass?.name||'尚未選擇'} · 該科目上次解析：{keywordClassState(config,activeClass?.uid)?.completedAt?new Date(keywordClassState(config,activeClass.uid).completedAt).toLocaleString('zh-TW'):'尚未解析'}</p>
      <p className="scope-status">有效分類文章：{Number(keywordClassState(config,activeClass?.uid)?.matchedDocuments||0).toLocaleString()} 篇</p>
      <div className="scope-preview-links">
        <button type="button" className="loc-button primary" disabled={busy||!activeClass?.uid}
          onClick={()=>run(false)}>重新分析</button>
        <button type="button" className="loc-button" disabled={busy||!activeClass?.uid}
          onClick={()=>run(true)}>清空本群組的分析結果</button>
      </div>
      {progress?<p role="status" className="scope-status">{busy?<ActivityMotion kind="keywords"/>:null} {progress.label||progress.phase}
        {progress.total?' · '+progress.completed+' / '+progress.total:''}</p>:null}
    </section>:null}
    {!loading&&workspace==='suggest'?<section className="loc-card scope-feature-card">
      <h2>建議新增關鍵詞</h2>
      <p className="scope-status">只從目前資料來源的文章內文找出尚未收錄的詞與詞組；不修改既有關鍵詞，也不會自動新增。</p>
      {discoveryBusy?<div className="scope-preview-links">
        <p className="scope-status" role="status"><ActivityMotion kind="keywords"/> 分析中：{Number(discoveryProgress?.completed||0).toLocaleString()} / {Number(discoveryProgress?.total||0).toLocaleString()} 篇</p>
        <button className="loc-button" type="button" onClick={()=>discoveryAbort.current?.abort()}>停止掃描</button>
      </div>:null}
      {discovery&&!discoveryBusy?<div>
        {discovery.cachedOnly?<p className="scope-status" role="status">
          已載入先前儲存的 {suggestedCandidates.length} 個新詞候選；只有詞語列表，重新掃描才會取得即時篇數與趨勢。
        </p>:<p className="scope-status" role="status">
          已掃描 {Number(discovery.read||0).toLocaleString()} 篇；有內文 {Number(discovery.withContent||0).toLocaleString()} 篇；
          目前 {suggestedCandidates.length} 個未收錄候選。
        </p>}
        {discovery.dense?<p className="scope-status">
          新詞密集段：{discovery.dense.start} 至 {discovery.dense.end} · 平均每篇 {discovery.dense.novelPerArticle.toFixed(2)} 次候選命中
          {discovery.dense.detectedByPelt?'（PELT 變點）':'（目前未偵測到明顯變點）'}
        </p>:null}
        {discovery.sparse?<p className="scope-status">
          新詞稀疏段：{discovery.sparse.start} 至 {discovery.sparse.end} ·
          既有關鍵詞字面涵蓋率 {(discovery.sparse.existingRatio*100).toFixed(1)}%
        </p>:discovery.dense?<p className="scope-status">
          尚無可辨識的密／空分段；全期既有關鍵詞字面涵蓋率 {(Number(discovery.overallExistingRatio||0)*100).toFixed(1)}%
        </p>:null}
        {discovery.limited?<p className="scope-status scope-error">不重複候選詞過多，已達分析記憶體上限；列表可能不完整。</p>:null}
        {suggestedCandidates.length?<div>
          <ol className="scope-keyword-discovery-results" start={(currentSuggestionPage-1)*suggestionPageSize+1}>
            {visibleSuggestions.map(term=><li key={term.word}>
              <strong>{term.word}</strong>
              {!discovery.cachedOnly?<span className="scope-status"> · {Number(term.documents||0).toLocaleString()} 篇文章
                {term.denseDocuments>0?' · 密集段 '+term.denseDocuments+' 篇':''}
                · {Number(term.occurrences||0).toLocaleString()} 次出現
                {term.trendChanges>0?' · PELT 趨勢變化':''}
              </span>:null}
              {term.sample?<p className="scope-status">{term.sample}</p>:null}
            </li>)}
          </ol>
          {suggestionPages>1?<div className="scope-preview-links" role="navigation" aria-label="建議關鍵詞分頁">
            <button type="button" className="loc-button" disabled={currentSuggestionPage===1}
              onClick={()=>setDiscoveryPage(page=>Math.max(1,page-1))}>上一頁</button>
            <span className="scope-status">第 {currentSuggestionPage} / {suggestionPages} 頁 · 每頁 {suggestionPageSize} 筆</span>
            <button type="button" className="loc-button" disabled={currentSuggestionPage===suggestionPages}
              onClick={()=>setDiscoveryPage(page=>Math.min(suggestionPages,page+1))}>下一頁</button>
          </div>:null}
        </div>:<p className="scope-status">沒有符合基本出現篇數門檻、且尚未收錄的新詞。</p>}
      </div>:null}
      {!discoveryBusy&&discovery?<button type="button" className="loc-button" onClick={discoverNewTerms}>重新掃描內文</button>:null}
    </section>:null}
    {!loading&&workspace==='network'?<section className="loc-card scope-feature-card">
      <h2>關聯圖</h2>
      {selectedClass?<div className="scope-keyword-network-layout">
        <KeywordNetworkEditor items={graphItems}
          groups={graphGroups}
          className={selectedClass.name} classId={selectedClass.uid}
          selectedId={chosen.item}
          onSelectClass={()=>{setChosen(prev=>({...prev,class:selectedClass.uid,group:'',item:''}));edit(selectedClass);}}
          onSelectGroup={uid=>{const group=tree.index.get(uid);if(group){setChosen(prev=>({...prev,class:selectedClass.uid,group:uid,item:''}));edit(group);}}}
          onSelectItem={item=>{
            const node=tree.index.get(String(item.keyword_id));
            if(!node)return;
            setChosen(prev=>({...prev,class:selectedClass.uid,group:String(item.group_uid||''),item:node.uid}));
            edit(node);
          }}
          onNewGroup={()=>create('group',selectedClass.uid)}
          onNewItem={groupUid=>{const group=groups.find(row=>row.uid===groupUid);if(group)create('item',group.uid);}}
          onMessage={setNotice}
        />
        <aside className="scope-keyword-network-inspector" aria-label="關聯圖節點編輯">
          {draftEditor||<p className="scope-status">點選圖上的科目、群組或關鍵詞分類，就能在這裡編輯。選取群組後可新增下層分類。</p>}
        </aside>
      </div>:<p className="scope-status">請先在群組對應調整建立關鍵字群組科目。</p>}
    </section>:null}
    </div>
  </div>;
}
