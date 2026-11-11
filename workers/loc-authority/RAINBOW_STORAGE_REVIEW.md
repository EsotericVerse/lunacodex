# Rainbow Auth storage: schema and grants review (NO DDL)

**Status: REVIEW ONLY; no database object or permission has been created.**
This inventory is based on the pinned **better-auth 1.7.18** and **@better-auth/oauth-provider 1.7.18** vendor schemas, not on the temporary Supabase `loc_auth` test table. The model names below are those mapped by `workers/loc-authority/auth.mjs`. The intended namespace is **`silver` only if separately approved**; the runtime refuses to select a namespace until `LOC_AUTH_SCHEMA` is provided.

## Construction status: four core models plus eight extension models

The earlier four-table description covers Better Auth's **core** identity models only:
`user`, `session`, `account`, `verification`. The current code also declares
**eight additional** JWT/JWKS and OAuth Provider plugin models. Twelve entries
are therefore an **in-progress vendor-model inventory**, not evidence of
12 deployed tables, successful persistence, completed migration, or completed
MCP SSO integration. Do not truncate the plugin models back to four, and do
not create any of them until the full approved vendor DDL has been reviewed.

These models may reference one another by subject, session, resource, client,
and consent identifiers; such references must remain intact. Separately,
LOC Web business rights (`api.manage`) can be referenced when a **website
business operation** requires them, but they are not the Auth storage or the
sole authorizer of Auth-owned or Gateway control-plane writes.

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

## Per-model SQL access decision matrix (proposal, NOT applied)

The Better Auth adapter uses an **Auth service PostgreSQL role**, not a PostgreSQL
role impersonating each OAuth end user. For this single-purpose Auth namespace,
the initial recommendation is **no table RLS**; use explicit schema `USAGE`
and table-level `GRANT` only for the dedicated service role, with no
`PUBLIC`, `anon`, LOC Web or direct MCP SQL grants. An enabled RLS table
without a matching runtime policy can deny normal login/session writes, and
an end-user-email policy cannot work when every request shares one service
database identity. **This is a permission design recommendation, not approval
to disable RLS on any existing database object.**

The table-specific operation review below scopes which actions the Auth
runtime legitimately needs; it does **not** authorize granting these actions
yet. Better Auth's exact 1.7.18 generated SQL and observed usage on an
isolated PostgreSQL instance determine the final minimum grants.

| Rainbow table | SELECT | INSERT | UPDATE | DELETE | Why the Auth runtime may need it |
| --- | --- | --- | --- | --- | --- |
| `rainbow_auth` | Yes | Yes | Yes | Yes | Identity lookup, profile and verification changes, account deletion |
| `rainbow_session` | Yes | Yes | Yes | Yes | Session issue, expiry refresh, revocation, cleanup |
| `rainbow_account` | Yes | Yes | Yes | Yes | OAuth account creation, token refresh and account unlinking |
| `rainbow_verification` | Yes | Yes | Yes* | Yes | One-time challenges and expiry cleanup; UPDATE only if vendor flow requires |
| `rainbow_jwks` | Yes | Yes | Yes* | Yes | Key rotation and grace-period cleanup; UPDATE only if vendor flow requires |
| `rainbow_oauth_client` | Yes | Yes | Yes | Yes | Privileged client creation, key change, disable and removal |
| `rainbow_oauth_resource` | Yes | Yes | Yes | Yes | Auth-owned resource registration and lifecycle |
| `rainbow_oauth_client_resource` | Yes | Yes | Yes* | Yes | Resource association changes; UPDATE only if vendor flow requires |
| `rainbow_oauth_refresh_token` | Yes | Yes | Yes | Yes | Refresh rotation, revoke, expiry cleanup |
| `rainbow_oauth_access_token` | Yes | Yes | Yes | Yes | Token persistence/revocation and cleanup where used |
| `rainbow_oauth_consent` | Yes | Yes | Yes | Yes | Grant/revoke user delegation |
| `rainbow_oauth_client_assertion` | Yes | Yes | No* | Yes | One-time replay guard insert, lookup, expired assertion cleanup |

