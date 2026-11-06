# LOC fixed-schema / RPC-free execution boundary

This branch is a **code-only** cutover. There is no SQL migration, table/index
change, RLS or GRANT change, or automatic database introspection at runtime.

## Canonical model

- `zenstack/schema.zmodel` describes the **existing** Supabase `silver`
  physical tables. This is a fixed model, not an instruction to deploy a schema.
- `zenstack/schema-contract.json` is a frozen read-only metadata snapshot of
  the 17 physical tables and their 273 existing columns.
- `zenstack/schema.mjs` maps that frozen metadata into the publicly documented
  ZenStack V3 `SchemaDef` runtime shape without installing its CLI or invoking
  Prisma. Do not represent this bridge as an official `zen generate` output.
- `npm run test:module-native` includes
  `scripts/test-fixed-zmodel.mjs` for physical-column parity, primary keys,
  Anchor's extension fields, RPC-free active browser transport and ORM/Kysely
  SQL compilation using a no-I/O dialect. These tests must actually run before
  promotion; a static check alone is not a passed runtime test.

## Correct module ownership

- ZenStack V3 is optional for **fixed PostgreSQL models** only after the
  runtime SQL compilation test succeeds. It must not introduce a second SQL
  connection path or replace the existing Clerk / LOC Authority gate.
- Kysely is authoritative for dynamic Scope names, SQL dialects (PostgreSQL,
  MySQL, SQL Server, SQLite), bounded queries and transactional writes. The
  existing `loc-kysely` gateway already provides `query`, `analytics`,
  `anchor`, `public-action`, `managed-write` and `managed-action`.
- Five SQL-nullable arrays are intentionally kept on Kysely until a lossless
  representation is verified; ZModel V3 cannot express `String[]?`.
- Postgres RLS remains a database boundary; ZenStack `$qb` and raw SQL do
  **not** enforce ZenStack policy plugin rules.
- New product features reuse `*_anchor.attr`; no physical Schema changes.

## RPC retirement criteria

Treat **business RPCs as unavailable**, not as a fallback. In particular, a
working Kysely action must be confirmed at each active caller before disabling
its old RPC route. Never delete SQL functions by assuming that the presence of
an older migration proves an unused function. Check active server endpoints,
static publishing, client providers, import, management, and local SQLite.

Only remove legacy SQL functions in a final dependency-checked retirement after
Kysely functional parity, authorization, cross-dialect support and aggregate
query budgets are verified. Do not rewrite or delete applied migration history.

## Current scope boundary

The fixed ZModel/SchemaDef and browser/local transport simplifications are
implemented in the work branch; complete application RPC replacement and
end-to-end verification are **not yet claimed**.

## Cross-dialect Galaxy content search

The active website Search provider now uses a parameterized `contains` filter
instead of encoding unrestricted `ILIKE` expressions. The implementation is
at `app/loc/providers/portable-search.mjs` and the trusted
`kysely-runtime.mjs`. SQL `LIKE ... ESCAPE '!'` treats `%`, `_`, and `!`
literally. CJK/case-free terms avoid `LOWER(content)` while mixed Latin terms
retain case-insensitive matching. Quoted `null`, `true` and numeric-looking
terms remain strings. Advanced AND/OR/NOT uses the same operator.

This is a portable SQL semantic improvement, **not** an indexed full-text
search engine. Search QoS/statement timeout and page limits remain active.
No database indexes, tables, columns, Anchor.attr changes or RPC are required.
Existing other `ILIKE` callers remain available pending their independent
feature parity checks.

Query planning on the live PostgreSQL schema was checked using **EXPLAIN
without ANALYZE**, so neither statement was executed. Both the original
LOWER/LIKE and the CJK-native LIKE plan can scan many rows; comparative latency
and all four SQL-dialect runtime results are not yet verified. Do not promise a
guaranteed speedup until measured.
