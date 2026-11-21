'use client';
import {lazy,Suspense} from 'react';

import LocManagementWorkspace from '../../management/LocManagementWorkspace';
import {ProtectedManagementSlot} from '../../management/ManagementAccess';
import PanelLoading from '../../ui/PanelLoading';

const LazyLocKeywordManagement=lazy(()=>import('./LocKeywordManagement'));
const LocKeywordManagementLoading=PanelLoading;
function LocKeywordManagement(props){return <Suspense fallback={<LocKeywordManagementLoading/>}><LazyLocKeywordManagement {...props}/></Suspense>;}
const KEYWORD_ITEM=Object.freeze({
  value:'keywords',label:'關鍵詞管理',description:'LOC 大群組名稱與 Hash'
});

export default function LocKeywordManagementPage(){
  return <LocManagementWorkspace featureId="statics" navId="loc-keyword-sections" item={KEYWORD_ITEM}>
    <ProtectedManagementSlot><LocKeywordManagement/></ProtectedManagementSlot>
  </LocManagementWorkspace>;
}
