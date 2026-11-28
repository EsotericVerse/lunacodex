'use client';

import dynamic from 'next/dynamic';
import {FeaturePage} from '../../modular/ui';
import ManagementWorkspaceFrame from '../management/ManagementWorkspaceFrame';
import {recoverChunkOnce} from '../ui/chunk-recovery.mjs';
import {useScopeRuntime} from '../../modular/use-scope-runtime';
import {useEditDock} from '../../modular/edit-dock';
import {useVerifiedManagementGrants} from '../management/ManagementAccess';
import ManagementNetworkNav from '../../modular/ManagementNetworkNav';
import {ManagementSectionTransition,useManagementSection} from '../../modular/ManagementSectionNav';
import {ProtectedManagementSlot} from '../management/ManagementAccess';

const ScopeEditableBlocks=dynamic(()=>import('../blocks/ScopeEditableBlocks').catch(recoverChunkOnce),{loading:()=>null});
const ManagementArticlePublisher=dynamic(()=>import('../management/ManagementArticlePublisher').catch(recoverChunkOnce),{loading:()=>null});
const ManagementContentTarget=dynamic(()=>import('../management/ManagementContentTarget').catch(recoverChunkOnce),{loading:()=>null});
const ManagementImportPanel=dynamic(()=>import('../import/ManagementImportPanel').catch(recoverChunkOnce),{loading:()=>null});
const ScopeSettingsPanel=dynamic(()=>import('../scope/ScopeSettingsPanel').catch(recoverChunkOnce),{loading:()=>null});
const ScopeGroupAccessPanel=dynamic(()=>import('../scope/ScopeGroupAccessPanel').catch(recoverChunkOnce),{loading:()=>null});

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
  {value:'publish',label:'文章管理',shortLabel:'文章'},
  {value:'trace',label:'治理原則',shortLabel:'治理原則'},
  {value:'import',label:'匯入',shortLabel:'匯入'}
]);
const GROUP_OPTION={value:'groupAccess',label:'群組權限',shortLabel:'授權'};

export default function SearchManagement(){
  const {scopeId}=useScopeRuntime();
  const editDock=useEditDock();
  const account=useVerifiedManagementGrants();
  const isLocAdmin=scopeId==='loc';
  const groupAuthorized=isLocAdmin||account.canLocAccessSync('group',scopeId);
  const authorPage=scopeId==='lo3rwang';
  const canShowGroupAccess=isLocAdmin||!authorPage;
  const options=isLocAdmin?[...LOC_OPTIONS,GROUP_OPTION]
    :canShowGroupAccess?[...ARTICLE_CONTROL_SECTIONS,GROUP_OPTION]:ARTICLE_CONTROL_SECTIONS;
  const [activeSection,setSection]=useManagementSection(options,'publish');
  return <FeaturePage featureId="search">
    <ManagementWorkspaceFrame level={isLocAdmin?'group':'scope'} title="文章管理">
      <ManagementNetworkNav id="management-search-sections" title="文章管理"
        panelId="management-search-panel" items={options} mobileSelect
        value={activeSection} onChange={next=>{
          if(next===activeSection)return;
          if(editDock?.active)editDock.switchSection(next,setSection);
          else setSection(next);
        }}/>
      <div id="management-search-panel" className="management-workspace-panel" role="region"
        aria-labelledby="management-search-sections-selected-title">
        <ManagementSectionTransition value={activeSection}>
        <ProtectedManagementSlot>
        {!isLocAdmin&&activeSection==='publish'?<ManagementArticlePublisher scopeId={scopeId}/>:null}

        {!isLocAdmin&&activeSection==='blocks'?<div className="article-control-stacked">
          <ScopeSettingsPanel key={scopeId+'-theme'} scopeId={scopeId}/>
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
        {activeSection==='groupAccess'&&options.some(item=>item.value==='groupAccess')&&(isLocAdmin||account.canLocAccessSync('group',scopeId))
          ?<ScopeGroupAccessPanel groupId={scopeId}/>:null}
        {isLocAdmin&&activeSection==='publish'
          ?<ManagementContentTarget scopeId={scopeId} mode="article" globalAdmin/>:null}
        {isLocAdmin&&activeSection==='import'
          ?<ManagementContentTarget scopeId={scopeId} mode="import" globalAdmin/>:null}
        {isLocAdmin&&activeSection==='trace'?<ScopeEditableBlocks key={scopeId+'-trace'}
          scopeId={scopeId} page="trace"
          className="loc-grid two trace-grid trace-grid-loc"
          headingLevel={2} allowDelete authorizedByParent startInEditMode explicitEditButton/>:null}
        {activeSection==='groupAccess'&&!groupAuthorized
          ?<p className="scope-status">目前沒有此群組的管理權限。</p>:null}
        </ProtectedManagementSlot>
        </ManagementSectionTransition>
      </div>
    </ManagementWorkspaceFrame>
  </FeaturePage>;
}
