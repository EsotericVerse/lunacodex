# LOC fixed-schema / RPC-free execution boundary

This branch is a **code-only** cutover. There is no SQL migration, table/index
change, RLS or GRANT change, or automatic database introspection at runtime.

## Canonical model

- `zenstack/schema.zmodel` describes the **existing** Supabase `silver`
  physical tables. This is a fixed model, not an instruction to deploy a schema.
- `zenstack/schema-contract.json` is a frozen read-only metadata snapshot of
  the 17 physical tables and their 273 existing columns.
  It also preserves the 96 database-generated/defaulted columns and the
  existing `lrunes_daily(record_date,draw_kind)` UNIQUE constraint.
- `zenstack/schema.mjs` maps that frozen metadata into the publicly documented
  ZenStack V3 `SchemaDef` runtime shape without installing its CLI or invoking
  Prisma. Do not represent this bridge as an official `zen generate` output.
- `zenstack/client.mjs` creates a ZenStack V3 client from a trusted injected
  Kysely dialect for fixed models. No additional connections are opened by
  importing the factory; only instantiate it inside the authorized server
  execution path.
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

The active website Search provider and device-local SQLite query builder use a shared, bounded AND/OR parser and a parameterized `contains` filter
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


## Business RPC retirement — verified dependencies (2026-11-06)

Read-only `pg_proc` and `pg_depend` inspection of the existing Supabase
`silver` / `api` schemas found more than a dozen legacy analytics and
management functions. A `pg_depend` count of zero **is not sufficient**
to drop PL/pgSQL functions: runtime function bodies can refer to one another
without a catalog dependency.

- The legacy `silver.read_scope_analytics` dispatcher still references
  `read_scope_statistics`, `read_scope_category_totals`,
  `read_scope_earliest`, `read_scope_overview`,
  `read_scope_search_summary`, `read_scope_place_statistics`,
  `read_keyword_tree_summary`, `read_shared_keyword_classes`,
  `read_trace_place_density`, `read_trace_keyword_group_totals`,
  `scope_keyword_catalog`, and `read_loc_statistics`. Retire dispatcher
  first **after active consumers and ISR fallback paths are proved independent**;
  only then retire its former helper functions using `DROP FUNCTION ... RESTRICT`
  with exact PostgreSQL signatures.
- Both Kysely Keyword importers now call the **existing**
  `allocateAnchorUid` eight-character Base62 generator. New Scope provisioning
  copies into its just-created empty Anchor and only reserves new IDs in a local
  `Set`; it does not compare against the database. Existing Scope class import
  writes with `INSERT ... ON CONFLICT (uid) DO NOTHING RETURNING uid` and
  retries only when the primary key reports a collision. No per-UID SELECT,
  full Anchor scan, separate UID RPC, duplicate generator, or advisory lock.
  The previously deployed SQL importer and UID helper have been replaced
  by the mainline Kysely implementation. Both Edge variants now include
  the canonical Base62 allocator and no longer invoke the SQL UID function.

- Public ISR summary and public Bootstrap now use the established
  `analytics` and `publicAction` methods directly. The obsolete `.rpc()`
  fallback and the unused SQL gateway `kind='rpc'` dispatch branch were
  removed. No new conversion layer, schema field, index or JSONB payload.
- Galaxy Culture, Statistics, Earliest and LOC summaries now call one
  bounded Kysely aggregate when ISR is unavailable. Removed missing-RPC
  detection and the large multi-Scope, full-article comparison fallback.
  Optional ISR remains a cache, not an alternate database algorithm.
- Never conflate policy/trigger helper functions with public RPCs:
  `api.current_user_id`, `api.manage`,
  `silver.domain_has_repeated_labels`,
  `silver.sync_scope_config_display_name`, and
  `silver.touch_visual_novel_updated_at` currently have catalog dependents.
  They must not be removed without explicit policy, check constraint or
  trigger rewrites (which are outside this PR).
- `api.management_write` and other `SECURITY DEFINER` management functions
  require separate live caller, role and transaction verification before
  deletion. Lack of a direct import in one client is not proof of no use.

**Retirement status:** the first sixteen read-only SQL functions were removed
by the verified migration `20261106173000_retire_unused_read_business_rpcs.sql`.
The final nineteen business functions are handled by the later migration
`20261106200000_retire_final_19_business_rpcs.sql`. Only the authorized,
RLS/constraint/trigger-related helpers remain after the second migration.


## SQL read-only RPC retirement batch (2026-11-06)

`supabase/migrations/20261106173000_retire_unused_read_business_rpcs.sql`
retires sixteen SQL `silver` functions replaced by native Kysely
`analytics` and `publicAction` implementations. Live `pg_proc` and
`pg_depend` metadata confirmed every target has zero external SQL
function callers and zero NORMAL catalog dependents. Both currently
deployed `loc-kysely` variants use the identical source hash; inspection
found no SQL invocations of these sixteen read RPCs. Name-compatible
Kysely actions such as `read_app_bootstrap` are unaffected.

This batch **does not** drop `silver.new_keyword_tree_uid`,
`silver.import_shared_keyword_class`, authorization, RLS, policy, or
trigger helpers. The first batch intentionally left the SQL UID allocator available until
both Edge deployments received the direct Base62 UID implementation.
That second deployment was completed before the final RPC retirement.

The migration uses exact function signatures and `RESTRICT` only.
It does not add or change any table, column, index, permission or
Anchor `attr`, and never scans Galaxy articles or anchor rows.
After application, verify these sixteen SQL functions are absent and
the direct Kysely `analytics` and `publicAction` paths remain available.


## Final SQL business RPC retirement (2026-11-06)

`supabase/migrations/20261106200000_retire_final_19_business_rpcs.sql`
retires the **remaining 19 business functions** in `api` and `silver`.
Exact current PostgreSQL signatures and zero catalog dependency counts were
verified before the SQL migration. PL/pgSQL source was checked for callers
outside the retirement set; no such SQL callers remain.

The independent `loc-kysely` and `loc-kysely-clerk` deployments were
updated first to include the existing `allocateAnchorUid` Base62 routine
and verified to contain no call to `silver.new_keyword_tree_uid(text)`.
Their routing and authorization mechanism remains unchanged. No new
fallbacks, duplicated authorization logic, or full-corpus comparisons
were added.

Only `DROP FUNCTION ... RESTRICT` is used; **no table, column, index,
RLS policy, permission, Anchor attr, or Galaxy field is changed**.
The existing `api.manage()` permission function and helper functions
used by identity, database constraints and triggers are explicitly
excluded. SQL routine names previously exposed as public-action or
managed-action operations remain available in their **Kysely** form;
those JavaScript actions are not SQL stored functions.

Retirement is verified by checking `pg_proc` for the 19 function
signatures after applying the migration and separately checking
that the retained seven helper routines still exist.
