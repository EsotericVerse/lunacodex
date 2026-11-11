'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useQueryClient} from '../../use-async-resource';
import dynamic from 'next/dynamic';
import {invalidateScopeBlockPage,selectLiveScopeBlocks} from '../../scope-data';
import {HomeBlock} from '../../home-block-model';
import {heroImageUrl as imageUrlOf} from '../../hero-image.mjs';
import {useEditDock,useEditDockForm} from '../../../modular/edit-dock';

const ScopeEditableBlocks=dynamic(()=>import('../../ScopeEditableBlocks'),{loading:()=>null});

// Admin has six feature tabs. Management Heroes are editors INSIDE the
// corresponding feature panel, not extra navigation items.
const FEATURES=Object.freeze([
  {id:'culture',label:'文化',managementKey:'time'},
  {id:'statics',label:'統計',managementKey:'keywords'},
  {id:'trace',label:'痕跡',managementKey:'spatial'},
  {id:'search',label:'搜尋',managementKey:'advanced'},
  {id:'admin',label:'系統管理'}
].map(feature=>({...feature,singleSlot:HomeBlock.shouldUseSingleFeatureHeroImage(feature.id)})));
const SCOPE_VARIANTS=Object.freeze([
  {kind:'group',label:'群組圖：首頁圖連結'},
  {kind:'scope',label:'個人圖：首頁圖連結'}
]);
const SINGLE_VARIANT=Object.freeze([{kind:'scope',label:'首頁圖連結'}]);
const MANAGEMENT_VARIANT=Object.freeze({kind:'scope',label:'首頁圖連結'});
// Personal Settings remains a separate Hero record, edited within the Admin panel.
const PERSONAL_SETTINGS_FEATURE=Object.freeze({
  id:'setting',label:'個人設定',singleSlot:HomeBlock.shouldUseSingleFeatureHeroImage('setting')
});
function pageFor(kind,feature){return kind+'_'+feature.id;}
const managementSlotFor=featureId=>HomeBlock.MANAGEMENT_HERO_SLOTS.find(slot=>slot.featureId===featureId);
const locSlots=HomeBlock.MANAGEMENT_HERO_SLOTS.filter(slot=>slot.audience==='loc'&&slot.key!=='system');

