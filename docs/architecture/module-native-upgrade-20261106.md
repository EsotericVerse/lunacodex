# LOC module-native upgrade (2026-11-06)

## Scope

This update keeps the existing LOC architecture and replaces redundant Recharts sizing wrappers with the Recharts 3 native `responsive` prop where compatible. The statistics Treemap keeps its existing `ResponsiveContainer` compatibility path. Kysely, ZenStack client queries, `fflate`, `@streamparser/json`, and existing native MapLibre `setData` behavior remain unchanged because they are already used directly. ZenStack V3 adoption is approved for the fixed LOC Schema; dependency installation and runtime integration are separate from this earlier module upgrade.

The 2026-11-06 version bump included Next.js, Three.js, MapLibre GL JS, React Three Fiber, React Three Drei, a since-retired Cloudflare Next adapter, and Wrangler. The adapter was removed on 2026-11-08; Wrangler remains for independent Workers.

## Verification

- `npm run test:module-native`: checks manifest/lockfile parity, optional ZenStack V3 ORM/schema parity without CLI, and native responsive usage.
- `npm run test:bootstrap`: broad UI, data, and portability regression.
- `npm run test:game`: game regressions.
- `npm run build` and `npm run build:static`: validate Next.js and the GitHub Pages static export. The previous Cloudflare Next build target has been retired.

The npm installation and local tests were run by the project owner; this connector session independently verified the updated lockfile, but does not have the local console logs or a build artifact. Treat individual test outcomes as unverified until logs or CI evidence are available.

## Boundaries

No changes to Clerk, LOC Authority, database policies, `galaxy.media_link`, MCP, or the source-of-truth database schema. Do not automatically infer runtime compatibility from package metadata alone. This is not a claim of total custom-code elimination; further replacement requires proven functional parity and independent performance checks.

## Follow-up: bounded member comparisons

The LOC cross-member statistics view now uses the existing `mapBounded` helper rather than unbounded `Promise.all` when loading the selected Scope datasets. The concurrency ceiling is **three** per comparison request, matching the public Kysely read budget. It does not introduce a new cache, queue, dependency, RPC, or scheduled read. The output order and existing SWR cache keys remain unchanged. `scripts/test-bounded-parallel.mjs` checks both the integration and ordering/maximum lane behavior.

This is a preventative request-fan-out cap, not a claim of measured latency improvement. No authentication, database schema, media-link or Cloudflare deployment setting is changed.

## Public Kysely read queue cancellation

The existing anonymous SQL Gateway read budget remains capped at three concurrent requests. The public transport now forwards the caller's `AbortSignal` to the existing queue. When a queued search/culture read is cancelled, its waiting entry and abort listener are removed immediately; no gateway request is sent and no future slot is reserved for stale work. A running read continues using the existing HTTP AbortSignal handling and the 9-second transport deadline.

No new queue, retry, background job, dependency, or authorization path was added. Authenticated management requests still bypass the anonymous read budget. Regression coverage is included in `npm run test:bootstrap` through the existing read-budget and abort suites. Full Node/bootstrap and browser tests should be run before deployment.

## Portable public-action request preflight

`executeKyselyPublicAction` now checks the existing action allowlist, argument names and Scope ID before invoking Kysely `introspection.getTables()`. Invalid requests no longer touch external SQL metadata, eliminating avoidable round trips and unnecessary schema inspection. The valid action paths, SQL statements, authorization model and return payloads remain unchanged. Regression coverage is in `scripts/test-kysely-public-portable.mjs`.

## Portable MSSQL bulk insert parameter budget

Cross-engine managed `insert` keeps batching by identical column shape and retains a maximum of 50 rows per insert. SQL Server now additionally restricts each batch to `Math.floor(2000 / numberOfColumns)` rows to stay below its 2,100-bound-parameter limit. MySQL and PostgreSQL retain their existing 50-row batch size. The implementation validates the width of each batch shape before starting insert statements; it introduces no new dependency, table, RPC, or migration.

The existing portable authorization/managed-write regression suite is now included in `test:bootstrap`, with additional wide-row MSSQL and MySQL cases. This is a parameter-budget correction rather than a transaction or atomicity change; full Node tests and live dialect checks remain necessary.

## Portable media_link update idempotency

Cross-engine `update_batch` now compares `media_link` arrays by their JSON array value when a MySQL/SQL Server driver returns the stored JSON as a string. Without this, repeated imports with the same links triggered unnecessary SQL `UPDATE` and `UpdateTime` writes merely due to the driver representation. PostgreSQL retains its native array comparison behavior. Other fields (title, content, url) continue using the existing literal comparison, and malformed JSON text is not silently reinterpreted.

The existing `scripts/test-kysely-portable-access.mjs` bootstrap regression tests now cover unchanged and changed media arrays on MSSQL, unchanged arrays on MySQL, and ordinary article text. No schema, RPC, authorization or dependency change is required.

