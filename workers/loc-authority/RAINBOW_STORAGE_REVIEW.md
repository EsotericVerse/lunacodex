# Rainbow Auth storage: schema and grants review (NO DDL)

**Status: REVIEW ONLY; no database object or permission has been created.**
This inventory is based on the pinned **better-auth 1.7.18** and **@better-auth/oauth-provider 1.7.18** vendor schemas, not on the temporary Supabase `loc_auth` test table. The model names below are those mapped by `workers/loc-authority/auth.mjs`. The intended namespace is **`silver` only if separately approved**; the runtime refuses to select a namespace until `LOC_AUTH_SCHEMA` is provided.

## Exact logical models and field inventory

Fields are application-level names from the pinned vendor schema, **not yet verified PostgreSQL column DDL**. The Better Auth built-in adapter supplies `id` for every model; core models additionally include `createdAt` and `updatedAt`. For plugin tables these fields appear where specified in the vendor schema, and some adapters supply the implicit primary key.

| Logical model | Requested table | Purpose | Fields to review |
| --- | --- | --- | --- |
| `user` | `rainbow_auth` | 本地 Auth 使用者、驗證後的電子信箱 | `id`, `createdAt`, `updatedAt`, `email`, `emailVerified`, `name`, `image` |
| `session` | `rainbow_session` | 登入 Session 與有效期 | `id`, `createdAt`, `updatedAt`, `userId`, `expiresAt`, `token`, `ipAddress`, `userAgent` |
| `account` | `rainbow_account` | Google 等外部 OAuth 帳號關聯 | `id`, `createdAt`, `updatedAt`, `providerId`, `accountId`, `userId`, `accessToken`, `refreshToken`, `idToken`, `accessTokenExpiresAt`, `refreshTokenExpiresAt`, `scope`, `password` |
| `verification` | `rainbow_verification` | OAuth／驗證流程的短期驗證資料 | `id`, `createdAt`, `updatedAt`, `value`, `expiresAt`, `identifier` |
| `jwks` | `rainbow_jwks` | JWT 簽章公私鑰與輪替時間 | `id`, `publicKey`, `privateKey`, `createdAt`, `expiresAt`, `alg`, `crv` |
| `oauthClient` | `rainbow_oauth_client` | MCP／SSO Client 註冊與狀態 | `id`, `clientId`, `clientSecret`, `clientDiscoveryId`, `disabled`, `skipConsent`, `enableEndSession`, `subjectType`, `scopes`, `clientCredentialsScopes`, `userId`, `createdAt`, `updatedAt`, `name`, `uri`, `icon`, `contacts`, `tos`, `policy`, `softwareId`, `softwareVersion`, `softwareStatement`, `redirectUris`, `postLogoutRedirectUris`, `backchannelLogoutUri`, `backchannelLogoutSessionRequired`, `tokenEndpointAuthMethod`, `applicationType`, `jwks`, `jwksUri`, `grantTypes`, `responseTypes`, `requirePKCE`, `dpopBoundAccessTokens`, `referenceId`, `metadata` |
| `oauthResource` | `rainbow_oauth_resource` | 受保護 MCP 資源、Scope 約束 | `id`, `identifier`, `name`, `accessTokenTtl`, `refreshTokenTtl`, `signingAlgorithm`, `signingKeyId`, `allowedScopes`, `customClaims`, `dpopBoundAccessTokensRequired`, `disabled`, `createdAt`, `updatedAt`, `policyVersion`, `metadata` |
| `oauthClientResource` | `rainbow_oauth_client_resource` | Client 到 Resource 的授權連結 | `id`, `clientId`, `resourceId`, `metadata`, `createdAt` |
| `oauthRefreshToken` | `rainbow_oauth_refresh_token` | Refresh Token 與撤銷／輪替 | `id`, `token`, `clientId`, `sessionId`, `userId`, `referenceId`, `authorizationCodeId`, `resources`, `requestedUserInfoClaims`, `expiresAt`, `createdAt`, `revoked`, `rotatedAt`, `rotationReplayResponse`, `rotationReplayExpiresAt`, `authTime`, `confirmation`, `scopes` |
| `oauthAccessToken` | `rainbow_oauth_access_token` | 需儲存的 Access Token／撤銷紀錄 | `id`, `token`, `clientId`, `sessionId`, `userId`, `referenceId`, `authorizationCodeId`, `resources`, `requestedUserInfoClaims`, `refreshId`, `expiresAt`, `createdAt`, `revoked`, `confirmation`, `scopes` |
| `oauthConsent` | `rainbow_oauth_consent` | 使用者對 Client 的委託同意 | `id`, `clientId`, `userId`, `referenceId`, `resources`, `requestedUserInfoClaims`, `scopes`, `createdAt`, `updatedAt` |
| `oauthClientAssertion` | `rainbow_oauth_client_assertion` | 一次性 Client Assertion 防重放 | `id`, `expiresAt` |

