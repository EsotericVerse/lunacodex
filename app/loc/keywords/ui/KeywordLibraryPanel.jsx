'use client';
import {lazy,Suspense} from 'react';

import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useQueryClient} from '../../../../packages/zenstack/client-queries';
import {useEditDock} from '../../../modular/edit-dock';
import {dbAuthRelation,dbPublicClient,dbAuthClient,resetKeywordClassification,updateRows,transactionWrites,prepareKeywordLibraryWrite,writeKeywordLibraryItem,copyKeywordLibraryClass} from '../../db/db-client.mjs';
import {indexKeywordTree,descendantsOfKeyword} from '../tree.mjs';
import {allocateAnchorUid} from '../../model/uid.js';
import ManagementSectionNav from '../../../modular/ManagementSectionNav';
import ActivityMotion from '../../../modular/ActivityMotion';
import FlowProgress from '../../../modular/FlowProgress';
import {keywordClassState,invalidateKeywordClass} from '../class-state.mjs';
import {classSkipArticleWords} from '../class-exceptions.mjs';

const LazyKeywordNetworkEditor=lazy(()=>import('./KeywordNetworkEditor'));
function KeywordNetworkEditor(props){return <Suspense fallback={null}><LazyKeywordNetworkEditor {...props}/></Suspense>;}
const LazyBlockNoteEditor=lazy(()=>import('../../editor/BlockNoteEditor'));
function BlockNoteEditor(props){return <Suspense fallback={null}><LazyBlockNoteEditor {...props}/></Suspense>;}
const TYPES=['class','group','item'];
const LABEL={category:'關鍵字目錄',class:'關鍵字群組科目',group:'關鍵字分類群組',item:'關鍵詞分類'};
const onlyWords=value=>[...new Set(String(value||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean))];
const emptyTree={index:new Map(),parent:new Map(),roots:[]};
const uidFor=rows=>allocateAnchorUid(new Set(rows.map(row=>String(row.uid))));
function freshNode(type,rows,scopeId){
  return {uid:uidFor(rows),type,name:'',desc:'',lists:[],uid_lists:[]};
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
  const scope=account.scopeDataFor(scopeId),table=scope?.anchor||'';
  const configTable=scope?.config||'';
  const canEdit=account.canLocAccessSync('scope',scopeId)&&Boolean(table&&configTable);
  const dock=useEditDock(),dockActions=useRef(null);
  const inDock=Boolean(dock?.active&&dock.scopeId===scopeId);
  const queryClient=useQueryClient();
  const [rows,setRows]=useState([]);
  const [config,setConfig]=useState({});
  const [savedConfig,setSavedConfig]=useState({});
  const [editor,setEditor]=useState(null);
  const [pendingParent,setPendingParent]=useState('');
  const [keywordText,setKeywordText]=useState('');
  const [classExceptionText,setClassExceptionText]=useState('');
  const [workspace,setWorkspace]=useState('manual');
  const workspaceOptions=[
    {value:'manual',label:'群組對應調整'},
    {value:'analysis',label:'分析處理'},
    {value:'network',label:'關聯圖'}
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
  const [unconfirmedAttempt,setUnconfirmedAttempt]=useState(null);
  const [checkingAttempt,setCheckingAttempt]=useState(false);
  const [resetConfirmation,setResetConfirmation]=useState('');
  const receiptKey='loc-keyword-analysis-unconfirmed:'+scopeId;
  // Only UUID + Class UID are retained; no article bodies, Pattern postings
  // or credentials. Reloading the page must not discard an uncertain write.
  useEffect(()=>{
    try{
      const stored=JSON.parse(sessionStorage.getItem(receiptKey)||'null');
      if(stored&&/^[A-Za-z0-9]{8}$/.test(stored.classUid)&&
        /^[0-9a-f-]{36}$/i.test(stored.attemptId)&&
        Date.now()-Number(stored.savedAt)<86400000)
        setUnconfirmedAttempt(stored);
      else setUnconfirmedAttempt(null);
    }catch{setUnconfirmedAttempt(null);}
  },[receiptKey]);
  const storeUnconfirmed=attempt=>{
    setUnconfirmedAttempt(attempt);
    try{
      if(attempt)sessionStorage.setItem(receiptKey,JSON.stringify(attempt));
      else sessionStorage.removeItem(receiptKey);
    }catch{/* Metadata-only check remains available until navigation. */}
  };

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
  const draft=editor?.node||null;
  const classShareEnabled=uid=>{
    if(!uid)return false;
    return config.keyword_meta?.class_shares?.[uid]===true;
  };
  const dirty=Boolean(draft&&(
    !tree.index.has(draft.uid)||
    JSON.stringify(draft)!==JSON.stringify(tree.index.get(draft.uid))
  ))||Boolean(draft?.type==='item'&&keywordText!==((draft.lists||[]).join('\n')))
    ||Boolean(draft?.type==='class'&&classExceptionText!==
      classSkipArticleWords(draft.attr||{}).join('\n'));

  const invalidate=useCallback(async()=>{
    const {clearKeywordAnalysisCache}=await import('../analysis');
    clearKeywordAnalysisCache();
    await queryClient.invalidateQueries({predicate:query=>Array.isArray(query.queryKey)&&/keyword|culture-style-filter|statistics-style-filter/.test(String(query.queryKey[0]||''))});
  },[queryClient]);

  const load=useCallback(async(preferredUid='')=>{
    if(!canEdit)return;
    setLoading(true);setError('');
    try{
      // Fixed Keyword Workspace transaction replaces the retired generic
      // authenticated SELECT. Each request is a bounded read of the physical
      // Anchor/Scope configuration with its grant checked by the server.
      const {keywordService}=await import('../service-client.mjs');
      const owned=[],seen=new Set();
      let cursor='',config=null;
      for(;;){
        const page=await keywordService('workspace',{scopeId,cursor,limit:250});
        if(!Array.isArray(page?.rows)||page.rows.length>250||!page.config)
          throw new Error('關鍵詞管理資料回傳格式無效');
        if(config===null)config=page.config;
        for(const row of page.rows){
          if(seen.has(row.uid))throw new Error('關鍵詞管理 UID 重複');
          seen.add(row.uid);
          owned.push({...row,name:String(row.title||''),
            desc:String(row.description||''),
            lists:Array.isArray(row.attr?.[row.type==='item'?'keyword':'uid'])
              ?row.attr[row.type==='item'?'keyword':'uid']:[],uid_lists:[]});
        }
        if(!page.nextCursor)break;
        if(page.nextCursor===cursor||!page.rows.length)
          throw new Error('關鍵詞管理續讀游標無效');
        cursor=page.nextCursor;
      }
      const found={rows:owned},settings={data:[config]};
      const records=(found.rows||[]).map(row=>({...row,uid_lists:[]})),
        index=indexKeywordTree(records);
      const first=index.roots[0];
      const firstClass=[...index.index.values()].find(row=>row.type==='class');
      const current=index.index.get(preferredUid);
      const target=current||index.index.get(settings.data?.[0]?.current_keyword_class_uid)
        ||index.index.get(chosen.item)||index.index.get(chosen.group)
        ||index.index.get(chosen.class)||index.index.get(chosen.category)||firstClass||first;
      const lineage={},nodeType=target?.type;
      let node=target;
      while(node){lineage[node.type]=node.uid;node=parentOf(index,node.uid);}
      setRows(records);setConfig(settings.data?.[0]||{});setSavedConfig(settings.data?.[0]||{});
      setChosen({category:lineage.category||first?.uid||'',
        class:lineage.class||(target?.type==='category'?childrenOf(index,target.uid)[0]?.uid:'')||firstClass?.uid||'',
        group:lineage.group||'',item:lineage.item||''});
      setEditor(null);setPendingParent('');setKeywordText('');
      setNotice('');
    }catch(e){setError(String(e.message||e));}
    finally{setLoading(false);}
  },[canEdit,table,configTable,scopeId]);

  useEffect(()=>{load();},[load]);
  // The editor uses authored Item.keyword directly.
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
    setChosen(next);setEditor(null);setKeywordText('');setClassExceptionText('');
    setError('');setNotice('');
  };
  const edit=(node=selected)=>{
    if(!node||node.type==='category')return;
    setPendingParent('');setEditor({node:{...node,lists:[...node.lists],uid_lists:[...node.uid_lists]}});
    setKeywordText(node.type==='item'?node.lists.join('\n'):'');
    setClassExceptionText(node.type==='class'?classSkipArticleWords(node.attr||{}).join('\n'):'');
    setNotice('');
  };
  const create=(type,parentUid='')=>{
    if(!TYPES.includes(type))return;
    const node=freshNode(type,rows,scopeId);
    setEditor({node});setPendingParent(parentUid);
    setKeywordText('');setClassExceptionText('');setNotice('');
  };
  const staleWriteFor=uid=>{
    const cl=classOf(tree,uid);
    if(!cl)return null;
    // Keep the last completion receipt to confirm lost HTTP responses.
    // Changed Class rules cannot reuse the old per-word scan timestamps.
    const meta=config.keyword_meta||{},by_class={...(meta.by_class||{})};
    if(by_class[cl.uid])by_class[cl.uid]={...by_class[cl.uid],stale:true};
    const scans={...(meta.pattern_scans||{})};
    for(const item of descendantsOfKeyword(rows,cl.uid,{type:'item'})){
      for(const word of [item.name,...(item.lists||[])]){
        delete scans[String(word).normalize('NFKC').trim().toLocaleLowerCase('zh-Hant')];
      }
    }
    const keyword_meta={...meta,by_class,pattern_scans:scans};
    return {p_table:configTable,p_operation:'update',
      p_values:{keyword_meta,staticstime:null},
      p_filters:[{column:'id',operator:'eq',value:scopeId}]};
  };
  const markStale=async uid=>{
    const write=staleWriteFor(uid);
    if(write)await transactionWrites([write]);
  };
  const draftKeywordNode=()=>{
    if(!draft)throw Error('關鍵詞編輯資料尚未就緒');
    const node={...draft,
      name:String(draft.name||'').trim(),
      lists:draft.type==='item'?onlyWords(keywordText):[...draft.lists],
      attr:draft.type==='class'?{
        ...(draft.attr||{}),
        exceptions:{
          ...(draft.attr?.exceptions||{}),
          skip_article:onlyWords(classExceptionText)
        }
      }:draft.attr
    };
    if(node.type==='class')classSkipArticleWords(node.attr);
    if(!node.name)throw new Error('請填寫名稱');
    if(!TYPES.includes(node.type))throw new Error('Keywords Type 無效');
    if(node.type==='category')throw new Error('關鍵字目錄請至群組管理編輯');
    return node;
  };
  const prepareKeywordNodeTransaction=async()=>{
    if(busy)throw Error('關鍵詞編輯仍在執行');
    const node=draftKeywordNode();
    if(node.type==='item')
      throw Error('Item／Pattern 必須使用既有關鍵詞專用交易，請單獨儲存。');
    const isNew=!tree.index.has(node.uid),operations=[];
    operations.push(await prepareKeywordLibraryWrite(scopeId,isNew?'insert':'update',node));
    let staleUid=node.uid;
    if(isNew&&node.type!=='class'){
      const parent=tree.index.get(pendingParent);
      const expected=TYPES[TYPES.indexOf(node.type)-1];
      if(!parent||parent.type!==expected)throw new Error('請先選擇上層分類。');
      operations.push(await prepareKeywordLibraryWrite(scopeId,'update',{
        ...parent,lists:[...parent.lists,node.uid]
      }));
      staleUid=parent.uid;
    }
    const stale=staleWriteFor(staleUid);
    if(stale)operations.push(stale);
    return {operations,
      afterCommit:async()=>{
        await load(node.uid);await invalidate();
        setNotice('已儲存；相關關鍵字群組需重新分析。');
      },
      onFailure:error=>setError(String(error?.message||error))};
  };
  const saveNode=async()=>{
    if(!draft||busy)return false;
    setBusy(true);setError('');
    try{
      const node=draftKeywordNode();
      if(node.type==='item'){
        const {keywordService}=await import('../service-client.mjs');
        await keywordService('saveItem',{scopeId,item:{
          uid:node.uid,name:node.name,desc:String(node.desc||''),
          words:node.lists,
          mode:tree.index.has(node.uid)?'update':'create',
          ...(!tree.index.has(node.uid)?{parentUid:pendingParent}:{})
        }});
        await load(node.uid);await invalidate();
        setNotice('已儲存；相關關字群組需重新分析。');
      }else{
        const plan=await prepareKeywordNodeTransaction();
        await transactionWrites(plan.operations);
        try{await plan.afterCommit();}
        catch{setError('資料已提交，但關鍵詞畫面更新失敗；請重新讀取。');}

      }
      return true;
    }catch(error){setError(String(error?.message||error));return false;}
    finally{setBusy(false);}
  };
  const removeNode=async(node=draft||selected)=>{
    if(!node||busy||node.type==='category')return;
    if(!window.confirm('刪除「'+node.name+'」及其下層分類？原始 Galaxy 文章不受影響。'))return;
    setBusy(true);setError('');
    try{
      if(node.type==='item'){
         const {keywordService}=await import('../service-client.mjs');
         await keywordService('deleteItem',{scopeId,itemUid:node.uid});
         await load(chosen.group||'');await invalidate();
         setNotice('已移除 Item，文章保留。');
         return;
       }
       const parent=parentOf(tree,node.uid);
       const descendants=descendantsOfKeyword(rows,node.uid).reverse();
       const removedIds=new Set(descendants.map(row=>row.uid));
       const activeRemoved=removedIds.has(config.current_keyword_class_uid);
       const removedClasses=descendants.filter(child=>child.type==='class');
       const operations=[];
       if(parent)operations.push(await prepareKeywordLibraryWrite(scopeId,'update',{
         ...parent,lists:parent.lists.filter(uid=>uid!==node.uid)
       }));
       if(removedClasses.length){
         let keyword_meta=config.keyword_meta||{};
         for(const deleted of removedClasses)
           keyword_meta=invalidateKeywordClass(keyword_meta,deleted.uid);
         const surviving=[...tree.index.values()].find(record=>
           record.type==='class'&&!removedIds.has(record.uid));
         const nextUid=activeRemoved?surviving?.uid||null:config.current_keyword_class_uid;
         operations.push({p_table:configTable,p_operation:'update',
           p_values:{current_keyword_class_uid:nextUid,staticstime:null,keyword_meta},
           p_filters:[{column:'id',operator:'eq',value:scopeId}]});
       }else{
         const stale=staleWriteFor(node.uid);
         if(stale)operations.push(stale);
       }
       for(const child of descendants){
         const deletion=await prepareKeywordLibraryWrite(scopeId,'delete',child);
         operations.push({...deletion,p_expected_count:1});
       }
       // Parent detach, descendant deletion, and Config invalidation
       // share the same SQL COMMIT/ROLLBACK; no empty Pattern sync step.
       await transactionWrites(operations);
       await load(parent?.uid||'');await invalidate();
      setNotice('已刪除；不會刪除文章。');
    }catch(e){setError(String(e.message||e));}
    finally{setBusy(false);}
  };
  const saveClassShare=async(classUid,enabled)=>{
    if(busy||sharingBusy||!classUid)return;
    setSharingBusy(true);setError('');
    try{
      const {keywordService}=await import('../service-client.mjs');
      const saved=await keywordService('setClassShare',{
        scopeId,classUid,enabled:Boolean(enabled)
      });
      const keyword_meta=saved?.keyword_meta;
      if(!keyword_meta||typeof keyword_meta!=='object')
        throw Error('共享設定回執無效，請重新讀取資料。');
      setConfig(current=>({...current,keyword_meta}));
      setSavedConfig(current=>({...current,keyword_meta}));
      await invalidate();
      setNotice(enabled?'已開放此關鍵字群組。':'此關鍵字群組已設為不公開。');
    }catch(e){setError(String(e.message||e));}
    finally{setSharingBusy(false);}
  };
  const prepareKeywordConfigTransaction=()=>{
    if(busy||loading)throw Error('關鍵詞管理資料尚未載入');
      const scanRuleChanged=Number(config.keyword_min_chars)!==
        Number(savedConfig.keyword_min_chars);
      // A display threshold does not change any Pattern posting.
      // If the content threshold changes, invalidate scan clocks but preserve
      // historic completion receipts (including attemptId) for confirmation.
      const meta=config.keyword_meta||{};
      const invalidated=scanRuleChanged?{
        ...meta,pattern_scans:{},
        by_class:Object.fromEntries(Object.entries(meta.by_class||{})
          .map(([uid,record])=>[uid,{...record,stale:true}]))
      }:null;
      const targetUid=String(config.current_keyword_class_uid||'');
      const payload={
        current_keyword_class_uid:targetUid||null,
        keyword_min_chars:Number(config.keyword_min_chars)||0,
        keyword_min_documents:Number(config.keyword_min_documents)||0,
        // Legacy scope-wide date is not an analysis completion date.
        staticstime:null,
        ...(scanRuleChanged?{keyword_meta:invalidated}:{})
      };
      return {operations:[{p_table:configTable,p_operation:'update',
        p_values:payload,p_filters:[{column:'id',operator:'eq',value:scopeId}]}],
        afterCommit:async()=>{
          await load();await invalidate();setNotice('設定已儲存。');
        },
        onFailure:error=>setError(String(error?.message||error))
      };
  };
  const saveConfig=async()=>{
    if(busy||loading)return false;
    setBusy(true);setError('');
    try{
      const plan=prepareKeywordConfigTransaction();
      await transactionWrites(plan.operations);
      await plan.afterCommit();
      return true;
    }catch(e){setError(String(e.message||e));return false;}
    finally{setBusy(false);}
  };
  const run=async(reset=false)=>{
    const runClassUid=activeClass?.uid;
    // A pending HTTP receipt blocks only another analysis, never an explicitly
    // confirmed reset. Reset increments the class epoch before clearing data,
    // so a disconnected old scan cannot publish stale totals afterwards.
    if(busy||checkingAttempt||!runClassUid||
      !reset&&unconfirmedAttempt?.classUid===runClassUid)return;
    if(reset&&resetConfirmation!==runClassUid){
      setResetConfirmation(runClassUid);
      setNotice('請再次按下「確認清空」；只會清除選定 Class 的分析結果，文章與關鍵詞定義保留。');
      setError('');
      return;
    }
    setResetConfirmation('');
    setBusy(true);setProgress({phase:'reading',percent:0});setError('');setNotice('');
    try{
      if(reset){
        await resetKeywordClassification(scopeId,{classUid:runClassUid,onProgress:setProgress});
        // The reset transaction has committed; its newer epoch invalidates
        // the old job. Only now may the obsolete local receipt be discarded.
        if(unconfirmedAttempt?.classUid===runClassUid)storeUnconfirmed(null);
      }else{
        const {runKeywordAnalysisBatch}=await import('../analysis');
        await runKeywordAnalysisBatch(scopeId,{classUid:runClassUid,onProgress:setProgress});
      }
      await load(runClassUid);await invalidate();
      setNotice(reset?'已清空此關鍵字群組的分析結果。':'此關鍵字群組已重新分析完成。');
    }catch(e){
      if(e?.name==='KeywordAnalysisUnconfirmedError'&&e?.attemptId){
        storeUnconfirmed({classUid:runClassUid,attemptId:e.attemptId,savedAt:Date.now()});
      }
      setError(String(e.message||e));
    }finally{setBusy(false);setProgress(null);}
  };
  const checkUnconfirmed=async()=>{
    const attempt=unconfirmedAttempt;
    if(!attempt||checkingAttempt||busy)return;
    setCheckingAttempt(true);setError('');setNotice('');
    try{
      const {keywordService}=await import('../service-client.mjs');
      const result=await keywordService('analyzeStatus',{
        scopeId,classUid:attempt.classUid,attemptId:attempt.attemptId
      });
      if(result?.completed){
        storeUnconfirmed(null);
        await load(attempt.classUid);await invalidate();
        setNotice('已由資料庫回執確認這次分析完成，不需重新執行。');
      }else{
        setError('資料庫尚未找到這次分析的完成回執。可能仍在執行或已中止；目前未執行任何寫入。');
      }
    }catch(e){setError('核對失敗：'+String(e.message||e));}
    finally{setCheckingAttempt(false);}
  };
  const discardUnconfirmed=()=>{
    const attempt=unconfirmedAttempt;
    if(!attempt)return;
    if(!window.confirm('這不會取消伺服器可能仍在執行的分析，也不會清除資料。確定只放棄本次回執追蹤嗎？'))return;
    storeUnconfirmed(null);setNotice('已停止追蹤本次分析回執；未修改資料庫。');setError('');
  };
  const discoverNewTerms=async()=>{
    if(discoveryBusy||busy||loading)return;
    const controller=new AbortController();
    discoveryAbort.current=controller;
    setWorkspace('analysis');setDiscovery(null);setDiscoveryPage(1);setDiscoveryProgress(null);
    setDiscoveryBusy(true);setError('');setNotice('');
    try{
      const {suggestNewKeywords}=await import('../discovery-runner.mjs');
      const result=await suggestNewKeywords({
        galaxy:scope.galaxy,existingRows:rows,classUid:activeClass?.uid||'',
        onProgress:setDiscoveryProgress,signal:controller.signal
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
        setDiscoveryProgress(null);
        setDiscoveryBusy(false);
      }
    }
  };
  const lookupPublicClass=async()=>{
    if(importBusy||busy)return;
    const from=importScope.trim().toLowerCase(),uid=importUid.trim();
    setImportClass(null);setError('');setNotice('');
    if(!/^[a-z][a-z0-9]{0,14}$/.test(from)||
      !/^[0-9A-Za-z]{8}$/.test(uid)){
      setError('請輸入來源資料代碼及公開的群組科目代碼（8 碼）。');return;
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
      if(error||!/^[0-9A-Za-z]{8}$/.test(String(data?.uid||'')))
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
    save:()=>workspace==='analysis'?saveConfig():saveNode(),
    prepareTransaction:()=>workspace==='analysis'
      ?prepareKeywordConfigTransaction():prepareKeywordNodeTransaction(),
    isDirty:()=>workspace==='analysis'
      ?['current_keyword_class_uid','keyword_min_chars','keyword_min_documents']
        .some(key=>String(config[key]??'')!==String(savedConfig[key]??''))
      :dirty,
    // A read or a cancellable discovery scan is not a Save operation.
    isBusy:()=>busy||sharingBusy
  };
  useEffect(()=>{
    if(!dock?.active||dock.scopeId!==scopeId||!canEdit)return;
    return dock.register({
      save:()=>dockActions.current.save(),
      prepareTransaction:()=>dockActions.current.prepareTransaction(),
      isDirty:()=>dockActions.current.isDirty(),
      isBusy:()=>dockActions.current.isBusy()
    });
  },[dock?.active,dock?.scopeId,dock?.register,scopeId,canEdit]);
  if(!canEdit)return null;
  const selectedClass=activeClass;
  const allClassNodes=[...tree.index.values()].filter(x=>x.type==='class');
  const knownTerms=new Set((workspace==='analysis'&&discovery?rows:[]).filter(item=>item.type==='item').flatMap(item=>[
    item.name,...(Array.isArray(item.lists)?item.lists:[])
  ]).map(value=>String(value||'').normalize('NFKC').trim().toLocaleLowerCase()));
  const suggestedCandidates=(workspace==='analysis'?discovery?.candidates||[]:[]).filter(item=>
    !knownTerms.has(String(item.word||'').normalize('NFKC').trim().toLocaleLowerCase()));
  const suggestionPageSize=20;
  const suggestionPages=Math.max(1,Math.ceil(suggestedCandidates.length/suggestionPageSize));
  const currentSuggestionPage=Math.min(discoveryPage,suggestionPages);
  const visibleSuggestions=suggestedCandidates.slice(
    (currentSuggestionPage-1)*suggestionPageSize,currentSuggestionPage*suggestionPageSize);
  // Keep vis-network's data stable while typing in the adjacent inspector.
  const graphItems=useMemo(()=>workspace==='network'&&selectedClass?descendantsOfKeyword(rows,selectedClass.uid,{type:'item'}).map(node=>{
    const group=parentOf(tree,node.uid);
    return {keyword_id:node.uid,item_name:node.name,keywords:node.lists,
      group_uid:group?.uid||'',class_group:group?.name||'',class_name:selectedClass.name};
  }):[],[rows,tree,workspace,selectedClass?.uid]);
  const graphGroups=useMemo(()=>workspace==='network'?groups.map(row=>({uid:row.uid,name:row.name})):[],
    [workspace,groups.map(row=>row.uid+'|'+row.name).join('|')]);
  // Reuse exactly the manual editor in the graph's inspector, including the
  // existing authorization, edit dock, stale-analysis and save behavior.
  const draftEditor=draft?<div className="scope-management-editor">
        <h3>{tree.index.has(draft.uid)?'編輯':'新增'} {LABEL[draft.type]}</h3>
        <div className="scope-management-fields">
          <label><span>名稱</span><input value={draft.name} onChange={e=>setEditor({node:{...draft,name:e.target.value}})}/></label>
          <div className="scope-management-wide-field">
            <span>說明</span>
            <BlockNoteEditor editorKey={'keyword-description:'+scopeId+':'+draft.uid}
              content={draft.desc||''} editable={!busy} plainTextOnly canInsertImage={false}
              ariaLabel="關鍵詞說明"
              onPlainTextChange={value=>setEditor(current=>current?.node?.uid===draft.uid
                ?{...current,node:{...current.node,desc:value}}:current)}/>
          </div>
        </div>
        {draft.type==='class'?<label className="scope-management-wide-field">
          <span>例外關鍵詞：整篇排除（一行一詞）</span>
          <textarea rows={5} value={classExceptionText}
            onChange={event=>setClassExceptionText(event.target.value)}/>
          <small className="scope-status">
            標題或內文的有效文字包含任一排除詞時，不掃描該篇文章；
            Galaxy 原文及其他 Class 不會被修改。只建立已定義的「整篇排除」規則。
          </small>
        </label>:null}
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
  return <div className="scope-keyword-management loc-keyword-management-layout">
    <ManagementSectionNav id="scope-keyword-sections" title="關鍵詞管理" hideHeading
      panelId="scope-keyword-workspace" items={workspaceOptions}
      value={workspace} onChange={next=>{
        if(workspace==='analysis'&&next!=='analysis'){
          if(discoveryBusy)discoveryAbort.current?.abort();
          // Candidates and progress belong only to the analysis screen.
          setDiscovery(null);setDiscoveryProgress(null);setDiscoveryPage(1);
        }
        setWorkspace(next);setEditor(null);
      }}/>
    <div id="scope-keyword-workspace" className="loc-keyword-workspace-panel">
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
       {selected?<div className="scope-preview-links">
        <button className="loc-button" type="button" disabled={busy}
          onClick={()=>edit(selected)}>編輯「{selected.name}」</button>
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
          <p className="scope-status">輸入資料來源代碼與公開群組科目代碼（8 碼）。只會匯入分類規則，不會複製文章。</p>
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
    {!loading&&workspace==='analysis'?<details className="loc-card scope-feature-card loc-work-disclosure">
      <summary>分析基本設定</summary>
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
    </details>:null}
    {!loading&&workspace==='analysis'?<section className="loc-card scope-feature-card loc-keyword-analysis-compact">
      <h2>關鍵詞解析</h2>
      <div className="loc-keyword-analysis-toolbar">
      <label>科目（Class）
        <select className="scope-select" value={activeClass?.uid||''}
          disabled={busy} onChange={event=>{setResetConfirmation('');choose('class',event.target.value);}}>
          <option value="">請選擇科目</option>
          {allClassNodes.map(node=><option key={node.uid} value={node.uid}>
            {node.name} · {keywordClassState(config,node.uid)?.completedAt
              ?new Date(keywordClassState(config,node.uid).completedAt).toLocaleDateString('zh-TW')
              :'未解析'}
          </option>)}
        </select>
      </label>
      <div className="scope-preview-links loc-keyword-analysis-actions">
        <button type="button" className="loc-button primary"
          disabled={busy||checkingAttempt||!activeClass?.uid||unconfirmedAttempt?.classUid===activeClass.uid}
          onClick={()=>{setResetConfirmation('');run(false);}}>重新分析</button>
        <button type="button" className="loc-button"
          disabled={busy||checkingAttempt||!activeClass?.uid}
          onClick={()=>run(true)}>
          {resetConfirmation===activeClass?.uid?'確認清空':'清空分析'}
        </button>
      </div>
      </div>
      <details className="loc-work-subdetails">
        <summary>上次解析與文章統計</summary>
        <p className="scope-status">上次解析：{keywordClassState(config,activeClass?.uid)?.completedAt?new Date(keywordClassState(config,activeClass.uid).completedAt).toLocaleString('zh-TW'):'尚未解析'}</p>
        <p className="scope-status">有效分類文章：{Number(keywordClassState(config,activeClass?.uid)?.matchedDocuments||0).toLocaleString()} 篇</p>
      </details>
      {unconfirmedAttempt?<div className="loc-work-status loc-keyword-analysis-receipt" role="status">
        <p>前次分析回執尚未確認（Class：{unconfirmedAttempt.classUid}）。可唯讀核對，也可選擇「清空分析」確認重設；重設將使舊分析無法再寫回。</p>
        <div className="scope-preview-links">
          <button type="button" className="loc-button primary"
            disabled={checkingAttempt||busy} onClick={checkUnconfirmed}>
            {checkingAttempt?'正在核對…':'核對本次分析'}
          </button>
          <button type="button" className="loc-button"
            disabled={checkingAttempt||busy} onClick={discardUnconfirmed}>放棄回執追蹤</button>
        </div>
      </div>:null}
      {busy?<FlowProgress kind="keywords" stage={progress?.label||progress?.phase||'解析關鍵詞'}
        completed={progress?.completed||0} total={progress?.total||0}/>:null}
    </section>:null}
    {!loading&&workspace==='analysis'?<details className="loc-card scope-feature-card loc-work-disclosure loc-keyword-suggestions">
      <summary>建議新增關鍵詞</summary>
      <details className="loc-work-subdetails"><summary>掃描範圍與安全說明</summary>
        <p className="scope-status">僅讀取目前資料來源的文章內文，不修改既有關鍵詞，也不會自動新增。</p>
      </details>
      {discoveryBusy?<div className="loc-work-running">
        <FlowProgress kind="keywords" stage="掃描文章與篩選新詞"
          completed={discoveryProgress?.completed||0} total={discoveryProgress?.total||0}
          detail={discoveryProgress?.batchSize?'目前批次 '+Number(discoveryProgress.batchSize).toLocaleString()+' 篇':''}/>
        <button className="loc-button" type="button" onClick={()=>discoveryAbort.current?.abort()}>停止掃描</button>
      </div>:null}
      {discovery&&!discoveryBusy?<div>
        <p className="loc-work-results-head" role="status">
          <strong>{suggestedCandidates.length.toLocaleString()} 個候選詞</strong>
          {!discovery.cachedOnly?<span>已掃描 {Number(discovery.read||0).toLocaleString()} 篇文章</span>:null}
        </p>
        <details className="loc-work-subdetails">
          <summary>掃描數據</summary>
          {discovery.cachedOnly?<p className="scope-status">
            目前顯示先前保存的候選列表。
          </p>:<p className="scope-status">
            有內文 {Number(discovery.withContent||0).toLocaleString()} 篇，掃描總數 {Number(discovery.read||0).toLocaleString()} 篇。
          </p>}
        </details>
        {suggestedCandidates.length?<div>
          <ol className="scope-keyword-discovery-results" start={(currentSuggestionPage-1)*suggestionPageSize+1}>
            {visibleSuggestions.map(term=><li key={term.word}>
              <strong>{term.word}</strong>
              {!discovery.cachedOnly?<span className="scope-status"> · {Number(term.documents||0).toLocaleString()} 篇</span>:null}
              {(term.sample||!discovery.cachedOnly)?<details className="loc-work-term-details">
                <summary>詳情</summary>
                {!discovery.cachedOnly?<p className="scope-status">
                  {Number(term.occurrences||0).toLocaleString()} 次出現
                </p>:null}
                {term.sample?<p className="scope-status">{term.sample}</p>:null}
              </details>:null}
            </li>)}
          </ol>
          {suggestionPages>1?<div className="scope-preview-links" role="navigation" aria-label="建議關鍵詞分頁">
            <button type="button" className="loc-button" disabled={currentSuggestionPage===1}
              onClick={()=>setDiscoveryPage(page=>Math.max(1,page-1))}>上一頁</button>
            <span className="scope-status">第 {currentSuggestionPage} / {suggestionPages} 頁 · 每頁 {suggestionPageSize} 筆</span>
            <button type="button" className="loc-button" disabled={currentSuggestionPage===suggestionPages}
              onClick={()=>setDiscoveryPage(page=>Math.min(suggestionPages,page+1))}>下一頁</button>
          </div>:null}
        </div>:<p className="scope-status">沒有尚未收錄的新詞。</p>}
      </div>:null}
      {!discoveryBusy?<button type="button" className="loc-button" onClick={discoverNewTerms}>
        {discovery?'重新掃描內文':'開始掃描內文'}
      </button>:null}
    </details>:null}
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
