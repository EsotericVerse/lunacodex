---
name: kysely-portable-loc
description: Use for LOC SQL dialect, query, schema, transaction, migration, and authorization changes. Read Kysely's current official agent docs before changing PostgreSQL-specific code or creating RPCs.
---

# LOC — Kysely official-documentation workflow

Primary upstream source: https://kysely.dev/llms.txt
Full agent-readable documentation: https://kysely.dev/llms-full.txt
Versioned upstream source: https://github.com/kysely-org/kysely
Installed Kysely version: **0.29.8**. Confirm the installed version, official agent docs, and upstream release notes when continuing work.

1. Read the **official current** Kysely docs relevant to the operation (Dialect, Query Builder, Schema Builder, Migrator, transaction, plugins, API). If the docs cannot be fetched, inspect the matching upstream tagged source; do not guess the API.
2. **Prefer native Kysely** `selectFrom`, `insertInto`, `updateTable`, `deleteFrom`, `onConflict`, `mergeInto`, `transaction`, `schema`, and `Migrator`. Use `sql` only where the chosen Dialect cannot express the required feature; isolate those paths and test them per-engine.
3. Kysely's `Dialect` **generates and executes SQL**, but does **not** translate database-specific RLS, JSONB, PostgreSQL `CREATE POLICY`, or SQL Server identity semantics into identical cross-engine security. Driver DB login is independent of native **LOC Auth OAuth + signed SQL delegation**. Do not depend on Clerk, Supabase Auth, or Neon Auth for LOC user identity.
4. `$pickTables`, `$omitTables`, and TypeScript schema narrowing are **compile-time type constraints**, not a runtime ACL. `withPlugin` custom interceptors are not authorization by themselves. All user-specific read/write access must pass a trusted runtime gate; cross-engine parity includes blackout/hidden article and private keyword visibility, not only Scope ownership.
5. Distinguish *SQL dialect portability* from *same-schema deployability*: Kysely can build migrations and inspect schemas, but each engine needs its actual tables/types/constraints. The user's long-term goal is a minimal two-table installation with credentials; do not claim that the current multi-table LOC already fulfills it.
6. Preserve LOC's Base62 case-sensitive UID, eight Galaxy boolean permissions, unified `{scopeid}_anchor` structure, and native LOC Auth issuer, audience, and Scope-delegation contracts. Never reintroduce the retired four tables or create new tables/indexes/RPCs without authorization.
7. Every upgrade must align `package.json`, `package-lock.json`, and all Deno `npm:kysely@...` imports, pass `npm run check:syntax`, and run targeted + live Dialect/authorization regression tests before merge/deploy.

Release notes:
- https://github.com/kysely-org/kysely/releases/tag/v0.29.7 — controlled transaction races/leaks and MSSQL JSON fixes.
- https://github.com/kysely-org/kysely/releases/tag/v0.29.8 — PostgreSQL aborted-transaction rollback/commit safety.
- `0.30.0-beta` is prerelease; do not adopt automatically.
