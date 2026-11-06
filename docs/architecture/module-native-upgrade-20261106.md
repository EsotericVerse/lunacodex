# LOC module-native upgrade (2026-11-06)

## Scope

This update keeps the existing LOC architecture and replaces redundant Recharts sizing wrappers with the Recharts 3 native `responsive` prop where compatible. The statistics Treemap keeps its existing `ResponsiveContainer` compatibility path. Kysely, SWR, `fflate`, `@streamparser/json`, and existing native MapLibre `setData` behavior remain unchanged because they are already used directly. ZenStack is not installed.

The version bump is bundled once in `package.json` and `package-lock.json` for Next.js, Three.js, MapLibre GL JS, React Three Fiber, React Three Drei, OpenNext Cloudflare, and Wrangler.

## Verification

- `npm run test:module-native`: checks manifest/lockfile parity, ZenStack absence and native responsive usage.
- `npm run test:bootstrap`: broad UI, data, and portability regression.
- `npm run test:game`: game regressions.
- `npm run build` and `npm run build:cloudflare`: validate Next.js / OpenNext compilation and deployment output where the environment supports it.

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
