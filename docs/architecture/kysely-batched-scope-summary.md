# Kysely search summary: batched Scope membership

The PostgreSQL `search_summary` view previously performed one `api.manage` SELECT for each requested Scope, followed by one Scope status SELECT. This made the membership portion cost **N database round trips** for N scopes.

`searchSummary` now obtains all active `manage_role='scope'` IDs through **one native Kysely `where('id','in',requested)` query**, then reads only permitted Scope status documents. For N non-empty, allowed scopes, this reduces query count from approximately `2N` to `1+N`; empty requests issue no queries. Scope validation, existing status fields, alphabetical result ordering, and public membership restrictions remain unchanged.

Scope-specific status tables cannot be combined into one portable SQL SELECT without introducing dialect-dependent dynamic unions. These queries therefore remain sequential to prevent burst fan-out. No additional RPC, index, permission change, or cache layer is added.

Regression: `scripts/test-kysely-batched-scope-summary.mjs` (included in `npm run test:bootstrap`). The regression uses a mock Kysely builder and validates batching, order, deduplication, unknown scopes and invalid inputs. Runtime PostgreSQL query timings and full `test:bootstrap` still require an executable project environment.

## Shared keyword Classes

The PostgreSQL `shared_classes` query previously calculated an SHA-256 public alias in a separate SQL round trip for **every visible shared Class**, after loading the list. The existing Kysely Anchor SELECT now conditionally adds an `sql` expression using `sql.ref('uid')` for anonymous/public callers. This preserves the `sha256(scope + ':' + uid)` alias value, and uses Kysely `where('uid','in', sharedIds)` to filter publicly shared Classes in SQL rather than loading private Classes into the application result. The existing post-query public-sharing check remains as a defense in depth, while per-Class hash queries are eliminated.

For C shared Classes, the Class-related SQL round trips fall from approximately `1+C` to `1`; owner queries still return the original UID without computing hashes. This optimization does not alter the approved permission rules or leak private Classes. The same regression suite checks public and owner projections.
