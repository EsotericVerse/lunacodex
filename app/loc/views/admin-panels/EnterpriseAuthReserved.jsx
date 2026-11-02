'use client';

// Reserved interface only: never collects LDAP passwords or enables a login flow.
export default function EnterpriseAuthReserved(){
  return <section className="loc-card admin-workspace" aria-labelledby="enterprise-auth-heading">
    <h2 id="enterprise-auth-heading">企業認證（預備功能）</h2>
    <p>預留 Microsoft AD／Entra ID、LDAP 身分橋接服務與企業 SSO 的設定入口。目前尚未啟用，也不影響現行 Clerk 登入。</p>
    <div className="scope-status" role="status">未啟用 · 尚未設定企業連線</div>
    <fieldset disabled>
      <legend>未來連線設定</legend>
      <label>身分來源
        <select defaultValue="entra"><option value="entra">Microsoft AD／Entra ID</option><option value="ldap">LDAP（透過 SAML／OIDC 橋接）</option><option value="other">其他企業身分服務</option></select>
      </label>
      <label>連線協定
        <select defaultValue="oidc"><option value="oidc">OIDC</option><option value="saml">SAML</option></select>
      </label>
      <label>企業網域
        <input type="text" placeholder="company.example" autoComplete="off"/>
      </label>
    </fieldset>
    <p className="scope-status">正式啟用時由 Clerk 管理企業連線與機密，LOC Authority 保留授權控管。此頁不儲存憑證，也不修改 OAuth 設定。</p>
  </section>;
}
