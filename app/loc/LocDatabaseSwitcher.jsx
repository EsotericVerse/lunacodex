'use client';

// LOC's primary database is a business connection, independent of LOC Auth.
// The old Auth-owned SQL target registry and provider credential editor
// have been retired; do not call its obsolete /v1/databases endpoints.
export default function LocDatabaseSwitcher(){
  return <section className="loc-card" aria-label="主要資料庫連線">
    <h2>主要資料庫連線</h2>
    <p className="scope-status">LOC 的文章、錨點、搜尋與管理資料由主要 PostgreSQL
      資料庫透過 Kysely 處理，與 LOC Auth 的登入及憑證簽發分開。</p>
    <p className="scope-status">資料庫連線資訊與憑證僅在伺服器環境配置，
      不由瀏覽器保存或切換，亦不依賴任何 Auth 物件。</p>
  </section>;
}
