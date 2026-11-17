'use client';
import {useAccount} from '../auth/use-account';

// Present the existing LOC management Session projection. Do not open a
// second /api/loc-permissions request just to display the same Scope role.
// Viewing a role neither grants permission nor replaces server-side checks.
export default function ScopeGroupAccessPanel({groupId}){
  const account=useAccount();
  const checking=account.loading||account.permissionLoading;
  const manager=Boolean(account.user&&
    account.canLocAccessSync('group',String(groupId||'')));
  const lastKnown=account.lastKnownPermissionSnapshot;
  const lastRole=lastKnown?.scopes.find(item=>item.scopeId===String(groupId||'').toLowerCase())?.role;
  const status=checking?'正在讀取權限…':account.error
    ?(lastRole?'目前無法重新驗證權限；此分頁上次已驗證的角色為 '+lastRole+'（僅供顯示，不開放管理操作）。':'無法取得目前的 LOC 編輯權限。')
    :manager?'目前身分具備管理權限。':'目前身分不具備此群組的管理權限。';
  return <section className="loc-card scope-feature-card" aria-label="Scope Group 權限">
    <h2>Scope Group 權限</h2>
    <p className="scope-status">群組：{String(groupId||'')}</p>
    <p className="scope-status">網站的 Scope 與角色由主要資料庫
      <code>api.manage</code> 決定；LOC Auth 不處理或複製任何角色。</p>
    <p className="scope-status" role="status">{status}</p>
  </section>;
}
