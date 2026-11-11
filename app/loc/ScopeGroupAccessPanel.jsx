'use client';
import {readAuthorization,canAuthorizeGroup} from './authorization-runtime.mjs';

// Display the grants already verified at explicit editor entry. Never make
// an independent permission HTTP request merely to render a management panel.
// The trusted application backend continues to authorize every protected write.
export default function ScopeGroupAccessPanel({groupId}){
  const verified=readAuthorization();
  const manager=verified?canAuthorizeGroup(groupId):false;
  return <section className="loc-card scope-feature-card" aria-label="Scope Group 權限">
    <h2>Scope Group 權限</h2>
    <p className="scope-status">群組：{String(groupId||'')}</p>
    <p className="scope-status">網站的 Scope 與角色由主要資料庫
      <code>api.manage</code> 決定；LOC Auth 不處理或複製任何角色。</p>
    <p className="scope-status" role="status">
      {!verified?'尚未透過編輯入口驗證權限。':
        manager?'目前身分具備管理權限。':'目前身分不具備此群組的管理權限。'}
    </p>
  </section>;
}
