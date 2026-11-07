# LOC ZenStack V3 ZModel virtual contract — 2026-11-07

## What is modeled

The frozen `zenstack/schema.zmodel` continues to map exactly **17 existing physical models** in `silver` and `api`, backed by `zenstack/schema-contract.json`. The current snapshot has **271 columns**. The SchemaDef runtime bridge `zenstack/schema.mjs` stays aligned with those models; it is *not* generated with ZenStack CLI and does not migrate a database.

Three `type` declarations describe **nonphysical** LOC contracts:

| ZModel type | Fields | Scope |
|---|---|---|
| `LocPrincipal @@auth` | `id, role, roleLevel, scopeIds, groupIds` | Verified LOC Auth principal, never a user/group table |
| `LocFederatedRef` | `databaseId, scopeId, uid` | Cross-database identity, without changing physical UID |
| `LocAnchorLink` | `family, fromUid, toUid, fromType, toType, attrKey, resolved` | Virtual Anchor relationship, not a database FK |

These `type` declarations **do not create tables or relations**, add physical columns, authorize SQL writes, enable synchronization, or index content. They are mirrored into the runtime `schema.typeDefs` and tested for exact field parity. The original admin `@@allow` rules are now on individual, valid ZModel attribute lines, matching the unchanged SchemaDef and existing scope of authority.

## Using virtual relationships

- `indexZModelAnchorHierarchy(rows, {family,strict})` accepts **one already-permitted database+Scope partition**. Existing `keyword`, `source`, `time` and `space` families are modeled with their stored `Anchor.attr` UID links. No SQL JOIN, article scan, or permission lookup is added.
- `indexZModelAnchorHierarchy(...).links()` yields `LocAnchorLink` records, including `resolved=false` for a missing linked node in a bounded read. Do not interpret an incomplete graph as an empty subtree.
- `qualifyLocAnchorLinks(links,{databaseId,scopeId})` yields source and target **global references** by applying the existing `locGlobalUid` mapping. Two databases may legitimately have the same ScopeID and eight-character UID; their global keys remain distinct.
- Store the *source database identifier* alongside any third-party search index reference; the database ID is a stable non-secret name and **not** a connection string or bearer token.
- **Never combine raw local UIDs from different databases in the same tree map before qualification.** Never infer cross-database FK relationships solely because local UIDs match.

The field `Anchor.attr` stays `Json @db.JsonB`. Different Anchor types have different allowed attributes, so it is intentionally **not** replaced with a single restrictive `@json` type that might drop or reject existing data. Source/Keyword reference UIDs are still interpreted by their dedicated validated hierarchy projection.

## Active ZModel consumers (2026-11-08)

These are **runtime call paths**, not additional ZModel schemas or examples:

- **Time / Era → Period:** `app/loc/views/CulturePublicReader.jsx` calls `indexZModelAnchorHierarchy(...,{family:'time'})` over the Culture Anchors already loaded for that Scope. Canonical eight-character `attr.period` references use `childrenOf(era.uid)`; imported legacy short UIDs retain the existing rendering path. Period date windows, gaps, and article visibility are unchanged.
- **Space / Trace → Path:** `app/loc/TraceRouteManager.jsx` builds a memoized partial `family:'space'` graph from the already-loaded, owner-Scope route index. The active map's Path membership uses `childrenOf(trace.uid)`. Point nodes are fetched only by the existing lazy map-reader; a partially loaded graph is never treated as permission to fetch missing Points. Four-character legacy routes retain the old reader.
- **Source / Domain → From:** `app/loc/providers/kysely-management.mjs` uses `family:'source'` for the authorized `read_source_catalog` relation projection. The actual Anchor rows here contain Domain/From; the Universe/Galaxy presentation parents are not fabricated as physical Base62 UIDs. The original Scope permission gate and queries remain unchanged.
- **Keyword / Category → Class → Group → Item:** `app/loc/keyword-tree.mjs` already calls the shared `family:'keyword'` graph for canonical eight-character Anchors. Active consumers include keyword-library and analysis paths. Legacy four-character inputs retain the existing format-specific path.
- **Native SQL Query:** `zenstack/native-query.mjs` is separately wired into the SQL Gateway for a limited, representable set of already-authorized PostgreSQL SELECTs; unsupported operators and cross-dialect requests stay on Kysely. This is independent of the in-memory Anchor graph.

The graph integrations above add **zero SQL round trips**. They replace duplicated relationship resolution, but do not, on their own, prove a database latency improvement. The native ORM paths must be assessed from their compiled SQL and actual call counts, not merely from the fact that a ZModel exists.

The focused Node tests run on this PR branch passed **55/55**, including Culture Era rendering, Trace and Source graph consumers, original Keyword tree behavior, real ZenStack 3.10.1 ORM/PolicyPlugin SQL compilation, and Kysely 0.29.8 integration. The Culture and Trace JSX files also passed Babel parsing. These tests use a simulated SQL driver; no live database, published deployment, or end-to-end browser flow is claimed verified.

## Explicit system boundaries

- **LOC Auth:** signed grants, trust and permissions. ZModel types do not issue grants.
- **SQL Gateway + Kysely:** query routing, PostgreSQL/MySQL/SQL Server dialects, bounded queries, SQL operations and cross-source result merging. ZModel V3's PostgreSQL datasource declaration does not magically provide SQL Server portability.
- **ZenStack PolicyPlugin:** existing four public fixed control-model reads and two global-admin fixed registry writes. Dynamic Scope Galaxy/Anchor still use already-verified Kysely/Gateway permissions. Raw Kysely `$qb` is not automatically policy enforced.
- **FlexSearch / KV indexing:** a separate Agent owns implementation and deciding which virtual projection fields to consume; this PR does not touch it.
- **Database freeze:** no DDL, migration, RLS/Policy/GRANT edits, schema introspection or automatic table creation.

## Focused verification

New `scripts/test-zmodel-virtual-contract.mjs` checks typed `.zmodel`/SchemaDef parity, unchanged physical models and policy boundary, native four-family link projections, bounded unread references, federated identity collisions and invalid references. Existing hierarchy and UID regression tests remain unchanged.

Suggested Node command when an npm runtime is available:

```bash
node --test scripts/test-zmodel-virtual-contract.mjs scripts/test-zmodel-anchor-hierarchy.mjs scripts/test-zmodel-global-identity.mjs scripts/test-keyword-tree.mjs
```

At commit preparation, **25 targeted test callbacks passed** in an isolated V8 source-evaluation harness. That verifies function logic but is **not** an executed Node module import, the official ZenStack CLI parser, a real PolicyPlugin call, a production DB test or a deployed-site measurement. Do not claim those as passed without execution evidence.

## Future integration points (assigned elsewhere)

Use qualified refs for FlexSearch/KV records; preserve database-scoped row reads and signed authorization at the Gateway. The other Agent handles FlexSearch+ZenStack integration. Avoid adding a second competing search implementation or overriding its work.