// Scope management shares scope_manage/order 1, Admin management shares scope_admin/order 1.
// Ordinary feature images remain independently editable.
function ImageSlot({feature,variant,onDirtyChange,pageOverride='',defaultUrl=''}) {
  const page=pageOverride||pageFor(variant.kind,feature);
  const dock=useEditDock();
  const inDock=Boolean(dock?.active&&dock.scopeId==='loc');
  const savingNow=useRef(false);
  const queryClient=useQueryClient();
  const [rows,setRows]=useState(null);
  const [value,setValue]=useState('');
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState('');
  const [revision,setRevision]=useState(0);
  const originalRow=rows?.find(row=>Number(row.block_order)===1);
  const original=imageUrlOf(originalRow);
  const dirty=rows!==null&&value.trim()!==(original||defaultUrl);
  const needsSeed=rows!==null&&Boolean(defaultUrl)&&!original;
  const canSave=dirty||needsSeed;

  useEffect(()=>{
    let active=true;
    (async()=>{
      try{
        const data=await selectLiveScopeBlocks('loc',page);
        if(!active)return;
        const row=data.find(item=>Number(item.block_order)===1);
        setRows(data);
        setValue(imageUrlOf(row)||defaultUrl);
      }catch(error){if(active)setStatus(error?.message||'讀取失敗。');}
    })();
    return()=>{active=false;};
  },[page,defaultUrl,revision]);

  async function save(){
    if(savingNow.current||busy||rows===null)return false;
    savingNow.current=true;setBusy(true);setStatus('');
    try{
      const {updateRows,insertRows}=await import('../../db-client.mjs');
      const trimmed=value.trim();
      if(trimmed){
        const url=new URL(trimmed,window.location.origin);
        if(!['https:','http:'].includes(url.protocol))throw new Error('首頁圖只接受 HTTP(S) 圖片網址。');
      }
      // silver.loc_blocks.block_image is TEXT carrying JSON, never a raw object.
      const image=trimmed?JSON.stringify({source:'custom',url:trimmed}):null;
      const fresh=await selectLiveScopeBlocks('loc',page);
      const row=fresh.find(item=>Number(item.block_order)===1);
      let result;
      if(row?.uid){
        result=await updateRows('silver.loc_blocks',{block_image:image},
          {filters:[{column:'uid',operator:'eq',value:row.uid},
            {column:'page_name',operator:'eq',value:page}]});
      }else{
        result=await insertRows('silver.loc_blocks',[{
          uid:HomeBlock.createUid(),page_name:page,block_order:1,
          block_entity:[],block_eyebrow:'',block_title:'',block_subtitle:'',
          block_text:'',block_image:image
        }]);
      }
      if(result?.error)throw new Error(result.error.message||'儲存失敗。');
      invalidateScopeBlockPage('loc',page);
      const verified=await selectLiveScopeBlocks('loc',page);
      const persisted=verified.find(item=>Number(item.block_order)===1);
      if(!persisted||imageUrlOf(persisted)!==trimmed)
        throw new Error('儲存後資料庫讀回不一致，請檢查寫入權限。');
      setRows(verified);
      await Promise.all([
        queryClient.invalidateQueries({queryKey:['scope-blocks','loc',page],refetchType:'none'}),
        queryClient.invalidateQueries({queryKey:['scope-blocks-live','loc',page],refetchType:'none'}),
        queryClient.invalidateQueries({queryKey:['app-bootstrap','loc',page],refetchType:'none'})
      ]);
      setStatus('首頁圖連結已儲存並讀回確認。');
      setRevision(n=>n+1);
      return true;
    }catch(error){setStatus(error?.message||'儲存失敗。');return false;}
    finally{savingNow.current=false;setBusy(false);}
  }
  useEffect(()=>{
    onDirtyChange?.(page,dirty);
    return()=>onDirtyChange?.(page,false);
  },[page,dirty,onDirtyChange]);
  useEditDockForm({save,isBusy:()=>busy,isDirty:()=>dirty});
  return <div className="scope-management-fields">
    <label className="scope-management-wide-field">
      <span>{variant.label}</span>
      <input type="url" className="scope-search-input" placeholder="https://loc.lo3rwang.cc/pics/..."
        value={value} disabled={rows===null||busy} onChange={event=>setValue(event.target.value)}/>
    </label>
    {!inDock?<button type="button" className="loc-button" disabled={rows===null||busy||!canSave} onClick={save}>
      {busy?'儲存中…':'儲存 Hero 圖片路徑'}
    </button>:null}
    {status?<p className="scope-status" role="status">{status}</p>:null}
  </div>;
}

