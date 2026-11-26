'use client';
import {useCallback,useRef,useState} from 'react';
import dynamic from 'next/dynamic';
import {HomeBlock} from '../../blocks/home-block-model';

const ScopeEditableBlocks=dynamic(()=>import('../../blocks/ScopeEditableBlocks'),{loading:()=>null});

// The feature section order mirrors the written routing and image contract:
// management destinations first, their public feature page below them.
const FEATURES=Object.freeze([
  {id:'culture',label:'文化',managementKeys:['time']},
  {id:'statics',label:'統計',managementKeys:['locKeywords']},
  {id:'trace',label:'痕跡',managementKeys:['spatial']},
  {id:'search',label:'搜尋',managementKeys:['articles']},
  {id:'admin',label:'系統管理',managementKeys:['system','members','setting']}
]);
const MANAGEMENT_BY_KEY=new Map(HomeBlock.MANAGEMENT_HERO_SLOTS.map(slot=>[slot.key,slot]));
const USER_PAGE_LABELS=Object.freeze({
  culture:'文化',statics:'統計',trace:'痕跡',search:'搜尋'
});

function HeroEditor({page,dirtyKey,onDirtyChange}){
  return <ScopeEditableBlocks
    key={page}
    scopeId="loc" page={page} orders={[1]} containerless
    slotClassName="loc-card" editSlotClassName="loc-card"
    placeholderFirstOrder={1} allowEditing
    authorizedByParent startInEditMode keepEditorOpen
    onDirtyChange={dirty=>onDirtyChange?.(dirtyKey,dirty)}
    explicitEditButton allowDelete={false} allowEntities={false} allowImages
  />;
}

function slotPage(slot){
  return slot?.key==='setting'?HomeBlock.featureHeroPageFor('setting')
    :HomeBlock.managementHeroImagePage(slot);
}

export default function FeatureHeroImages(){
  const [featureId,setFeatureId]=useState(FEATURES[0].id);
  const pendingEdits=useRef(new Set());
  const trackDirty=useCallback((key,dirty)=>{
    if(dirty)pendingEdits.current.add(key);
    else pendingEdits.current.delete(key);
  },[]);
  const feature=FEATURES.find(item=>item.id===featureId)||FEATURES[0];
  const selectFeature=id=>{
    if(id===featureId)return;
    if(pendingEdits.current.size&&!window.confirm('目前有尚未儲存的修改，確定放棄並切換功能嗎？'))return;
    pendingEdits.current.clear();setFeatureId(id);
  };
  const renderSlot=(slot,index)=>{
    const page=slotPage(slot);
    const image=slot.key==='setting'?HomeBlock.featureHeroDefaultImage('setting')
      :HomeBlock.managementHeroDefaultImage(slot);
    const routeLabel=slot.audience==='loc'
      ?({system:'/admin/',members:'/manage/',locKeywords:'/statics/manage/',articles:'/search/manage/',setting:'/local/settings/'}[slot.key])
      :({time:'/culture/manage/',keywords:'/statics/manage/',spatial:'/trace/manage/',advanced:'/search/manage/'}[slot.key]);
    return <section className="loc-card scope-inline-card" key={slot.key} aria-label={slot.label}>
      <h4>{slot.label}</h4>
      <p className="scope-status">管理路由：{routeLabel} · {image.split('/').pop()}</p>
      <HeroEditor page={page} dirtyKey={'hero:'+page}
        onDirtyChange={trackDirty}/>
    </section>;
  };
  const userPage=feature.id==='admin'?'group_admin':HomeBlock.featureHeroPageFor(feature.id);
  const userImage=HomeBlock.featureHeroDefaultImage(feature.id)||
    HomeBlock.defaultHeroImageForPage('loc',userPage);
  const userRoute=feature.id==='admin'?'/admin/':'/'+feature.id+'/';

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
      {feature.id==='admin'?<>
        {['system','members'].map(key=>renderSlot(MANAGEMENT_BY_KEY.get(key),0))}
        {renderSlot({key:'setting',label:'個人設定',audience:'loc',page:'group_setting'},2)}
      </>:<>
        {feature.managementKeys.map((key,index)=>renderSlot(MANAGEMENT_BY_KEY.get(key),index))}
        <section className="loc-card scope-inline-card" aria-label={USER_PAGE_LABELS[feature.id]+' 使用者頁'}>
          <h4>{USER_PAGE_LABELS[feature.id]}</h4>
          <p className="scope-status">使用者路由：{userRoute} · {userImage.split('/').pop()}</p>
          <HeroEditor page={userPage} dirtyKey={'hero:'+userPage}
            onDirtyChange={trackDirty}/>
        </section>
      </>}
    </section>
  </section>;
}
