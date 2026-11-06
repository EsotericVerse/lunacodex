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
