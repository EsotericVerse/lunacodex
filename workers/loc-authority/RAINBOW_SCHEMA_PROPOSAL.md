# LOC Auth Rainbow — PostgreSQL schema proposal (review only)

**Status: proposed; ZERO DDL or GRANT execution authorized.** This is a column-by-column review sheet for PR #1374, derived from Better Auth / OAuth Provider **v1.7.18** code, not from any existing `loc_auth` table. `loc_auth` must never be used for the LOC Auth system. Every actual Auth table is `rainbow_*`. Schema namespace is a separate approval decision. No production Neon reads, creation, or migrations are part of this document.

## Type convention for the proposed PostgreSQL physical schema

- Core ID: `id TEXT PRIMARY KEY` (provided by the Better Auth adapter even when the logical schema omits `id`).
- Vendor `string` → proposed `TEXT`; `boolean` → `BOOLEAN`; `date` → `TIMESTAMPTZ`; `json` → `JSONB`; `string[]` → `JSONB` (the pinned Better Auth Kysely migration checks array fields as JSON, **not** native PostgreSQL `TEXT[]`); `number` → proposed `INTEGER` except `*Ttl`/policy fields, subject to vendor-generated DDL confirmation.
- Logical column names are shown in exact vendor camelCase; use **quoted** PostgreSQL identifiers unless vendor generation changes the configured mapping. Required = vendor `required: true`, optional = `required: false`, unspecified means the vendor does not explicitly mark it. All defaults, on-update behavior, FK actions and indices must be verified against *generated* DDL before executing. No schema has been approved.

## 1. `rainbow_auth` — user

| Column | Proposed PG type | Vendor required | Reference / index |
|---|---|---|---|
| `id` | `TEXT` | primary key | PK (adapter-generated) |
| `name` | `TEXT` | true | — |
| `email` | `TEXT` | true | UNIQUE |
| `emailVerified` | `BOOLEAN` | true | — |
| `image` | `TEXT` | false | — |
| `createdAt` | `TIMESTAMPTZ` | true | — |
| `updatedAt` | `TIMESTAMPTZ` | true | — |

## 2. `rainbow_session` — session

| Column | Proposed PG type | Vendor required | Reference / index |
|---|---|---|---|
| `id` | `TEXT` | primary key | PK (adapter-generated) |
| `expiresAt` | `TIMESTAMPTZ` | true | — |
| `token` | `TEXT` | true | UNIQUE |
| `createdAt` | `TIMESTAMPTZ` | true | — |
| `updatedAt` | `TIMESTAMPTZ` | true | — |
| `ipAddress` | `TEXT` | false | — |
| `userAgent` | `TEXT` | false | — |
| `userId` | `TEXT` | true | FK → rainbow_auth; INDEX |

## 3. `rainbow_account` — account

| Column | Proposed PG type | Vendor required | Reference / index |
|---|---|---|---|
| `id` | `TEXT` | primary key | PK (adapter-generated) |
| `accountId` | `TEXT` | true | — |
| `providerId` | `TEXT` | true | — |
| `userId` | `TEXT` | true | FK → rainbow_auth; INDEX |
| `accessToken` | `TEXT` | false | — |
| `refreshToken` | `TEXT` | false | — |
| `idToken` | `TEXT` | false | — |
| `accessTokenExpiresAt` | `TIMESTAMPTZ` | false | — |
| `refreshTokenExpiresAt` | `TIMESTAMPTZ` | false | — |
| `scope` | `TEXT` | false | — |
| `password` | `TEXT` | false | — |
| `createdAt` | `TIMESTAMPTZ` | true | — |
| `updatedAt` | `TIMESTAMPTZ` | true | — |

## 4. `rainbow_verification` — verification

| Column | Proposed PG type | Vendor required | Reference / index |
|---|---|---|---|
| `id` | `TEXT` | primary key | PK (adapter-generated) |
| `identifier` | `TEXT` | true | INDEX |
| `value` | `TEXT` | true | — |
| `expiresAt` | `TIMESTAMPTZ` | true | — |
| `createdAt` | `TIMESTAMPTZ` | true | — |
| `updatedAt` | `TIMESTAMPTZ` | true | — |

## 5. `rainbow_jwks` — jwks

| Column | Proposed PG type | Vendor required | Reference / index |
|---|---|---|---|
| `id` | `TEXT` | primary key | PK (adapter-generated) |
| `publicKey` | `TEXT` | true | — |
| `privateKey` | `TEXT` | true | — |
| `createdAt` | `TIMESTAMPTZ` | true | — |
| `expiresAt` | `TIMESTAMPTZ` | false | — |
| `alg` | `TEXT` | false | — |
| `crv` | `TEXT` | false | — |