## Proposed database access review (NOT applied)

- **Database connection**: Better Auth built-in Kysely/Postgres adapter, restricted runtime role with access only to the explicitly approved `rainbow_*` tables. Do not share a database owner/DDL credential with the Worker.
- **No anonymous direct table access**: no `PUBLIC`, `anon`, website, browser or MCP bearer-token role receives direct SQL permissions for these tables. Every user operation passes through Better Auth and its approved OAuth endpoints.
- **SELECT**: only the dedicated Auth runtime role can read these records; `rainbow_jwks.privateKey`, OAuth secrets, refresh tokens and Session tokens must never be exposed through ordinary APIs.
- **INSERT / UPDATE / DELETE**: allowed to the Auth runtime role only as required by Better Auth session lifecycle, credential linking, JWKS rotation, OAuth resource seeding, Client management, consent, token rotation/revocation and expiry cleanup. No LOC business role may mutate these rows directly.
- **`rainbow_oauth_client_assertion`**: append/use as one-time assertion replay guard; expired rows may be deleted by an explicitly approved maintenance process, never arbitrary clients.
- **Row-level security**: RLS enablement, exact role names and individual `SELECT/INSERT/UPDATE/DELETE` policies remain **UNAPPROVED**. Do not auto-add a blanket policy, permission grant or user-based RLS condition. A shared Auth backend DB role does not inherently carry the end-user's OAuth identity, so adding a per-user RLS condition could break login or token issuance. Review each proposed SQL policy separately before creation.
- **Schema / indexes / FK / types**: obtain the exact generated **1.7.18** vendor DDL and individually inspect required/optional columns, unique indexes, foreign keys and cascade semantics before executing any statement. Field lists above do **not** authorize generating, migrating, altering or dropping tables.
- **Only after separate approval**: preflight read-only schema check, then approved DDL under an explicitly authorized schema owner; runtime uses a separate non-DDL role. No RPC, automatic migration or startup schema creation.
- **Other databases**: Leave existing LOC business tables, Supabase, Neon managed Auth, other schema namespaces, and the removed test table untouched.

## Security and verification gates

1. Validate exact pinned-vendor DDL, approved column types, indexes and one-table-at-a-time RLS/CRUD permissions.
2. Validate normal Auth login and `emailVerified`, session creation/refresh/revocation and 30-minute signed Cookie Cache. Privileged LOC Web mutations bypass the Cookie Cache.
3. Validate OIDC Discovery, authorization code with PKCE S256, consent, token issuance, UserInfo, JWKS rotation and Refresh Token rotation.
4. Verify the first-party Galaxy-Link's published CIMD Client ID, HTTPS metadata, redirect URI and `loc:import` scope. Open unauthenticated RFC 7591 registration is disabled.
5. Verify all delegated **MCP writes** require both `loc:import` on the Access Token and the current business `api.manage` authorization; public reads remain independent.
6. Verify QoS / concurrency / platform-failover behavior separately. Per-isolate counters are not cross-isolate abuse control; manual immediate blacklist and stateless JWT revocation still require a reviewed shared design.
7. The PR is **not deployable** until all gates and a real Auth DB integration test pass. CI and merge conflicts must also be resolved without overwriting unrelated main-branch changes.

## Source of truth

- [Pinned OAuth Provider schema v1.7.18](https://github.com/better-auth/better-auth/blob/v1.7.18/packages/oauth-provider/src/schema.ts)
- [Pinned JWT/JWKS schema v1.7.18](https://github.com/better-auth/better-auth/blob/v1.7.18/packages/better-auth/src/plugins/jwt/schema.ts)
- [Pinned core user/session/account/verification models](https://github.com/better-auth/better-auth/tree/v1.7.18/packages/core/src/db/schema)
- [PostgreSQL schemaName behavior](https://better-auth.com/docs/adapters/postgresql)

**This document is an inventory for approval; it is not a migration plan authorization.**
