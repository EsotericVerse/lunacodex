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
- **ZenStack 3.10.1 observation:** the installed PolicyPlugin rewrites the model-mapped `$qb.updateTable('Manage')` to include the ZModel role predicate (`1 >= 4` for a user, `4 >= 4` for a global admin). This does **not** prove raw SQL or all `$qb` paths are policy protected; the current upstream skill gives a broader warning. LOC Gateway authorization remains mandatory.
- Dynamic Galaxy/Anchor/Blocks models deliberately do **not** declare blanket `@@allow`; only already-authorized Gateway operations may use the scoped ORM. Public-only requests retain their existing Kysely published-visibility predicates.
- Native ZenStack V3 dialects currently cover PostgreSQL/MySQL/SQLite, while SQL Server is still on the LOC Kysely path. This fixed-schema derived factory is **PostgreSQL only** because the physical contract contains PostgreSQL-specific arrays and JSONB. MySQL needs a separately validated type mapping before native ZenStack calls are enabled. Querying MySQL/SQL Server via existing Kysely remains unchanged.
- The original **nullable PostgreSQL array** limitations remain: use selected ORM fields or the existing lossless Kysely path where array-null semantics matter. Do not overwrite existing schema or silently convert arrays to JSONB.

## Current verification and ownership

At implementation time, **27 V8 metadata/factory/portable validation checks passed**. This includes generating three Scope models across three independent Scope names and validating the live portable schema checker. Unlike full integration testing, this does **not** execute the installed `@zenstackhq/orm` runtime.

The focused real Node compilation test in the repository can be invoked as:

```bash
node --test scripts/test-zenstack-scoped-orm.mjs
```

**Do not mark real ZenStack or deployed database tests passed unless a corresponding run is observed.** The SQL Gateway's ongoing Auth branch and the independent FlexSearch/KV integration own their own execution paths. This PR touches neither of them, no database DDL/RLS/migration, and no storefront/search UI.

## Gateway native ORM connection (2026-11-08)

`zenstack/native-query.mjs` translates only the lossless subset of LOC `query/select` envelopes to native `findMany` and optional `count`. Explicit ZModel columns, type-compatible AND filters and bounded order/offset/limit are supported. Other operators, raw text search, unknown fields, coercible values and public-only Scope visibility remain on the established Kysely path. The original HTTP response format and `head`/`single` semantics are preserved.

The Gateway applies LOC Auth/Scope validation, Session/RLS binding and its existing ACL before private native Scope reads. Four fixed control models use the existing PolicyPlugin-wrapped client. Both paths share the same trusted database dialect and connection pool; no schema, policy, RLS, index, RPC or migration is changed.

The `LocFederatedRef` and `LocAnchorLink` ZModel types remain virtual identifiers and relationships, not physical foreign keys or synchronized data.

### Verification and limits

Using ZenStack 3.10.1, its PolicyPlugin and Kysely DummyDriver:

```bash
node --test scripts/test-zenstack-native-query.mjs scripts/test-zenstack-scoped-orm.mjs scripts/test-zenstack-policy-runtime.real.mjs scripts/test-zenstack-policy-runtime.mjs
```

This compiles and asserts real ORM SQL and policy predicates but does not connect to a live SQL database. SQL Gateway HTTP-level behavior, MySQL/SQL Server native ORM, and latency improvements are not claimed to be verified.
