'use client';
import UiText from '../../../i18n/UiText';
import FieldText from '../../../i18n/FieldText';
import {normalizeUiLocale,UI_LOCALE_OPTIONS} from '../../../i18n/ui-copy';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useSWRConfig} from 'swr';
import {invalidateAppBootstrapMetadata} from '../../app-bootstrap';
import {useEditDock,useEditDockForm} from '../../../modular/edit-dock';
import dynamic from 'next/dynamic';
import {duplicateDomainLabelError} from '../../../modular/scope-registry';
import {THEME_SLOTS} from '../../../modular/theme-registry';
const ObjectEditor=dynamic(()=>import('../../BlockNoteEditor').then(mod=>mod.ObjectEditor),{loading:()=>null});
import {ScopeFeatureToggles} from '../../../modular/ui';
import {scopeConfigColumns,scopeFeaturePatch,scopeFeatureName} from '../../scope-config-fields.mjs';
import {
  deleteScope,dbAuthClient,dbAuthRelation,manageScopeRegistry,provisionScope,updateRows
} from '../../db-client.mjs';

const EMPTY_SCOPE_CREATE={scope_id:'',email:'',locale:'zh-Hant',route_mode:'directory'};
const EMPTY_GROUP_CREATE={scope_id:'',display_name:'',route_mode:'directory',parent_scope_id:'loc'};
const EMPTY_MAPPING={email:'',galaxy:'galaxy',anchor:'anchor'};

function normalizeAliases(value){
  return [...new Set((Array.isArray(value)?value:String(value||'').split(/[\n,，]/g))
    .map(item=>String(item||'').trim()).filter(Boolean))];
}

// Dynamic Scope tables are created in one transaction. PostgREST may keep the
// previous schema cache briefly after the provisioning RPC has committed.
function scopeSchemaCachePending(error){
  return String(error?.code||'')==='PGRST205'
    ||/could not find the table .* in the schema cache/i.test(String(error?.message||''));
}
const waitForScopeSchema=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function readAdminScopeConfig(scopeId,{attempts=7}={}){
  for(let attempt=0;attempt<attempts;attempt++){
    if(attempt>0)await waitForScopeSchema(Math.min(2000,350*attempt));
    const {data,error}=await dbAuthRelation('silver.'+scopeId)
      .select(scopeConfigColumns(scopeId))
      .eq('id',scopeId).limit(1);
    if(!error)return data?.[0]||null;
    if(!scopeSchemaCachePending(error)||attempt===attempts-1){
      throw new Error(error.message||'人員設定讀取失敗。');
    }
  }
  return null;
}

function useAdminScopeData(){
  const {mutate}=useSWRConfig();
  const [registry,setRegistry]=useState([]);
  const [mappings,setMappings]=useState([]);
  const [originalMappings,setOriginalMappings]=useState([]);
  const [configs,setConfigs]=useState({});
  const [status,setStatus]=useState('');
  const [revision,setRevision]=useState(0);

  useEffect(()=>{
    let active=true;
    (async()=>{
      try{
        // Management-only fields are returned by an admin-authorized RPC,
        // never from the public Registry's email column.
        const locResult=await dbAuthClient.schema('silver').managedAction('read_scope_registry_admin');
        if(locResult.error)throw new Error(locResult.error.message||'人員目錄讀取失敗。');

        const locRows=locResult.data||[];
        const scopeKindOf=role=>role==='group'?'group':(role==='system'||role==='admin')?'system':'scope';
        const registryRows=locRows.map(row=>({
          scope_id:row.id,
          display_name:row.display_name,
          scope_kind:scopeKindOf(row.manage_role),
          domain:row.domain,directory:row.directory,parent_scope_id:row.parent_scope_id,
          active:row.active,sort_order:row.sort_order,
          title_tw:String(row.title_tw||''),desc_tw:String(row.desc_tw||''),
          birthday:String(row.birthday||'').slice(0,10)
        }));
        const mappingRows=locRows.filter(row=>row.email).map(row=>({
          id:row.id,email:row.email,role:row.manage_role,
          galaxy:row.galaxy_table,anchor:row.anchor_table
        }));
        // The graph needs only the registry: show it immediately instead of
        // waiting for every independent Scope configuration request.
        if(!active)return;
        setRegistry(registryRows);
        setMappings(mappingRows);
        setOriginalMappings(mappingRows);
        const configRows={};
        const configFailures=[];
        await Promise.all(registryRows.filter(row=>row.scope_kind==='scope').map(async row=>{
          try{
            const config=await readAdminScopeConfig(row.scope_id);
            if(config)configRows[row.scope_id]=config;
            else configFailures.push(row.scope_id+'：找不到人員設定');
          }catch(error){
            configFailures.push(row.scope_id+'：'+String(error?.message||error||'人員設定讀取失敗。'));
          }
        }));

        if(!active)return;
        setConfigs(configRows);
        setStatus(configFailures.length?'部分人員設定讀取失敗：'+configFailures.join('；'):'');
      }catch(error){
        if(active)setStatus(error?.message||'Admin 資料讀取失敗。');
      }
    })();
    return()=>{active=false};
  },[revision]);

  return {
    registry,setRegistry,mappings,setMappings,originalMappings,configs,setConfigs,status,setStatus,
    refresh:()=>{
      invalidateAppBootstrapMetadata();
      mutate(key=>Array.isArray(key)&&key[0]==='app-bootstrap');
      setRevision(value=>value+1);
    }
  };
}

