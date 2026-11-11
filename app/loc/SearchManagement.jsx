'use client';

import {useEffect} from 'react';
import dynamic from 'next/dynamic';
import {useSearchParams} from 'next/navigation';
import {FeaturePage} from '../modular/ui';
import ManagementWorkspaceFrame from './ManagementWorkspaceFrame';
import {useScopeRuntime} from '../modular/use-scope-runtime';
import {useEditDock} from '../modular/edit-dock';
import {useAccount} from './use-account';
import ManagementSectionNav,{useManagementSection} from '../modular/ManagementSectionNav';

const ScopeEditableBlocks=dynamic(()=>import('./ScopeEditableBlocks'),{loading:()=>null});
const ManagementArticlePublisher=dynamic(()=>import('./ManagementArticlePublisher'),{loading:()=>null});
const ManagementMediaWorkspace=dynamic(()=>import('./ManagementMediaWorkspace'),{loading:()=>null});
const ManagementContentTarget=dynamic(()=>import('./ManagementContentTarget'),{loading:()=>null});
const ManagementImportPanel=dynamic(()=>import('./ManagementImportPanel'),{loading:()=>null});
const ScopeSettingsPanel=dynamic(()=>import('./ScopeSettingsPanel'),{loading:()=>null});
const ScopeGroupAccessPanel=dynamic(()=>import('./ScopeGroupAccessPanel'),{loading:()=>null});

// Article Control sections share one Scope ownership and authorization boundary. Moving a panel
// never changes its Scope ownership, database tables or authorizer.
export const ARTICLE_CONTROL_SECTIONS=Object.freeze([
  {value:'publish',label:'文章管理',shortLabel:'文章管理'},
  {value:'blocks',label:'頁面區塊與治理',shortLabel:'區塊'},
  {value:'import',label:'匯入',shortLabel:'匯入'}
]);

// LOC's global management has its own permissions and existing destinations.
// It must not gain an arbitrary Scope's article or classification editor.
const LOC_OPTIONS=Object.freeze([
  {value:'media',label:'發表多媒體',shortLabel:'媒體'},
  {value:'trace',label:'治理原則',shortLabel:'治理原則'}
]);
const SETTINGS_OPTION={value:'settings',label:'主題與資料庫',shortLabel:'設定'};
const GROUP_OPTION={value:'groupAccess',label:'群組權限',shortLabel:'授權'};
// LOC no longer has a separate management search. Keep old links functional.
const OLD_LOC_SECTION_ALIASES=Object.freeze({search:'media'});
const OLD_SCOPE_SECTION_ALIASES=Object.freeze({
  search:'publish',media:'publish',suggestions:'blocks',trace:'blocks'
});

