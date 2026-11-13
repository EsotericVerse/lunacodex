'use client';

import dynamic from 'next/dynamic';
import {useAccount} from './use-account';
import {defaultScopeData} from './scope-data';
import {SCOPE_ROUTE_INDEX} from '../modular/scope-route-index.js';

// Article Management is the author's workspace on LOC. Its media and
// article destinations are derived from the owner Scope, not user-selectable
// database identifiers. Other Scope pages continue using their own scopeId.
const DEFAULT_MANAGED_SCOPE_ID=SCOPE_ROUTE_INDEX.find(row=>row.active&&row.scope_id!=='loc')?.scope_id||'';
const ManagementMediaWorkspace=dynamic(()=>import('./ManagementMediaWorkspace'),{loading:()=>null});
const ManagementImportPanel=dynamic(()=>import('./ManagementImportPanel'),{loading:()=>null});

export default function ManagementContentTarget({scopeId,mode='import',globalAdmin=false}){
  const account=useAccount();
  const targetScopeId=globalAdmin&&scopeId==='loc'?DEFAULT_MANAGED_SCOPE_ID:scopeId;
  const allowed=Boolean(targetScopeId&&(account.canLocAccessSync('scope',targetScopeId)||(globalAdmin&&account.canLocAccessSync('global'))));
  const scopeData=allowed?(account.scopeDataFor(targetScopeId)||defaultScopeData(targetScopeId)):null;
  const table=mode==='media'?scopeData?.galaxyMedia:scopeData?.galaxy;
  return <section className="loc-card admin-workspace">
    <h2>{mode==='media'?'新增多媒體':'文章資料匯入'}</h2>
    {account.loading||account.permissionLoading
      ?<p className="scope-status" role="status">正在確認管理權限…</p>
      :!allowed
        ?<p className="scope-status scope-error" role="alert">沒有此 Scope 的資料寫入權限。</p>
        :!table
          ?<p className="scope-status scope-error" role="alert">無法取得目前 Scope 的資料表，已停止寫入。</p>
          :mode==='media'
            ?<ManagementMediaWorkspace key={targetScopeId+':media'} scopeId={targetScopeId}
              dockScopeId={globalAdmin?scopeId:targetScopeId} globalAdmin={globalAdmin}/>
            :<ManagementImportPanel key={targetScopeId+':import'} scopeId={targetScopeId}/>}
  </section>;
}
