# LOC ZModel × Zod × Kysely × React: import-only integration

## Scope
- The existing frozen ZenStack V3 SchemaDef and physical SQL metadata remain the single column contract; no table, migration, index, RLS, grant, or auth changes.
- The official `@zenstackhq/zod@3.10.1` derives runtime Zod validators from the existing SchemaDef. Schema instances are created once per model, on the first insert import.
- `zenstack/model-column-guard.mjs` is the shared physical-to-virtual model resolver, reused by both Kysely field checks and import-time validation. Custom Scope Galaxy tables reuse the existing Galaxy model exemplar.
- The model-driven validator handles `DateTime`, strings, booleans, and supported arrays. The frozen physical column metadata corrects ZenStack V3 representation gaps for `DATE` and nullable PostgreSQL array fields. It does not override or rewrite source metadata.
- `insertImportRows` lazily loads the validator and checks a normalized Galaxy INSERT batch **before** the existing managed-write transaction. Kysely remains the database operator, including UID conflict retries and original batching. Import UPDATE paths are deliberately unchanged.
- Existing ZIP/JSON/Markdown source-specific parsing, source-site selection, duplicate matching, media/anchor reconciliation, LOC Auth and permission checks are not replaced by model validation. Native primary-key constraints remain authoritative for UID shape and collisions.
- The import UI now uses a per-mount React `useSyncExternalStore` snapshot for **existing progress updates** instead of a React `useState` progress object. The store itself has no network operations, data cache or timers; the already-present UI ETA tick is unchanged.
- The dependency is pinned to the already resolved `@zenstackhq/zod@3.10.1` in `package-lock.json`. Nothing upgrades ZenStack/Kysely/React or reintroduces TanStack Query or SWR.

## Verification
Run `node --test scripts/test-zmodel-import-validation.mjs` and the existing import/SchemaDef checks, then build. No live SQL call is introduced by importing the schema module. Test results must be recorded only after an actual run.
