'use client';

import dynamic from 'next/dynamic';
import LocManagementWorkspace from '../../management/LocManagementWorkspace';
import PanelLoading from '../../ui/PanelLoading';

const LocKeywordManagement=dynamic(()=>import('./LocKeywordManagement'),{loading:PanelLoading});
const KEYWORD_ITEM=Object.freeze({
  value:'keywords',label:'關鍵詞管理',description:'LOC 大群組名稱與 Hash'
});

export default function LocKeywordManagementPage(){
  return <LocManagementWorkspace featureId="statics" navId="loc-keyword-sections" item={KEYWORD_ITEM}>
    <LocKeywordManagement/>
  </LocManagementWorkspace>;
}