## Portable Galaxy batch updates (consolidated)

For MySQL / SQL Server (and external Kysely targets), `update_batch` now projects only the fields present in the incoming articles rather than loading every article's full `content`, `media_link` and other unused columns. After comparing against existing records, unchanged rows are skipped; identical changed patches are applied through a bounded Kysely `UPDATE ... WHERE uid IN (...)` with at most 50 IDs. Different per-article values still produce separate patches. This complements the previously completed JSON-array comparison and SQL Server insert parameter-budget corrections.

**Example**: 50 titles changing to the same value now require one existing-row SELECT and one UPDATE for the actual batch (instead of 50 UPDATEs). The gateway's identity/Scope authorization and existing `db.transaction().execute()` remain the sole transaction boundary. Within one gateway request, SQL errors propagate and abort that transaction. Separate client requests in a larger import are *not* one global transaction.

The `place_id` field retains its fill-only policy; a native Kysely `CASE` in the UPDATE prevents a concurrent writer from overwriting a place ID that has become nonblank after the initial SELECT. Rejected UID-only rows, unchanged fields and bounded SQL Server write batches have regression coverage in `scripts/test-kysely-portable-access.mjs`, already included in `test:bootstrap`. This is a Portable implementation change; native PostgreSQL `update_batch` is unchanged. Live MySQL/MSSQL stress and full Node build require a runnable project environment.

## Post-upgrade native-module reconciliation

The seven pinned upgrades from PR #1130 remain the installed versions. This pass checked actual consumers rather than adding further dependencies or replacing correct code for its own sake:

- **Next.js 16 / Wrangler:** the live website uses native `output:'export'` for GitHub Pages. The former Cloudflare Next adapter, static-assets cache config, and ISR-only root Worker config have been retired. Wrangler is retained for independently deployed Workers. The static-export script still parks server API routes because those cannot be exported as static files.
- **MapLibre 6:** the Trace map already imports ESM exports from the installed package, calls the documented `setWorkerUrl(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs',import.meta.url))` before map creation and updates GeoJSON with native `setData`. Do not add a second map library, worker loader or custom diff engine.
- **Three.js:** the authored Effekseer WebGL stage continues using native renderer/material/geometry cleanup. React Three Fiber, Drei and React Three Postprocessing were later removed because there is no current application import; the standalone postprocessing package was also retired. This does not remove the existing Three.js rendering code or preclude reinstalling React Three for future work.
- **Recharts 3:** the current Rune charts and the statistics visualizations already use the native chart `responsive` prop, with `ResponsiveContainer` retained only for the Treemap compatibility case.
- **Kysely / SWR:** portable SQL already uses the built-in dialect/query APIs. SWR remains the single browser data cache. One real SWR Infinite mismatch was corrected: a `null` next-page cursor now stops loading just like `undefined`, while page zero may still have a null initial cursor and `0` remains a valid next-page offset. The shared infinite resource reports `hasNextPage=false` for either terminal value, preventing phantom follow-up pages.

`npm run test:module-native` now also includes the existing SWR resource/cache lifecycle suite and its additional null/zero-cursor regressions. These are module-integration checks, not proof of a full browser render or deployed Cloudflare worker test. No changes were made to the paused GitHub Auth branch, Clerk, Authority, MCP, or SQL Schema/RLS. The earlier ZenStack non-installation assumption is superseded by the approved V3 ORM/schema dependency adoption; it does not authorize schema migrations or imply runtime integration is complete.

## 2026-11-10 — Consolidated ZenStack client queries

The former SWR and all of its live React hooks are retired. The single native
TanStack Query engine is owned by `zenstack/client-queries.js`, which serves
LOC's existing authenticated ZenStack/Kysely SQL Gateway requests and shares
one QueryClient across public and management features. The old
`app/loc/use-async-resource.js` now only re-exports the existing stable hook
names; it has no cache logic. Existing read keys, explicit updates and infinite
cursor semantics are maintained through native query APIs.

**No second cache, ISR, polling, duplicate database connection, schema change,
migration, or new model RPC endpoint** is introduced. LOC Auth, delegated
authorizations, fixed-model ZenStack PolicyPlugin, and Kysely SQL Dialect
remain on the established server-side paths.

ZenStack's `@zenstackhq/tanstack-query` model hooks require a matching
ZenStack model RPC endpoint. LOC's custom cross-Scope SQL Gateway is not that
endpoint; creating a separate CRUD API just to adopt the generated hooks would
duplicate existing responsibilities. Therefore this migration reuses TanStack
Query's native hook/query-client behavior inside the ZenStack client module,
not a parallel query provider. Official model hooks can use this same provider
when an authorized compatible model endpoint is genuinely needed.