function ManagementHeroDetails({slot,onDirtyChange}){
  const queryClient=useQueryClient();
  const dock=useEditDock();
  const inDock=Boolean(dock?.active&&dock.scopeId==='loc');
  const savingNow=useRef(false);
  const [rows,setRows]=useState(null);
  const [draft,setDraft]=useState({eyebrow:'',title:'',subtitle:'',text:''});
  const initial=useRef('');
  const [revision,setRevision]=useState(0);
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState('');
  const page=slot.page;
  const row=rows?.find(item=>Number(item.block_order)===1);
  const dirty=rows!==null&&JSON.stringify(draft)!==initial.current;
  const canSave=dirty||(rows!==null&&!row);
  useEffect(()=>{
    let live=true;
    (async()=>{
      try{
        const data=await selectLiveScopeBlocks('loc',page);
        if(!live)return;
        const found=data.find(item=>Number(item.block_order)===1);
        const fields={
          eyebrow:String(found?.block_eyebrow||slot.englishTitle||''),
          title:String(found?.block_title??slot.label),
          subtitle:String(found?.block_subtitle??''),
          text:String(found?.block_text??'')
        };
        setRows(data);setDraft(fields);
        initial.current=JSON.stringify(fields);
      }catch(error){if(live)setStatus(error?.message||'管理區塊讀取失敗。');}
    })();
    return()=>{live=false;};
  },[slot,page,revision]);
  async function save(){
    if(savingNow.current||busy||rows===null)return false;
    savingNow.current=true;setBusy(true);setStatus('');
    try{
      const eyebrow=draft.eyebrow.trim();
      const title=draft.title.trim();
      const subtitle=draft.subtitle.trim();
      if(!title||title.length>64||eyebrow.length>64||subtitle.length>128)
        throw new Error('英文標題及中文大標題最多 64 字、標題說明最多 128 字，且中文大標題不可空白。');
      const fields={
        block_eyebrow:eyebrow,block_title:title,
        block_subtitle:subtitle,block_text:draft.text
      };
      const {updateRows,insertRows}=await import('../../db-client.mjs');
      const fresh=await selectLiveScopeBlocks('loc',page);
      const found=fresh.find(item=>Number(item.block_order)===1);
      const result=found?.uid
        ?await updateRows('silver.loc_blocks',fields,{filters:[
          {column:'uid',operator:'eq',value:found.uid},
          {column:'page_name',operator:'eq',value:page}]})
        :await insertRows('silver.loc_blocks',[{
          uid:HomeBlock.createUid(),page_name:page,block_order:1,
          block_entity:[],block_image:null,...fields
        }]);
      if(result?.error)throw new Error(result.error.message||'儲存失敗。');
      invalidateScopeBlockPage('loc',page);
      const verified=await selectLiveScopeBlocks('loc',page);
      const saved=verified.find(item=>Number(item.block_order)===1);
      if(!saved||Object.entries(fields).some(([key,value])=>String(saved[key]??'')!==value))
        throw new Error('儲存後資料庫讀回不一致，請檢查寫入權限。');
      setRows(verified);
      await Promise.all([
        queryClient.invalidateQueries({queryKey:['scope-blocks','loc',page],refetchType:'none'}),
        queryClient.invalidateQueries({queryKey:['scope-blocks-live','loc',page],refetchType:'none'}),
        queryClient.invalidateQueries({queryKey:['app-bootstrap','loc',page],refetchType:'none'})
      ]);
      setStatus('管理區塊已儲存並讀回確認。');
      setRevision(v=>v+1);
      return true;
    }catch(error){setStatus(error?.message||'儲存失敗。');return false;}
    finally{savingNow.current=false;setBusy(false);}
  }
  useEffect(()=>{
    onDirtyChange?.('management-'+page,dirty);
    return()=>onDirtyChange?.('management-'+page,false);
  },[dirty,page,onDirtyChange]);
  useEditDockForm({save,isBusy:()=>busy,isDirty:()=>dirty});
  const field=(key,label,maxLength)=><label className="management-hero-copy-row" key={key}>
    <span>{label}</span>
    <input type="text" className="scope-search-input" maxLength={maxLength}
      disabled={rows===null||busy} value={draft[key]}
      onChange={event=>setDraft(current=>({...current,[key]:event.target.value}))}/>
  </label>;
  return <section className="management-hero-copy-editor">
    <p className="scope-status">名稱：{slot.label}</p>
    <div className="management-hero-copy-grid">
      {field('eyebrow','英文標題',64)}
      {field('title','中文大標題',64)}
      {field('subtitle','標題說明',128)}
    </div>
    <label className="scope-management-wide-field">
      <span>下方正文</span>
      <textarea className="scope-search-input" rows={4}
        disabled={rows===null||busy} value={draft.text}
        onChange={event=>setDraft(current=>({...current,text:event.target.value}))}/>
    </label>
    {status?<p className="scope-status" role="status">{status}</p>:null}
    {!inDock?<button className="loc-button primary" type="button" disabled={busy||rows===null||!canSave} onClick={save}>
      {busy?'儲存中…':'儲存管理區塊'}
    </button>:null}
  </section>;
}