export default function SearchManagement(){
  const {scopeId}=useScopeRuntime();
  const editDock=useEditDock();
  const account=useAccount();
  const searchParams=useSearchParams();
  const isLocAdmin=scopeId==='loc';
  // Personal preferences belong to the last Settings tab, not Article Control.
  // Preserve old bookmarks without mounting the retired Scope classification editor.
  useEffect(()=>{
    if(isLocAdmin||searchParams?.get('section')!=='others')return;
    window.location.replace('/local/settings/?section=features');
  },[isLocAdmin,searchParams]);
  // Old /search/manage/?section=search URLs must not point at a removed tab.
  // Update only the bookmark state, without reloading the authenticated editor.
  useEffect(()=>{
    if(!isLocAdmin||searchParams?.get('section')!=='search')return;
    const url=new URL(window.location.href);
    url.searchParams.set('section','media');
    window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);
  },[isLocAdmin,searchParams]);
  const groupAuthorized=isLocAdmin||account.canManageGroupSync(scopeId);
  const options=isLocAdmin?[...LOC_OPTIONS,GROUP_OPTION]
    :groupAuthorized
      ?[...ARTICLE_CONTROL_SECTIONS,SETTINGS_OPTION,GROUP_OPTION]
      :[...ARTICLE_CONTROL_SECTIONS,SETTINGS_OPTION];
  const [activeSection,setSection]=useManagementSection(options,isLocAdmin?'media':'publish',
    isLocAdmin?OLD_LOC_SECTION_ALIASES:OLD_SCOPE_SECTION_ALIASES);
  // LOC Auth authorization can arrive after the section query is first read.
  // Restore a bookmarked Group Access tab once its permission is available.
  useEffect(()=>{
    if(groupAuthorized&&searchParams?.get('section')==='groupAccess'&&activeSection!=='groupAccess')
      setSection('groupAccess');
  },[groupAuthorized,activeSection,searchParams,setSection]);
  const currentSection=options.find(option=>option.value===activeSection)||options[0];

  return <FeaturePage featureId="search">
    <ManagementWorkspaceFrame level={isLocAdmin?'group':'scope'} title="文章管理">
      <ManagementSectionNav id="management-search-sections" title="文章管理"
        panelId="management-search-panel" items={options} mobileSelect
        value={activeSection} onChange={next=>{
          if(next===activeSection)return;
          if(editDock?.active)editDock.switchSection(next,setSection);
          else setSection(next);
        }}/>
      <div id="management-search-panel" className="management-workspace-panel" role="region"
        aria-labelledby={'management-search-sections-option-'+currentSection.value}>
        {!isLocAdmin&&activeSection==='publish'?<div className="article-control-stacked">
          <section aria-labelledby="article-control-article-heading">
            <h3 id="article-control-article-heading">發表／編輯文章</h3>
            <ManagementArticlePublisher scopeId={scopeId}/>
          </section>
          <section aria-labelledby="article-control-media-heading">
            <h3 id="article-control-media-heading">發表多媒體</h3>
            <ManagementMediaWorkspace scopeId={scopeId}/>
          </section>
        </div>:null}

        {!isLocAdmin&&activeSection==='blocks'?<div className="article-control-stacked">
          <section aria-labelledby="article-control-suggestions-heading">
            <h3 id="article-control-suggestions-heading">建議搜尋</h3>
            <ScopeEditableBlocks key={scopeId+'-suggestions'} scopeId={scopeId} page="search" orders={[1]}
              className="scope-search-reference-grid"
              slotClassName="scope-search-reference-block"
              editSlotClassName="scope-search-reference-block"
              headingLevel={2} allowEditing allowDelete={false}
              allowInlineChildAdd explicitEditButton
              authorizedByParent startInEditMode/>
          </section>
          <section aria-labelledby="article-control-principles-heading">
            <h3 id="article-control-principles-heading">治理原則</h3>
            <ScopeEditableBlocks key={scopeId+'-principles'} scopeId={scopeId} page="trace"
              className="loc-grid two trace-grid" headingLevel={2} allowDelete
              authorizedByParent startInEditMode explicitEditButton/>
          </section>
        </div>:null}

        {!isLocAdmin&&activeSection==='import'
          ?<ManagementImportPanel key={scopeId+'-import'} scopeId={scopeId}/>:null}
        {!isLocAdmin&&activeSection==='settings'
          ?<ScopeSettingsPanel key={scopeId+'-settings'} scopeId={scopeId}/>:null}
        {activeSection==='groupAccess'&&(isLocAdmin||account.canManageGroupSync(scopeId))
          ?<ScopeGroupAccessPanel groupId={scopeId}/>:null}
        {isLocAdmin&&activeSection==='media'
          ?<ManagementContentTarget scopeId={scopeId} mode="media" globalAdmin/>:null}
        {isLocAdmin&&activeSection==='trace'?<ScopeEditableBlocks key={scopeId+'-trace'}
          scopeId={scopeId} page="trace"
          className="loc-grid two trace-grid trace-grid-loc"
          headingLevel={2} allowDelete authorizedByParent startInEditMode explicitEditButton/>:null}
      </div>
    </ManagementWorkspaceFrame>
  </FeaturePage>;
}
