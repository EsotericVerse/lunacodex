# LOC ZenStack V3 — Native Scoped ORM (2026-11-07)

## What this integrates

LOC's existing **fixed** ZModel has two Scope model exemplars (lo3rwang and lrunes) for each of `Galaxy`, `Anchor`, `Blocks`. They already have the same physical columns. The server can now derive an **in-memory** `SchemaDef` for any authorized Scope, with the correct physical `<scope>_galaxy`, `<scope>_anchor`, and `<scope>_blocks` mappings and existing SQL namespace.

- `zenstack/scoped-schema.mjs` exports `scopedZModelSchema({scopeId,namespace})` and `scopedZModelColumns(...)`; both reuse the frozen `schema.mjs` definitions and reject malformed Scope/namespace identifiers. The lo3rwang and lrunes exemplars are checked for native type, nullability, IDs, defaults and existing keys before they are reused.
- `zenstack/client.mjs` exports `createScopedLocClient({scopeId,namespace,dialect})`: real ZenStack V3 `ZenStackClient` with the **existing injected trusted Kysely PostgreSQL dialect** and three Scope models, not a second database driver/pool. The client exposes native `galaxy/anchor/blocks` ORM accessors supporting `findMany`, `findUnique`, `count`, `groupBy`, etc. The application is not required to use every operation.
- `app/loc/providers/kysely-schema.mjs` now **actually uses** the generated Scope model contract for current portable Galaxy and Anchor connection schema validation. It remains a read-only metadata check and works across SQL engines without assuming ZenStack can execute SQL Server statements.
- `scripts/test-zenstack-scoped-orm.mjs` verifies the metadata, model isolation, existing portable validation and native ORM query compilation against Kysely's no-I/O `DummyDriver`. It does not issue live SQL.

## Usage and trust boundary

This is a **server-side, trusted-only** model factory. The client is raw ZenStack ORM, not a new public API or a substitute for LOC Auth. Never pass the client or its `$qb` escape hatch to a browser, external caller, or an unverified SQL Gateway request.

For example, after the Gateway has verified the LOC Auth delegation, determined database alias and Scope, and authorized the exact read:

```js
const scoped = createScopedLocClient({
  scopeId: verifiedScopeId,
  namespace: 'silver',
  dialect: alreadyTrustedKyselyDialect
});
const articles = await scoped.galaxy.findMany({
  where: { uid: { in: approvedArticleUids } },
  select: { uid: true, title: true, date: true },
  take: 20
});
```

The above is an *internal example*, not a new endpoint or a claim that all external query fields have been verified. No third-party/full-text index is created by this code.

### Important ZenStack V3 distinctions

- **Native ORM methods** can enforce ZModel access policies **when the PolicyPlugin is installed** on a schema with applicable `@@allow / @@deny` declarations.
- **`$qb` and raw SQL bypass the policy plugin**, even when `dangerouslyAllowRawSql` is explicitly enabled. Do not describe a `$qb` query as policy-enforced. Existing Gateway authorization and DB access controls remain applicable.
- Dynamic Galaxy/Anchor/Blocks models deliberately have **no blanket `@@allow`**: public visibility varies by page/operation, and private ownership depends on verified LOC grants. Inventing a universal `read: true` or role-level permission would be incorrect. A future independently verified, operation-specific PolicyPlugin adapter can be connected after ongoing LOC Auth/Gateway work merges.
- Native ZenStack V3 dialects currently cover PostgreSQL/MySQL/SQLite, while SQL Server is still on the LOC Kysely path. This fixed-schema derived factory is **PostgreSQL only** because the physical contract contains PostgreSQL-specific arrays and JSONB. MySQL needs a separately validated type mapping before native ZenStack calls are enabled. Querying MySQL/SQL Server via existing Kysely remains unchanged.
- The original **nullable PostgreSQL array** limitations remain: use selected ORM fields or the existing lossless Kysely path where array-null semantics matter. Do not overwrite existing schema or silently convert arrays to JSONB.

## Current verification and ownership

At implementation time, **27 V8 metadata/factory/portable validation checks passed**. This includes generating three Scope models across three independent Scope names and validating the live portable schema checker. Unlike full integration testing, this does **not** execute the installed `@zenstackhq/orm` runtime.

The focused real Node compilation test in the repository can be invoked as:

```bash
node --test scripts/test-zenstack-scoped-orm.mjs
```

**Do not mark real ZenStack or deployed database tests passed unless a corresponding run is observed.** The SQL Gateway's ongoing Auth branch and the independent FlexSearch/KV integration own their own execution paths. This PR touches neither of them, no database DDL/RLS/migration, and no storefront/search UI.

Next step after LOC Auth/Gateway has settled: opt in a narrow authorized native-ORM query path, measure latency against the existing Kysely path, and only replace production query code when behavior (including permissions and pagination) is equivalent. No assumption that using more ORM methods alone yields faster SQL.