## 6. `rainbow_oauth_client` — oauthClient

| Column | Proposed PG type | Vendor required | Reference / index |
|---|---|---|---|
| `id` | `TEXT` | primary key | PK (adapter-generated) |
| `clientId` | `TEXT` | true | UNIQUE |
| `clientSecret` | `TEXT` | false | — |
| `clientDiscoveryId` | `TEXT` | false | — |
| `disabled` | `BOOLEAN` | false | — |
| `skipConsent` | `BOOLEAN` | false | — |
| `enableEndSession` | `BOOLEAN` | false | — |
| `subjectType` | `TEXT` | false | — |
| `scopes` | `JSONB` | false | — |
| `clientCredentialsScopes` | `JSONB` | false | — |
| `userId` | `TEXT` | false | FK → rainbow_auth; INDEX |
| `createdAt` | `TIMESTAMPTZ` | false | — |
| `updatedAt` | `TIMESTAMPTZ` | false | — |
| `name` | `TEXT` | false | — |
| `uri` | `TEXT` | false | — |
| `icon` | `TEXT` | false | — |
| `contacts` | `JSONB` | false | — |
| `tos` | `TEXT` | false | — |
| `policy` | `TEXT` | false | — |
| `softwareId` | `TEXT` | false | — |
| `softwareVersion` | `TEXT` | false | — |
| `softwareStatement` | `TEXT` | false | — |
| `redirectUris` | `JSONB` | true | — |
| `postLogoutRedirectUris` | `JSONB` | false | — |
| `backchannelLogoutUri` | `TEXT` | false | — |
| `backchannelLogoutSessionRequired` | `BOOLEAN` | false | — |
| `tokenEndpointAuthMethod` | `TEXT` | false | — |
| `applicationType` | `TEXT` | false | — |
| `jwks` | `TEXT` | false | — |
| `jwksUri` | `TEXT` | false | — |
| `grantTypes` | `JSONB` | false | — |
| `responseTypes` | `JSONB` | false | — |
| `requirePKCE` | `BOOLEAN` | false | — |
| `dpopBoundAccessTokens` | `BOOLEAN` | false | — |
| `referenceId` | `TEXT` | false | — |
| `metadata` | `JSONB` | false | — |

## 7. `rainbow_oauth_resource` — oauthResource

| Column | Proposed PG type | Vendor required | Reference / index |
|---|---|---|---|
| `id` | `TEXT` | primary key | PK (adapter-generated) |
| `identifier` | `TEXT` | true | UNIQUE |
| `name` | `TEXT` | true | — |
| `accessTokenTtl` | `INTEGER` | false | — |
| `refreshTokenTtl` | `INTEGER` | false | — |
| `signingAlgorithm` | `TEXT` | false | — |
| `signingKeyId` | `TEXT` | false | — |
| `allowedScopes` | `JSONB` | false | — |
| `customClaims` | `JSONB` | false | — |
| `dpopBoundAccessTokensRequired` | `BOOLEAN` | false | — |
| `disabled` | `BOOLEAN` | false | — |
| `createdAt` | `TIMESTAMPTZ` | false | — |
| `updatedAt` | `TIMESTAMPTZ` | false | — |
| `policyVersion` | `INTEGER` | false | — |
| `metadata` | `JSONB` | false | — |

## 8. `rainbow_oauth_client_resource` — oauthClientResource

| Column | Proposed PG type | Vendor required | Reference / index |
|---|---|---|---|
| `id` | `TEXT` | primary key | PK (adapter-generated) |
| `clientId` | `TEXT` | true | FK → rainbow_oauth_client; INDEX |
| `resourceId` | `TEXT` | true | FK → rainbow_oauth_resource; INDEX |
| `metadata` | `JSONB` | false | — |
| `createdAt` | `TIMESTAMPTZ` | false | — |

## 9. `rainbow_oauth_refresh_token` — oauthRefreshToken

| Column | Proposed PG type | Vendor required | Reference / index |
|---|---|---|---|
| `id` | `TEXT` | primary key | PK (adapter-generated) |
| `token` | `TEXT` | true | UNIQUE |
| `clientId` | `TEXT` | true | FK → rainbow_oauth_client; INDEX |
| `sessionId` | `TEXT` | false | FK → rainbow_session; INDEX |
| `userId` | `TEXT` | true | FK → rainbow_auth; INDEX |
| `referenceId` | `TEXT` | false | — |
| `authorizationCodeId` | `TEXT` | false | INDEX |
| `resources` | `JSONB` | false | — |
| `requestedUserInfoClaims` | `JSONB` | false | — |
| `expiresAt` | `TIMESTAMPTZ` | unspecified | — |
| `createdAt` | `TIMESTAMPTZ` | unspecified | — |
| `revoked` | `TIMESTAMPTZ` | false | — |
| `rotatedAt` | `TIMESTAMPTZ` | false | — |
| `rotationReplayResponse` | `TEXT` | false | — |
| `rotationReplayExpiresAt` | `TIMESTAMPTZ` | false | — |
| `authTime` | `TIMESTAMPTZ` | false | — |
| `confirmation` | `JSONB` | false | — |
| `scopes` | `JSONB` | true | — |