function DeploymentTree({registry=[],configs={},selectedId='',onSelect,onMoveParent,onDeleteNode}){
  const containerRef=useRef(null);
  const networkRef=useRef(null);
  const [treeState,setTreeState]=useState('loading');
  const [treeError,setTreeError]=useState('');
  const handlersRef=useRef({onSelect,onMoveParent,onDeleteNode});
  useEffect(()=>{handlersRef.current={onSelect,onMoveParent,onDeleteNode};},[onSelect,onMoveParent,onDeleteNode]);

  useEffect(()=>{
    let cancelled=false;
    let network=null;
    let themeObserver=null;
    let loadTimer=null;
    setTreeState('loading');
    setTreeError('');
    // Admin is the management site, not a Scope or an extra hierarchy level.
    const scopeRows=registry.filter(row=>row.scope_kind!=='system');
    if(!scopeRows.length){
      setTreeState('error');
      setTreeError('目前沒有可繪製的群組或人員。');
      return()=>{cancelled=true;};
    }
    // An unavailable vis-network chunk must never leave a perpetual spinner.
    loadTimer=setTimeout(()=>{
      if(cancelled)return;
      cancelled=true;
      setTreeState('error');
      setTreeError('關聯圖載入逾時，已切換至人員清單。');
    },12000);
    const nodes=scopeRows.map(row=>({
      id:row.scope_id,
      label:(configs[row.scope_id]?.display_name||row.display_name||row.scope_id)+'\n'+row.scope_id+(row.active===false?' · 停用':''),
      shape:'box',
      borderWidth:row.scope_kind==='group'?2:1,
      shapeProperties:{borderRadius:12},
      widthConstraint:{maximum:210},
      fixed:row.scope_id==='loc',
      mass:1
    }));
    const scopeIds=new Set(scopeRows.map(row=>row.scope_id));
    const edges=scopeRows
      .filter(row=>row.parent_scope_id&&scopeIds.has(row.parent_scope_id))
      .map(row=>({from:row.parent_scope_id,to:row.scope_id,arrows:'to'}));
    const groupIds=new Set(scopeRows.filter(row=>row.scope_kind==='group').map(row=>row.scope_id));

    import('vis-network/standalone').then(({Network})=>{
      if(cancelled||!containerRef.current)return;
      const themeOptions=()=>{
        const css=getComputedStyle(document.documentElement);
        const token=(name,fallback)=>css.getPropertyValue(name).trim()||fallback;
        const panel=token('--loc-panel','#181922');
        const text=token('--loc-text','#fafafa');
        const line=token('--loc-line','#626574');
        const accent=token('--loc-accent','#8da8d4');
        return {
          nodes:{
            color:{background:panel,border:line,highlight:{background:panel,border:accent},hover:{background:panel,border:accent}},
            font:{color:text,face:'system-ui',size:15,multi:false},
            margin:14
          },
          edges:{color:{color:line,highlight:accent,hover:accent}}
        };
      };
      const initialTheme=themeOptions();
      let lastThemeSignature=JSON.stringify(initialTheme);
      network=new Network(containerRef.current,{nodes,edges},{
        autoResize:true,
        physics:{enabled:false},
        // LR: Group parent at left, siblings aligned vertically at right; deeper Groups extend right.
        layout:{hierarchical:{enabled:true,direction:'LR',sortMethod:'directed',levelSeparation:235,nodeSpacing:120,treeSpacing:145}},
        interaction:{hover:true,dragNodes:true,dragView:true,zoomView:true,selectable:true,keyboard:true,navigationButtons:true},
        locale:'en',
        locales:{en:{
          edit:'編輯',del:'刪除所選',back:'返回',close:'關閉',addNode:'新增節點',addEdge:'新增關係',
          editNode:'編輯節點',editEdge:'編輯關係',addDescription:'在圖面放置節點',
          edgeDescription:'拖曳建立關係',editEdgeDescription:'拖曳調整關係',
          createEdgeError:'不可建立此關係',deleteClusterError:'不能刪除群集',editClusterError:'不能編輯群集'
        }},
        manipulation:{
          enabled:true,initiallyActive:false,addNode:false,addEdge:false,editEdge:false,
          editNode:(nodeData,callback)=>{
            const id=String(nodeData?.id||'');
            if(id)handlersRef.current.onSelect?.(id);
            callback(null);
          },
          deleteNode:(selection,callback)=>{
            // Never remove a visual node before the database confirms deletion.
            // Avoid browser prompt() from inside the vis-network manipulation callback.
            const ids=Array.isArray(selection?.nodes)?selection.nodes:[];
            callback(null);
            if(ids.length===1)handlersRef.current.onDeleteNode?.(String(ids[0]));
          }
        },
        ...initialTheme,
        edges:{...initialTheme.edges,smooth:{enabled:true,type:'cubicBezier',forceDirection:'horizontal',roundness:.35}}
      });
      // Theme writes can mutate the document root many times without changing
      // the graph colors. Do not force a Canvas redraw for identical tokens.
      themeObserver=new MutationObserver(()=>{
        if(!network)return;
        const nextTheme=themeOptions();
        const signature=JSON.stringify(nextTheme);
        if(signature===lastThemeSignature)return;
        lastThemeSignature=signature;
        network.setOptions(nextTheme);
      });
      themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['style','data-theme-id']});
      networkRef.current=network;
      network.fit({animation:false,maxZoomLevel:1});
      clearTimeout(loadTimer);
      setTreeState('ready');
      network.on('selectNode',params=>{
        const id=String(params?.nodes?.[0]||'');
        if(id)handlersRef.current.onSelect?.(id);
      });
      network.on('doubleClick',params=>{
        const id=String(params?.nodes?.[0]||'');
        if(id)handlersRef.current.onSelect?.(id);
      });
      network.on('dragEnd',params=>{
        const nodeId=String(params?.nodes?.[0]||'');
        if(!nodeId||nodeId==='loc')return;
        const row=registry.find(item=>item.scope_id===nodeId);
        if(!row||row.scope_kind==='group'&&nodeId==='loc')return;
        const positions=network.getPositions();
        const source=positions[nodeId];
        if(!source)return;
        let nearest=null;
        let distance=Infinity;
        for(const groupId of groupIds){
          if(groupId===nodeId)continue;
          const point=positions[groupId];
          if(!point)continue;
          const d=Math.hypot(point.x-source.x,point.y-source.y);
          if(d<distance){distance=d;nearest=groupId;}
        }
        if(nearest&&distance<190&&nearest!==row.parent_scope_id){
          const parent=registry.find(item=>item.scope_id===nearest);
          if(window.confirm('將 '+nodeId+' 移至 '+(parent?.display_name||nearest)+'？'))handlersRef.current.onMoveParent?.(nodeId,nearest);
          else network.fit({animation:false,maxZoomLevel:1});
        }
      });
      if(selectedId&&registry.some(row=>row.scope_id===selectedId)){
        network.selectNodes([selectedId]);
      }
    }).catch(error=>{
      if(cancelled)return;
      clearTimeout(loadTimer);
      setTreeState('error');
      setTreeError(String(error?.message||error||'人員關聯圖載入失敗。'));
    });
    return()=>{cancelled=true;clearTimeout(loadTimer);themeObserver?.disconnect();network?.destroy();networkRef.current=null;};
  // Rebuild on persisted name changes, not in-progress draft edits.
  },[registry,configs]);

  useEffect(()=>{
    const network=networkRef.current;
    if(!network||!selectedId)return;
    try{network.selectNodes([selectedId]);}catch{}
  },[selectedId]);

  return <div className="admin-deployment-tree-wrap">
    <div ref={containerRef} className={'admin-deployment-tree'+(treeState==='error'?' is-unavailable':'')} role="region" aria-label="人員目錄"/>
    {treeState!=='ready'?<div className="admin-registry-fallback" role="region" aria-label="人員清單">
      <p className="scope-status">{treeState==='error'?'圖形樹載入失敗，已切換清單模式。':'人員目錄載入中…'}</p>
      {treeError?<p className="scope-status scope-error">{treeError}</p>:null}
      {registry.length?<div className="admin-registry-fallback-list">
        {registry.filter(row=>row.scope_kind!=='system').map(row=><button type="button" className={'scope-inline-card admin-registry-fallback-item'+(row.scope_id===selectedId?' is-selected':'')} onClick={()=>onSelect?.(row.scope_id)} key={row.scope_id}>
          <strong>{configs[row.scope_id]?.display_name||row.display_name||row.scope_id}</strong>
          <span>{row.scope_id} · {row.scope_kind}{row.active===false?' · 停用':''}</span>
        </button>)}
      </div>:<p className="scope-status">目前沒有人員資料。</p>}
    </div>:null}
  </div>;
}

