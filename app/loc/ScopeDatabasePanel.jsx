'use client';

// Scope data comes from the site's native Kysely business connection.
// Better Auth establishes identity only; api.manage independently grants writes.
export default function ScopeDatabasePanel({scopeId}){
  return <section className="loc-card scope-feature-card" aria-label="Scope 資料庫">
    <h2>Scope 資料庫</h2>
    <p className="scope-status">Scope：<code>{scopeId}</code></p>
    <p className="scope-status">資料庫連線由受信任的 LOC 應用後端透過 Kysely 建立；讀取不依賴 Auth，寫入權限只由 api.manage 決定。
      此處不接受 SQL URL、資料庫密碼或獨立 Gateway 端點。</p>
    <p><a className="loc-button" href="/local/settings/">前往設定選擇資料庫</a></p>
  </section>;
}