## 10. `rainbow_oauth_access_token` — oauthAccessToken

| Column | Proposed PG type | Vendor required | Reference / index |
|---|---|---|---|
| `id` | `TEXT` | primary key | PK (adapter-generated) |
| `token` | `TEXT` | unspecified | UNIQUE |
| `clientId` | `TEXT` | true | FK → rainbow_oauth_client; INDEX |
| `sessionId` | `TEXT` | false | FK → rainbow_session; INDEX |
| `userId` | `TEXT` | false | FK → rainbow_auth; INDEX |
| `referenceId` | `TEXT` | false | — |
| `authorizationCodeId` | `TEXT` | false | INDEX |
| `resources` | `JSONB` | false | — |
| `requestedUserInfoClaims` | `JSONB` | false | — |
| `refreshId` | `TEXT` | false | FK → rainbow_oauth_refresh_token; INDEX |
| `expiresAt` | `TIMESTAMPTZ` | unspecified | — |
| `createdAt` | `TIMESTAMPTZ` | unspecified | — |
| `revoked` | `TIMESTAMPTZ` | false | — |
| `confirmation` | `JSONB` | false | — |
| `scopes` | `JSONB` | true | — |

## 11. `rainbow_oauth_consent` — oauthConsent

| Column | Proposed PG type | Vendor required | Reference / index |
|---|---|---|---|
| `id` | `TEXT` | primary key | PK (adapter-generated) |
| `clientId` | `TEXT` | true | FK → rainbow_oauth_client; INDEX |
| `userId` | `TEXT` | false | FK → rainbow_auth; INDEX |
| `referenceId` | `TEXT` | false | — |
| `resources` | `JSONB` | false | — |
| `requestedUserInfoClaims` | `JSONB` | false | — |
| `scopes` | `JSONB` | true | — |
| `createdAt` | `TIMESTAMPTZ` | unspecified | — |
| `updatedAt` | `TIMESTAMPTZ` | unspecified | — |

## 12. `rainbow_oauth_client_assertion` — oauthClientAssertion

| Column | Proposed PG type | Vendor required | Reference / index |
|---|---|---|---|
| `id` | `TEXT` | primary key | PK (adapter-generated) |
| `expiresAt` | `TIMESTAMPTZ` | true | — |

## Mandatory approval checklist

1. Confirm the independent Neon database/project and PostgreSQL **schema namespace** (not `loc_auth`).
2. Review every field's physical name, type, NULL/NOT NULL and default; check the generated Better Auth v1.7.18 DDL before approving. The table above is a **typed proposal, not the authoritative generated migration**.
3. Review all primary keys, FK delete actions, unique/index constraints, especially `rainbow_oauth_client_resource(clientId, resourceId)` UNIQUE, User Email UNIQUE, Session Token UNIQUE, Client ID UNIQUE, Resource Identifier UNIQUE and Refresh Token UNIQUE.
4. Review sensitive columns: JWT `privateKey`, Google Account tokens, OAuth Client Secret, Session token, Access/Refresh tokens. Keep these accessible only to the LOC Auth runtime; never expose them in public MCP/LOC Web projections.
5. Approve a distinct **runtime role** with bounded CRUD for its own tables and a separate one-time DDL owner. Website `api.manage` is an independent business authorization reference, not an Auth runtime storage gate. MCP Gateway control-plane writes likewise belong to Auth rather than website permissions.
6. After review, run an isolated PostgreSQL migration and INSERT/SELECT/UPDATE/session rotation tests. Then a single controlled production cutover and end-to-end Google OAuth/JWK/MCP verification. **No cache-only acceptance and no repeated live Neon probing.**

### Vendor source snapshots

- `packages/core/src/db/get-tables.ts` — better-auth v1.7.18
- `packages/oauth-provider/src/schema.ts` — better-auth v1.7.18
- `packages/better-auth/src/plugins/jwt/schema.ts` — better-auth v1.7.18
- `packages/better-auth/src/db/get-migration.ts` — better-auth v1.7.18

**Boundary:** LOC Auth and LOC Web may reference one another through verified contracts; neither table ownership nor database authorization is merged.
