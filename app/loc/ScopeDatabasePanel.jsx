'use client';

// Scope data access is resolved by the signed LOC Auth selection and the
// trusted application's native Kysely driver. No browser-managed SQL endpoint
// or per-Scope Gateway registration is supported.
export default function ScopeDatabasePanel({scopeId}){
  return <section className="loc-card scope-feature-card" aria-label="Scope 資料庫">
    <h2>Scope 資料庫</h2>
    <p className="scope-status">Scope：<code>{scopeId}</code></p>
    <p className="scope-status">資料庫選擇與權限由 LOC Auth 管理，資料庫連線僅由受信任的應用後端建立。
      此處不接受 SQL URL、資料庫密碼或獨立 Gateway 端點。</p>
    <p><a className="loc-button" href="/local/settings/">前往設定選擇資料庫</a></p>
  </section>;
}