export default function FeatureHeroImages(){
  const dock=useEditDock();
  const inDock=Boolean(dock?.active&&dock.scopeId==='loc');
  const [featureId,setFeatureId]=useState(FEATURES[0].id);
  const [locSlotKey,setLocSlotKey]=useState('members');
  const [groupOpen,setGroupOpen]=useState(false);
  const [editorRevision,setEditorRevision]=useState(0);
  const pendingEdits=useRef(new Set());
  const trackDirty=useCallback((key,dirty)=>{
    if(dirty)pendingEdits.current.add(key);
    else pendingEdits.current.delete(key);
  },[]);
  const selectFeature=id=>{
    if(id===featureId)return;
    if(pendingEdits.current.size&&!window.confirm('目前有尚未儲存的修改，確定放棄並切換功能嗎？'))return;
    pendingEdits.current.clear();setFeatureId(id);
  };
  const selectLocSlot=key=>{
    if(key===locSlotKey)return;
    if(pendingEdits.current.size&&!window.confirm('目前有尚未儲存的修改，確定放棄並切換管理項目嗎？'))return;
    pendingEdits.current.clear();setLocSlotKey(key);
  };
  const feature=FEATURES.find(item=>item.id===featureId)||FEATURES[0];
  const scopeSlot=feature.managementKey?HomeBlock.MANAGEMENT_HERO_SLOTS.find(slot=>slot.key===feature.managementKey):null;
  const locSlot=locSlots.find(slot=>slot.key===locSlotKey)||locSlots[0];
  return <section className="loc-card admin-workspace">
    <h2>功能區塊設定</h2>
    <div className="scope-preview-links" role="group" aria-label="功能區塊">
      {FEATURES.map(item=><button type="button" key={item.id}
        className={'loc-button'+(item.id===feature.id?' primary':'')}
        aria-pressed={item.id===feature.id}
        onClick={()=>selectFeature(item.id)}>{item.label}</button>)}
    </div>
    <section className="loc-card scope-inline-card" key={feature.id}>
      <h3>{feature.label}</h3>
      <ScopeEditableBlocks
        key={feature.id+':'+editorRevision}
        scopeId="loc"
        page={HomeBlock.featureHeroPageFor(feature.id)}
        orders={[1]} containerless
        slotClassName="loc-card" editSlotClassName="loc-card"
        placeholderFirstOrder={1} allowEditing
        authorizedByParent startInEditMode keepEditorOpen
        onEditorExit={()=>setEditorRevision(value=>value+1)}
        onDirtyChange={dirty=>trackDirty('blocks',dirty)}
        explicitEditButton allowDelete={false} allowEntities={false}
      />
      {(feature.singleSlot?SINGLE_VARIANT:SCOPE_VARIANTS).map(variant=>
        <ImageSlot feature={feature} variant={variant}
          pageOverride={feature.id==='admin'?'group_admin':''}
          onDirtyChange={trackDirty} key={feature.id+variant.kind}/>)}
      {scopeSlot?<section className="loc-card scope-inline-card" aria-label={scopeSlot.label}>
        <h4>{scopeSlot.label}</h4>
        <ManagementHeroDetails slot={scopeSlot} onDirtyChange={trackDirty}/>
        <ImageSlot feature={feature} variant={MANAGEMENT_VARIANT}
          pageOverride="scope_manage" defaultUrl={HomeBlock.MANAGEMENT_HERO_IMAGE_URL}
          onDirtyChange={trackDirty}/>
      </section>:null}
      {feature.id==='admin'?<details className="loc-card scope-inline-card" onToggle={event=>{
        const open=event.currentTarget.open;
        if(!open&&pendingEdits.current.size&&!window.confirm('管理項目尚有未儲存的修改，確定放棄嗎？')){
          event.currentTarget.open=true;return;
        }
        setGroupOpen(open);
      }}>
        <summary>系統管理入口設定</summary>
        {groupOpen?<><label className="scope-management-wide-field">
          <span>管理項目</span>
          <select className="scope-search-input" value={locSlotKey}
            onChange={event=>selectLocSlot(event.target.value)}>
            {locSlots.map(slot=><option key={slot.key} value={slot.key}>{slot.label}</option>)}
          </select>
        </label>
        <ManagementHeroDetails key={locSlot.key} slot={locSlot} onDirtyChange={trackDirty}/>
        <ImageSlot key={locSlot.page} feature={feature} variant={MANAGEMENT_VARIANT}
          pageOverride={HomeBlock.managementHeroImagePage(locSlot)}
          defaultUrl={HomeBlock.managementHeroDefaultImage(locSlot)}
          onDirtyChange={trackDirty}/>
        </>:null}
      </details>:null}
      {feature.id==='admin'?<section className="loc-card scope-inline-card" aria-label="個人設定">
        <h4>個人設定</h4>
        <ScopeEditableBlocks
          key={'setting:'+editorRevision}
          scopeId="loc"
          page={HomeBlock.featureHeroPageFor(PERSONAL_SETTINGS_FEATURE.id)}
          orders={[1]} containerless
          slotClassName="loc-card" editSlotClassName="loc-card"
          placeholderFirstOrder={1} allowEditing
          authorizedByParent startInEditMode keepEditorOpen
          onEditorExit={()=>setEditorRevision(value=>value+1)}
          onDirtyChange={dirty=>trackDirty('setting-blocks',dirty)}
          explicitEditButton allowDelete={false} allowEntities={false}
        />
        <ImageSlot feature={PERSONAL_SETTINGS_FEATURE} variant={SINGLE_VARIANT[0]}
          onDirtyChange={trackDirty} key="setting:scope"/>
      </section>:null}
    </section>
  </section>;
}