function RegistryNodePanel({data,selectedId,onDeleted,onDeleteNode,dirtyRef}){
  const dock=useEditDock();
  const inDock=Boolean(dock?.active&&dock.scopeId==='loc');
  const {registry,mappings,setMappings,originalMappings,configs,status,setStatus,refresh}=data;
  const selected=registry.find(row=>row.scope_id===selectedId)||null;
  const config=configs[selectedId]||null;
  const scopeMappings=mappings.filter(row=>row.id===selectedId);
  const [newMapping,setNewMapping]=useState({...EMPTY_MAPPING});
  // Names, page copy and birthday belong to the Group Scope row, not the
  // management email / Routing Mapping.
  const [editDraft,setEditDraft]=useState(null);
  const draftFromSelected=()=>({
    scopeId:selectedId,registry:{...selected},config:config?{...config}:null
  });
  const currentDraft=editDraft?.scopeId===selectedId?editDraft:null;
  const current=currentDraft?.registry||selected;
  const currentConfig=currentDraft?.config||config;
  const cancelEdit=()=>{
    setEditDraft(null);
    setMappings(rows=>rows.map(row=>row.id!==selectedId?row:
      originalMappings.find(saved=>saved.id===row.id)||row));
    setNewMapping({...EMPTY_MAPPING});
  };
  const patchRegistry=(key,value)=>setEditDraft(draft=>{
    const base=draft?.scopeId===selectedId?draft:draftFromSelected();
    return {...base,registry:{...base.registry,[key]:value}};
  });
  const patchConfig=(key,value)=>setEditDraft(draft=>{
    const base=draft?.scopeId===selectedId?draft:draftFromSelected();
    const previous=base.config||config;
    return {...base,config:{...previous,[scopeFeatureName(key)||key]:Boolean(value)}};
  });
  const groups=registry.filter(row=>row.scope_kind==='group'&&row.active!==false&&row.scope_id!==selectedId);
  const parentOptions=[{value:'',label:'—'},...groups.map(row=>({value:row.scope_id,label:(row.display_name||row.scope_id)+' · '+row.scope_id}))];
  const themeOptions=[{value:'system-default',label:'系統預設（日／夜自動）'},...THEME_SLOTS.map(theme=>({value:theme.id,label:theme.label}))];
  const routeMode=current?.domain?'domain':'directory';
  const routeLocked=['loc','lrunes','lo3rwang'].includes(selectedId);
  const routeValue=routeMode==='domain'
    ?'https://'+String(current?.domain||'')
    :'https://loc.lo3rwang.cc'+String(current?.directory||'');
  const chooseRouteMode=mode=>setEditDraft(draft=>{
    const base=draft?.scopeId===selectedId?draft:draftFromSelected();
    return {...base,registry:{
      ...base.registry,
      domain:mode==='domain'?base.registry.domain||base.registry.scope_id+'.lo3rwang.cc':null,
      directory:mode==='directory'?base.registry.directory||'/'+base.registry.scope_id:null
    }};
  });
  const patchMapping=(id,key,value)=>setMappings(rows=>rows.map(row=>row.id===id?{...row,[key]:value}:row));

  async function saveRegistryAndConfig(){
    if(!selected||!current)return false;
    if(!draftDirty)return true;
    setStatus('');
    try{
      const routingFields=['display_name','domain','directory','parent_scope_id','active','sort_order'];
      const routingDirty=routingFields.some(key=>current[key]!==selected[key]);
      if(current.scope_kind!=='system'&&routingDirty){
        const hasDomain=Boolean(String(current.domain||'').trim());
        const hasDirectory=Boolean(String(current.directory||'').trim());
        if(hasDomain===hasDirectory)throw new Error('Domain / Directory 必須二選一。');
        await manageScopeRegistry('update',current.scope_id,{
          display_name:String(current.display_name||current.scope_id).trim(),
          domain:String(current.domain||'').trim()||null,
          directory:String(current.directory||'').trim()||null,
          parent_scope_id:current.scope_id==='loc'?null:(String(current.parent_scope_id||'').trim()||null),
          active:current.scope_id==='loc'?true:current.active!==false,
          sort_order:Number(current.sort_order)||0
        });
      }
      // Independent of owner email and role. One LOC UPDATE per changed
      // Group/Scope metadata instead of a Routing update for each field.
      if(current.scope_kind!=='system'){
        const locPatch={};
        for(const key of ['title_tw','desc_tw','birthday']){
          if(current[key]!==selected[key])
            locPatch[key]=key==='birthday'?(current[key]||null):String(current[key]||'').trim();
        }
        if(Object.keys(locPatch).length)
          await updateRows('silver.loc',locPatch,
            {filters:[{column:'id',operator:'eq',value:current.scope_id}]});
      }
      if(current.scope_kind==='scope'&&currentConfig&&JSON.stringify(currentConfig)!==JSON.stringify(config)){
        await updateRows('silver.'+current.scope_id,{
          display_name:String(currentConfig.display_name||current.scope_id).trim(),
          search_intro:String(currentConfig.search_intro||'').trim(),
          search_aliases:normalizeAliases(currentConfig.search_aliases),
          theme:String(currentConfig.theme||'system-default'),
          locale:normalizeUiLocale(currentConfig.locale),
          ...scopeFeaturePatch(current.scope_id,currentConfig),
          updated_at:new Date().toISOString()
        },{filters:[{column:'id',operator:'eq',value:current.scope_id}]});
      }
      setStatus(current.scope_id+' 已更新。');
      setEditDraft(null);
      refresh();
      return true;
    }catch(error){setStatus(error?.message||'人員更新失敗。');return false;}
  }

  async function saveMapping(row){
    setStatus('');
    try{
      const email=String(row.email||'').trim().toLowerCase();
      if(!/^\S+@\S+\.\S+$/.test(email))throw new Error('Email 格式不正確。');
      await updateRows('api.manage',{
        email,
        galaxy_table:String(row.galaxy||'galaxy').trim()||'galaxy',
        anchor_table:String(row.anchor||'anchor').trim()||'anchor'
      },{filters:[{column:'id',operator:'eq',value:row.id}]});
      setStatus('Mapping 已更新。');refresh();return true;
    }catch(error){setStatus(error?.message||'Mapping 更新失敗。');return false;}
  }

  async function removeMapping(row){
    if(['admin','loc'].includes(row.id)){
      setStatus('內建系統與群組身分不能移除；請修改 Email。');return;
    }
    if(!window.confirm('移除 '+row.email+'？'))return;
    try{
      await updateRows('api.manage',{
        email:null,manage_role:null
      },{filters:[{column:'id',operator:'eq',value:row.id}]});
      setStatus('Mapping 已移除。');refresh();
    }catch(error){setStatus(error?.message||'Mapping 刪除失敗。');}
  }

  async function addMapping(){
    if(!selected||selected.scope_kind!=='scope')return false;
    setStatus('');
    try{
      const email=String(newMapping.email||'').trim().toLowerCase();
      if(!/^\S+@\S+\.\S+$/.test(email))throw new Error('Email 格式不正確。');
      await updateRows('api.manage',{
        email:email,manage_role:'scope',
        galaxy_table:String(newMapping.galaxy||'galaxy').trim()||'galaxy',
        anchor_table:String(newMapping.anchor||'anchor').trim()||'anchor'
      },{filters:[{column:'id',operator:'eq',value:selected.scope_id}]});
      setNewMapping({...EMPTY_MAPPING});setStatus('Mapping 已新增。');refresh();return true;
    }catch(error){setStatus(error?.message||'Mapping 新增失敗。');return false;}
  }

  const editedMappings=scopeMappings.filter(row=>JSON.stringify(row)!==
    JSON.stringify(originalMappings.find(old=>old.id===row.id)));
  const draftDirty=Boolean(currentDraft&&(
    JSON.stringify(currentDraft.registry)!==JSON.stringify(selected)||
    (currentDraft.config!==null&&JSON.stringify(currentDraft.config)!==JSON.stringify(config))
  ));
  const newMappingDirty=JSON.stringify(newMapping)!==JSON.stringify(EMPTY_MAPPING);
  useEffect(()=>{
    dirtyRef.current=()=>Boolean(draftDirty||editedMappings.length||newMappingDirty);
    return ()=>{dirtyRef.current=()=>false;};
  },[dirtyRef,draftDirty,editedMappings.length,newMappingDirty]);
  useEditDockForm({
    isDirty:()=>Boolean(draftDirty||editedMappings.length||newMappingDirty),
    save:async()=>{
      if(draftDirty&&await saveRegistryAndConfig()!==true)return false;
      for(const item of editedMappings){
        if(await saveMapping(item)!==true)return false;
      }
      if(newMappingDirty&&await addMapping()!==true)return false;
      return true;
    }
  });

  if(!selected)return <aside className="admin-context-panel"><p className="scope-status">請選擇人員或群組</p></aside>;

  return <aside className="admin-context-panel is-editing">
    <div className="admin-node-heading">
      <h2>{currentConfig?.display_name||current?.display_name||selected.scope_id}</h2>
      {draftDirty?<span className="scope-status">有尚未儲存的修改</span>:null}
    </div>
      {current.scope_kind==='group'?<label><span><UiText id="uiExtra.adminView.groupName"/></span><input value={current.display_name||''} onChange={e=>patchRegistry('display_name',e.target.value)}/></label>:null}
      {current.scope_kind!=='system'?<section className="admin-page-copy-fields" aria-label="群組與 Scope 設定">
        <label><span><UiText id="uiExtra.adminView.navigationTitle"/></span>
          <input required value={current.title_tw||''} onChange={e=>patchRegistry('title_tw',e.target.value)}/></label>
        <ObjectEditor mode="fields" fields={[
          {key:'desc_tw',kind:'rich',label:<UiText id="uiExtra.adminView.pageDescription"/>,
            editorKey:'admin-page-description:'+selectedId,content:current.desc_tw||'',
            canInsertImage:false,onPlainTextChange:value=>patchRegistry('desc_tw',value)}
        ]}/>
        <label><span><UiText id="uiExtra.adminView.birthdayMapping"/></span>
          <input type="date" value={current.birthday||''} onChange={e=>patchRegistry('birthday',e.target.value)}/></label>
      </section>:null}
      {current.scope_kind==='scope'&&currentConfig?<>
        <label><span><UiText id="uiExtra.adminView.displayName"/></span><input value={currentConfig.display_name||''} onChange={e=>patchConfig('display_name',e.target.value)}/></label>
        <ObjectEditor mode="fields" fields={[
          {key:'search_intro',kind:'rich',label:<UiText id="uiExtra.adminView.searchIntroduction"/>,
            editorKey:'admin-search-intro:'+selectedId,content:currentConfig.search_intro||'',
            canInsertImage:false,onPlainTextChange:value=>patchConfig('search_intro',value)},
          {key:'search_aliases',kind:'rich',label:<UiText id="uiExtra.adminView.searchAliases"/>,
            editorKey:'admin-search-aliases:'+selectedId,
            content:normalizeAliases(currentConfig.search_aliases).join('\n'),
            canInsertImage:false,onPlainTextChange:value=>patchConfig('search_aliases',value.split('\n'))}
        ]}/>
        <label><span><UiText id="uiExtra.adminView.theme"/></span><select className="admin-native-select" value={currentConfig.theme||'system-default'} onChange={e=>patchConfig('theme',e.target.value)}>{themeOptions.map(option=><option value={option.value} key={option.value}><FieldText text={option.label}/></option>)}</select></label>
        <label><span><UiText id="uiExtra.adminView.defaultLanguage"/></span><select className="admin-native-select" value={normalizeUiLocale(currentConfig.locale)} onChange={e=>patchConfig('locale',normalizeUiLocale(e.target.value))}>{UI_LOCALE_OPTIONS.map(option=><option value={option.value} key={option.value}><FieldText text={option.label}/></option>)}</select></label>
        {selectedId!=='lrunes'?<ScopeFeatureToggles className="admin-inline-flags" scopeId={selectedId} value={currentConfig} onChange={patchConfig}/>:null}
      </>:null}

      <div className="admin-route-summary" aria-label="目前路由">
        <code>{routeValue}</code>
      </div>
      {!routeLocked?<label><span><UiText id="uiExtra.adminView.routeType"/></span>
        <select className="admin-native-select" value={routeMode==='domain'?'domain':'directory'} onChange={event=>chooseRouteMode(event.target.value)}>
          <option value="directory">Directory · 站內路徑</option>
          <option value="domain">Domain · 獨立網域</option>
        </select>
      </label>:null}
      {current.scope_id!=='loc'?<label><span><UiText id="uiExtra.adminView.parentGroup"/></span><select className="admin-native-select" value={String(current.parent_scope_id||'')} onChange={e=>patchRegistry('parent_scope_id',e.target.value||'')}>{parentOptions.map(option=><option value={option.value} key={option.value||'root'}><FieldText text={option.label}/></option>)}</select></label>:null}
      {current.scope_kind==='scope'?<label className="scope-setting-toggle"><input type="checkbox" checked={current.active!==false} onChange={e=>patchRegistry('active',e.target.checked)}/> <UiText id="uiExtra.adminView.publiclyEnabled"/></label>:null}
      <ObjectEditor mode="actions" actionClassName="scope-tabs admin-edit-actions" actions={[
        ...(inDock?[]:[
          {key:'save',primary:true,onClick:saveRegistryAndConfig,label:<UiText id="uiExtra.adminView.save"/>},
          {key:'cancel',onClick:cancelEdit,label:<UiText id="uiExtra.adminView.cancel"/>}
        ]),
        ...(current.scope_kind==='scope'?[{key:'delete',danger:true,disabled:routeLocked,
          onClick:()=>onDeleteNode?.(current.scope_id),label:<UiText id="uiExtra.adminView.delete"/>}]:[])
      ]}/>

      {scopeMappings.length||selected.scope_kind==='scope'?<details className="admin-node-mapping">
      <summary><UiText id="uiExtra.adminView.administratorMapping"/>（{scopeMappings.length}）</summary>
      {scopeMappings.map(row=><article className="scope-inline-card" key={row.id}>
        <label><span>管理者 Email</span><input type="email" value={row.email||''} onChange={e=>patchMapping(row.id,'email',e.target.value)}/></label>
        <div className="scope-management-fields">
          <label><span><UiText id="uiExtra.adminView.galaxyTable"/></span><input value={row.galaxy||'galaxy'} onChange={e=>patchMapping(row.id,'galaxy',e.target.value)}/></label>
          <label><span>Anchor</span><input value={row.anchor||'anchor'} onChange={e=>patchMapping(row.id,'anchor',e.target.value)}/></label>
        </div>
        <div className="scope-tabs">{!inDock?<button type="button" onClick={()=>saveMapping(row)}><UiText id="uiExtra.adminView.saveMapping"/></button>:null}<button type="button" disabled={['admin','loc'].includes(row.id)} onClick={()=>removeMapping(row)}><UiText id="uiExtra.adminView.remove"/></button></div>
      </article>)}
      {selected.scope_kind==='scope'?<details>
        <summary><UiText id="uiExtra.adminView.addAdministrator"/></summary>
        <label><span>Email</span><input type="email" value={newMapping.email} onChange={e=>setNewMapping(v=>({...v,email:e.target.value}))}/></label>
        <button type="button" className="loc-button" onClick={addMapping}><UiText id="uiExtra.adminView.add"/></button>
      </details>:null}
    </details>:null}

    {status?<p className="scope-status" role="status">{status}</p>:null}
  </aside>;
}