*Provisional operations. Narrow them after observing the pinned module's
actual SQL. Avoid prematurely revoking a vendor-required UPDATE or DELETE.
These are **service-only** privileges, never grants to browser, OAuth clients,
or MCP agents.

### Mandatory privilege and RLS acceptance checks (isolated PostgreSQL first)

1. Confirm the chosen Neon Auth **database and schema**, object ownership,
   existing table RLS flags and whether any policies already exist. Do not
   assume `silver` has been approved or infer that 12 models mean 12 physical
   tables exist.
2. Generate exact migrations and FK/unique/index definitions from the pinned
   vendor package in the isolated environment. Do not generate production DDL
   from this review's field inventory.
3. In isolation, use a DDL owner only for the approved creation/migration, and
   a **different** non-owner runtime role for Better Auth. Confirm `USAGE` on
   the schema and the minimum table permissions. Explicitly verify that
   `PUBLIC`, browser, website and direct MCP SQL roles lack table privileges.
   Check sequence grants if generated DDL requires sequences.
4. Check `pg_class.relrowsecurity`, `relforcerowsecurity`,
   `pg_policies`, role ownership and effective grants for **each** Rainbow
   table. Do not automatically add `ENABLE ROW LEVEL SECURITY`,
   `DISABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`,
   `BYPASSRLS`, or permissive `USING (true)` policies.
5. With the restricted runtime role on isolated PostgreSQL, test a minimal
   Better Auth user/account/session create → read → update → revoke/delete;
   then OAuth code/consent/token, JWKS creation and rotation, and assertion
   replay prevention. Test denied direct SQL access from a non-Auth role.
   Distinguish DB authorization errors from absent tables, column drift,
   transport failure, and OAuth handler bugs.
6. Only after schema approval and isolation tests, plan a **single controlled**
   Neon Auth release and functional acceptance. No repeated live probes,
   stress testing, surprise migrations, automatic RLS changes, or cache-based
   acceptance.

Auth-owned control-plane writes must not depend on `api.manage`. LOC Web
business writes may independently require website grants **in addition to**
a valid LOC Auth OAuth scope. References between systems remain possible and
verified; the identity and storage authorities stay separate.

## Security and verification gates

1. Validate exact pinned-vendor DDL, approved column types, indexes and one-table-at-a-time RLS/CRUD permissions.
2. Validate normal Auth login and `emailVerified`, session creation/refresh/revocation and 30-minute signed Cookie Cache. Privileged LOC Web mutations bypass the Cookie Cache.
3. Validate OIDC Discovery, authorization code with PKCE S256, consent, token issuance, UserInfo, JWKS rotation and Refresh Token rotation.
4. Verify the first-party Galaxy-Link's published CIMD Client ID, HTTPS metadata, redirect URI and `loc:import` scope. Open unauthenticated RFC 7591 registration is disabled.
5. Verify **MCP writes to LOC Web business data** require the applicable OAuth scope and current website business authorization (including `api.manage` where relevant). **Auth-owned and Gateway control-plane writes** are governed by LOC Auth itself and must not fail merely because a website `api.manage` row is absent. Distinct storage and authorizers may still exchange verified references.
6. Verify QoS / concurrency / platform-failover behavior separately. Per-isolate counters are not cross-isolate abuse control; manual immediate blacklist and stateless JWT revocation still require a reviewed shared design.
7. The PR is **not deployable** until all gates and a real Auth DB integration test pass. CI and merge conflicts must also be resolved without overwriting unrelated main-branch changes.

## Source of truth

- [Pinned OAuth Provider schema v1.7.18](https://github.com/better-auth/better-auth/blob/v1.7.18/packages/oauth-provider/src/schema.ts)
- [Pinned JWT/JWKS schema v1.7.18](https://github.com/better-auth/better-auth/blob/v1.7.18/packages/better-auth/src/plugins/jwt/schema.ts)
- [Pinned core user/session/account/verification models](https://github.com/better-auth/better-auth/tree/v1.7.18/packages/core/src/db/schema)
- [PostgreSQL schemaName behavior](https://better-auth.com/docs/adapters/postgresql)

**This document is an inventory for approval; it is not a migration plan authorization.**