function CreateNodePanel({data,kind='scope',onClose}){
  const {registry,setStatus,refresh}=data;
  const groups=registry.filter(row=>row.scope_kind==='group'&&row.active!==false);
  const parentOptions=groups.map(row=>({value:row.scope_id,label:(row.display_name||row.scope_id)+' · '+row.scope_id}));
  const [scopeDraft,setScopeDraft]=useState({...EMPTY_SCOPE_CREATE});
  const [groupDraft,setGroupDraft]=useState({...EMPTY_GROUP_CREATE});
  const [creatingScope,setCreatingScope]=useState(false);
  const scopeDomainError=duplicateDomainLabelError(scopeDraft.scope_id,scopeDraft.route_mode);
  const groupDomainError=duplicateDomainLabelError(groupDraft.scope_id,groupDraft.route_mode);

  async function createScope(){
    if(creatingScope)return false;
    setCreatingScope(true);
    setStatus('正在建立人員資料…');
    let provisioned=false;
    let id='';
    try{
      id=String(scopeDraft.scope_id||'').trim().toLowerCase();
      if(!/^[a-z][a-z0-9]{0,14}$/.test(id))throw new Error('人員代碼格式不正確。');
      const email=String(scopeDraft.email||'').trim().toLowerCase();
      if(!email)throw new Error('請先設定管理者 Email。');
      if(!/^\\S+@\\S+\\.\\S+$/.test(email))throw new Error('Email 格式不正確。');
      const mode=scopeDraft.route_mode;
      if(!['directory','domain'].includes(mode))throw new Error('請選擇 Directory 或 Domain。');
      if(duplicateDomainLabelError(id,mode))throw new Error('網域名稱重複，拒絕建立。');
      const provisionedScope=await provisionScope({
        scope_id:id,
        display_name:id,
        email,
        domain:mode==='domain'?id+'.lo3rwang.cc':null,
        directory:mode==='directory'?'/'+id:null,
        parent_scope_id:'loc',
        theme:'system-default',
        copy_keywords:true
      });
      // The RPC returned successfully; a later schema-cache failure is not a failed creation.
      provisioned=true;
      if(String(provisionedScope?.scope_id||'')!==id)throw new Error('人員建立回應缺少正確代碼。');
      if(Number(provisionedScope?.keyword_rows)!==66)throw new Error('符文66複製數量不正確，請核對資料庫。');
      await updateRows('silver.'+id,{
        locale:normalizeUiLocale(scopeDraft.locale),
        updated_at:new Date().toISOString()
      },{filters:[{column:'id',operator:'eq',value:id}]});
      const config=await readAdminScopeConfig(id);
      if(!config)throw new Error('人員設定尚未可讀。');
      setStatus('人員 '+id+' 已建立。');
      refresh();
      onClose?.();
      return true;
    }catch(error){
      if(provisioned){
        setStatus('人員 '+id+' 已建立，但後續驗證／設定尚未完成：'+String(error?.message||error)+'。請重新讀取，不要重複建立。');
        refresh();
        onClose?.();
      }else setStatus(error?.message||'人員建立失敗。');
      return false;
    }finally{setCreatingScope(false);}
  }

  async function createGroup(){
    try{
      const id=String(groupDraft.scope_id||'').trim().toLowerCase();
      if(!/^[a-z][a-z0-9]{0,14}$/.test(id))throw new Error('Group ID 格式不正確。');
      if(duplicateDomainLabelError(id,groupDraft.route_mode))throw new Error('網域名稱重複，拒絕建立。');
      await manageScopeRegistry('create_group',id,{
        display_name:String(groupDraft.display_name||'').trim(),
        domain:groupDraft.route_mode==='domain'?id+'.lo3rwang.cc':null,
        directory:groupDraft.route_mode==='directory'?'/'+id:null,
        parent_scope_id:String(groupDraft.parent_scope_id||'loc').trim()||'loc'
      });
      setStatus('群組 '+id+' 已建立。');refresh();onClose?.();return true;
    }catch(error){setStatus(error?.message||'群組建立失敗。');return false;}
  }
  const createDirty=kind==='scope'
    ?JSON.stringify(scopeDraft)!==JSON.stringify(EMPTY_SCOPE_CREATE)
    :JSON.stringify(groupDraft)!==JSON.stringify(EMPTY_GROUP_CREATE);
  useEditDockForm({
    isBusy:()=>creatingScope,
    isDirty:()=>createDirty,
    save:()=>kind==='scope'?createScope():createGroup()
  });

  const parentValue=value=>parentOptions.find(o=>o.value===value)||parentOptions[0]||null;
  return <aside className="admin-context-panel">
    <div className="admin-node-heading"><h2>{kind==='group'?'新增群組':'新增人員'}</h2><button type="button" className="loc-button" onClick={onClose}><UiText id="uiExtra.adminView.cancel"/></button></div>
    {kind==='scope'?<>
      <label><span><UiText id="uiExtra.adminView.memberId"/></span><input maxLength="15" value={scopeDraft.scope_id} onChange={e=>setScopeDraft(v=>({...v,scope_id:e.target.value.toLowerCase()}))}/></label>
      <label><span><UiText id="uiExtra.adminView.administratorEmail"/></span><input type="email" required autoComplete="off" value={scopeDraft.email} onChange={e=>setScopeDraft(v=>({...v,email:e.target.value}))}/></label>
      <label><span><UiText id="uiExtra.adminView.defaultLanguage"/></span><select className="admin-native-select" value={normalizeUiLocale(scopeDraft.locale)} onChange={e=>setScopeDraft(v=>({...v,locale:normalizeUiLocale(e.target.value)}))}>{UI_LOCALE_OPTIONS.map(option=><option value={option.value} key={option.value}><FieldText text={option.label}/></option>)}</select></label>
      <label><span><UiText id="uiExtra.adminView.routeType"/></span>
        <select className="admin-native-select" value={scopeDraft.route_mode==='domain'?'domain':'directory'} onChange={e=>setScopeDraft(v=>({...v,route_mode:e.target.value==='domain'?'domain':'directory'}))}>
          <option value="directory">Directory · 站內路徑</option>
          <option value="domain">Domain · 獨立網域</option>
        </select>
      </label>
      <div className="admin-route-summary"><span><UiText id="uiExtra.adminView.createLocation"/></span><code>{scopeDraft.route_mode==='domain'?(scopeDraft.scope_id||'scope-id')+'.lo3rwang.cc':'https://loc.lo3rwang.cc/'+(scopeDraft.scope_id||'scope-id')}</code></div>
      {scopeDomainError?<p className="scope-status scope-error" role="alert">{scopeDomainError}</p>:null}
      <button type="button" className="loc-button primary" disabled={Boolean(scopeDomainError)||creatingScope} onClick={createScope}><UiText id={creatingScope?'uiExtra.adminView.provisioningMember':'uiExtra.adminView.ddMember'}/></button>
    </>:<>
      <label><span><UiText id="uiExtra.adminView.groupId"/></span><input maxLength="15" value={groupDraft.scope_id} onChange={e=>setGroupDraft(v=>({...v,scope_id:e.target.value.toLowerCase()}))}/></label>
      <label><span><UiText id="uiExtra.adminView.groupName"/></span><input value={groupDraft.display_name} onChange={e=>setGroupDraft(v=>({...v,display_name:e.target.value}))}/></label>
      <label><span><UiText id="uiExtra.adminView.routeType"/></span>
        <select className="admin-native-select" value={groupDraft.route_mode==='domain'?'domain':'directory'} onChange={e=>setGroupDraft(v=>({...v,route_mode:e.target.value==='domain'?'domain':'directory'}))}>
          <option value="directory">Directory · 站內路徑</option>
          <option value="domain">Domain · 獨立網域</option>
        </select>
      </label>
      <div className="admin-route-summary"><span><UiText id="uiExtra.adminView.createLocation"/></span><code>{groupDraft.route_mode==='domain'?(groupDraft.scope_id||'group-id')+'.lo3rwang.cc':'https://loc.lo3rwang.cc/'+(groupDraft.scope_id||'group-id')}</code></div>
      {groupDomainError?<p className="scope-status scope-error" role="alert">{groupDomainError}</p>:null}
      <label><span><UiText id="uiExtra.adminView.parentGroup2"/></span><select className="admin-native-select" value={groupDraft.parent_scope_id||'loc'} onChange={e=>setGroupDraft(v=>({...v,parent_scope_id:e.target.value||'loc'}))}>{parentOptions.map(option=><option value={option.value} key={option.value}><FieldText text={option.label}/></option>)}</select></label>
      <button type="button" className="loc-button primary" disabled={Boolean(groupDomainError)} onClick={createGroup}><UiText id="uiExtra.adminView.ddGroup"/></button>
    </>}
  </aside>;
}

export default function AdminRegistry(){
  const data=useAdminScopeData();
  const {registry,configs,setRegistry,setStatus,refresh}=data;
  const [selectedId,setSelectedId]=useState('');
  const [createKind,setCreateKind]=useState('');
  const [deletePending,setDeletePending]=useState('');
  const [deleteTyped,setDeleteTyped]=useState('');
  const [deleteBusy,setDeleteBusy]=useState(false);
  const [deleteNotice,setDeleteNotice]=useState('');
  const deleteConfirmRef=useRef(null);
  const dirtyRef=useRef(()=>false);
  const confirmDiscard=()=>!dirtyRef.current()||
    window.confirm('目前有尚未儲存的修改，確定放棄並切換嗎？');
  useEffect(()=>{
    if(deletePending)deleteConfirmRef.current?.scrollIntoView({behavior:'smooth',block:'nearest'});
  },[deletePending]);

  useEffect(()=>{
    if(selectedId&&registry.some(row=>row.scope_id===selectedId))return;
    setSelectedId(registry.find(row=>row.scope_id==='loc')?.scope_id||registry[0]?.scope_id||'');
  },[registry,selectedId]);

  const moveParent=useCallback(async(nodeId,parentId)=>{
    const row=registry.find(item=>item.scope_id===nodeId);
    if(!row)return;
    setRegistry(rows=>rows.map(item=>item.scope_id===nodeId?{...item,parent_scope_id:parentId}:item));
    setStatus('移動中…');
    try{
      await manageScopeRegistry('update',nodeId,{
        display_name:String(row.display_name||nodeId),
        domain:row.domain||null,directory:row.directory||null,
        parent_scope_id:parentId,active:row.active!==false,sort_order:Number(row.sort_order)||0
      });
      setStatus(nodeId+' 已移到 '+parentId+'。');refresh();
    }catch(error){setStatus(error?.message||'移動失敗。');refresh();}
  },[registry,setRegistry,setStatus,refresh]);

  const selectNode=useCallback(id=>{
    if(id===selectedId)return;
    if(dirtyRef.current()&&!window.confirm('目前有尚未儲存的修改，確定放棄並切換嗎？'))return;
    setCreateKind('');setSelectedId(id);
  },[selectedId]);
  const requestDelete=useCallback(id=>{
    if(deleteBusy)return;
    if(id!==selectedId&&dirtyRef.current()&&
      !window.confirm('目前有尚未儲存的修改，確定放棄並切換嗎？'))return;
    const row=registry.find(item=>item.scope_id===id);
    if(!row||row.scope_kind!=='scope'){
      setDeleteNotice('只能刪除一般人員；群組與系統節點不可刪除。');
      return;
    }
    if(['loc','lrunes','lo3rwang','admin'].includes(id)){
      setDeleteNotice('內建人員不可刪除。');
      return;
    }
    setCreateKind('');
    setSelectedId(id);
    setDeleteTyped('');
    setDeleteNotice('');
    setDeletePending(id);
  },[registry,deleteBusy,selectedId]);
  const cancelDelete=()=>{if(deleteBusy)return;setDeletePending('');setDeleteTyped('');};
  const confirmDelete=async()=>{
    const id=deletePending;
    if(!id||deleteBusy||deleteTyped.trim().toLowerCase()!==id)return;
    setDeleteBusy(true);
    setDeleteNotice(id+' 正在刪除並核對資料庫…');
    try{
      const result=await deleteScope(id);
      if(result?.deleted!==true||result?.scope_id!==id){
        throw new Error('刪除 RPC 未回傳正確的完成確認。');
      }
      const {data:remaining,error:verifyError}=await dbAuthRelation('api.manage')
        .select('id').eq('id',id).limit(1);
      if(verifyError)throw new Error('刪除已執行，但 Registry 驗證失敗：'+verifyError.message);
      if(remaining?.length)throw new Error('資料庫仍存在 '+id+'，已取消前端成功提示。');
      setRegistry(rows=>rows.filter(row=>row.scope_id!==id));
      setSelectedId(current=>current===id?'loc':current);
      setDeletePending('');
      setDeleteTyped('');
      setDeleteNotice('人員 '+id+' 已移除。');
      refresh();
    }catch(error){
      setDeleteNotice('刪除 '+id+' 失敗：'+String(error?.message||error)+'。節點保留，請檢查後重試。');
      refresh();
    }finally{setDeleteBusy(false);}
  };
  return <section className="loc-card admin-workspace">
    <div className="admin-deployment-layout">
      <div className="admin-graph-header">
        <div><h2><UiText id="uiExtra.adminView.memberRelationshipGraph"/></h2></div>
        <div className="admin-registry-actions">
          <button type="button" className="loc-button" onClick={refresh}><UiText id="uiExtra.adminView.reload"/></button>
          <button type="button" className="loc-button" onClick={()=>{if(confirmDiscard())setCreateKind('scope');}}><UiText id="uiExtra.adminView.ddMember"/></button>
          <button type="button" className="loc-button" onClick={()=>{if(confirmDiscard())setCreateKind('group');}}><UiText id="uiExtra.adminView.ddGroup"/></button>
        </div>
      </div>
      <DeploymentTree registry={registry} configs={configs} selectedId={selectedId} onSelect={selectNode} onMoveParent={moveParent} onDeleteNode={requestDelete}/>
      {deletePending?<section className="admin-delete-confirm" ref={deleteConfirmRef} role="region" aria-label="刪除人員確認">
        <div><strong>永久刪除人員：{deletePending}</strong><p>將移除此人員的六張資料表、關鍵詞、設定及管理紀錄；此操作不可復原。</p></div>
        <label><span>請輸入 {deletePending} 以確認</span><input autoFocus autoComplete="off" value={deleteTyped} disabled={deleteBusy} onChange={e=>setDeleteTyped(e.target.value)} /></label>
        <div className="scope-tabs">
          <button type="button" className="loc-button" disabled={deleteBusy} onClick={cancelDelete}><UiText id="uiExtra.adminView.cancel"/></button>
          <button type="button" className="loc-button primary" disabled={deleteBusy||deleteTyped.trim().toLowerCase()!==deletePending} onClick={confirmDelete}><FieldText text={deleteBusy?'刪除與驗證中…':'確認永久刪除'}/></button>
        </div>
      </section>:null}
      {deleteNotice?<p className={'scope-status'+(deleteNotice.includes('失敗')?' scope-error':'')} role="status">{deleteNotice}</p>:null}
      {data.status?<p className="scope-status" role="status">{data.status}</p>:null}
      <div className="admin-editor-section" id="admin-scope-editor">
        {createKind?<CreateNodePanel data={data} kind={createKind} onClose={()=>setCreateKind('')}/>:<RegistryNodePanel key={selectedId} data={data} selectedId={selectedId} dirtyRef={dirtyRef} onDeleted={()=>setSelectedId('')} onDeleteNode={requestDelete}/>}
      </div>
    </div>
  </section>;
}
