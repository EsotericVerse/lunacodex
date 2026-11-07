# LOC Search Index — FlexSearch / LOC_KV

The Galaxy SQL Schema remains unchanged. This is an **optional index accelerator**, not a new SQL database, a new RLS rule, an RPC, or an MCP buffer. There is no data synchronization between independent SQL providers.

## Implemented

- FlexSearch version **0.8.212**, repo dependency from PR #1215. The index uses the same **CJK encoder** in Node backfill and Cloudflare Worker; versioned v2 keys prevent mixing older tokenization with new deltas.
- A private **loc-search-index Worker** bound to the existing Cloudflare **LOC_KV** namespace. The old MCP buffer Worker is not reused.
- Full document identity now **reuses PR #1219's virtual ZModel `LocFederatedRef`**. `locGlobalUid({databaseId,scopeId,uid})` produces the stable global UID, and FlexSearch adds `entityType` as an independent namespace. Two SQL sources with identical local UIDs never collide. Internal `databaseId` values are stable **lower-case** registry keys (for example, display label `DB1` can map to `db1`); they are independent of hosting vendors.
- Authenticated index operations: search, documents, snapshots, reset, coverage, bounded delta pruning and `POST /v1/status` (source readiness/segment counts). Service secret stays server-side. Coverage is now a **manifest listing every committed base-shard number**, not a bare `v2` flag. A remote KV point-of-presence that cannot yet read a listed shard triggers SQL fallback rather than treating the shard as empty.
- SQL Gateway accepts the optional search hint, obtains candidate UIDs through the index Worker, checks each returned `globalUid` against the **same ZModel federation contract**, then **still evaluates SQL content, publication, source, date and Scope permissions**. The index alone never grants content access.
- Search result keys and selected-article reads retain the logical database identifier; `expectedDbId` is **a verified routing assertion, never a browser-selected SQL connection**. A wrong database ID is rejected instead of returning a same-UID record from another source.
- Missing, incomplete, overloaded or unavailable index: original SQL search fallback.
- Gateway post-commit updates, MCP append/sync and short import write immutable delta segments. New Append content is indexed without rewriting a shared KV base shard. Old deleted or edited postings may remain as harmless candidates; SQL rechecks actual content.
- Initial indexing tool **scripts/rebuild-loc-search-index.mjs** scans authorized Galaxy once, stages 32 UID partitions in a temporary Node directory, and constructs **one FlexSearch shard at a time** before upload. It validates row count and duplicate UIDs *before* resetting the current index, cleans temporary files even on errors, and publishes a shard manifest only when every upload succeeds. The staging layer has five offline regression tests and uses no OpenNext.

## Boundaries

The SQL Gateway now has an **opt-in federated Galaxy text-search route**: one Scope can read multiple independent registered SQL datasets in one request, preserving colliding local UIDs as separate ZModel global IDs. The source list is a trusted server-side configuration, not a browser SQL target selector. All sources use their existing Kysely drivers and signed LOC Auth gate; cross-dataset date pagination uses an explicit SQL-portable NULLS LAST expression and a bounded k-way merge (max four concurrent SQL reads). There is no SQL replication or shared Galaxy table.

This is **not yet unrestricted SQL federation**: only the Search text-query shape and qualified Galaxy row lookup are handled. Culture/Trace/Statistics and deep search pages beyond the bounded 2,000-row window retain their existing routes or fail explicitly. For federated article details, **unqualified Anchor/Media/Time context is intentionally not attached**: mixing source-local Anchor or Media UIDs from the primary DB would be incorrect. Qualified Galaxy related-article title reads use the same `databaseId`; the remaining linked-data readers require a later dataset-aware route. Ordinary non-federated article details keep their existing functionality. A future user-facing hot-swap registration UI is not part of this change.

Before enabling UID pruning, the SQL Gateway can run a **shadow completeness check** without changing any returned SQL result:

- Keep `LOC_SEARCH_INDEX_ENABLED=false` and set server-only `LOC_SEARCH_INDEX_SHADOW=true` (forwarded into the SQL Container). This is **opt-in** and may add up to the existing 1.8 s index-request deadline to qualifying Search requests.
- With an index Worker, private secret and populated base shards in place, qualifying simple `content.contains` searches make one shadow KV lookup **after** the full SQL page has been read. The Gateway logs only `checked`, `missing` and `indexed` counts; it does **not** log article UIDs, search text, content or the bearer secret.
- A positive `missing` count means a real false negative was observed on that SQL page: **do not enable index pruning**. Index unavailable/incomplete/mismatched queries are not falsely counted as passing.
- A page with `missing=0` is only a sample, not proof of read-after-write consistency. KV's eventual consistency still applies to newly written Append segments. Keep SQL authoritative for changing datasets until the freshness guarantee is separately implemented and verified. Disable the shadow flag again after the diagnostic run.

Cloudflare Workers KV is **eventually consistent**. A new index delta can lag a successful SQL commit, especially across regions. Even though SQL revalidation prevents stale/private content from being displayed, it cannot guarantee that an index has not temporarily omitted new matches. For that reason, **index-based narrowing is disabled by default**. Enable it only once full coverage, ingestion and acceptable freshness have been established. Strict read-after-write search requires a stronger consistency protocol than plain KV.

An index marked complete must cover all eligible documents, including private documents that might later become public. A public/anonymous-only backfill does not prove full coverage. Rebuilding requires a quiesced logical source or coordinated snapshot: the included builder assumes no concurrent mutation. The builder prunes only delta segments dated **before** the SQL scan's start, preserving newer append events; if a source reaches the per-source cap of 48 deltas, indexed narrowing falls back to SQL until a coordinated rebuild/compaction.

## Deployment / cutover (not automatic)

1. Retain existing LOC_KV. The former MCP buffer at workers/loc-channel1 and the loc-auth hourly Cron are unrelated to the new search tier; neither is modified or deleted by this PR. Decide their retirement separately.
2. Deploy workers/loc-search-index/wrangler.jsonc using the existing Wrangler workflow. Configure a random 32+ character, server-only **LOC_SEARCH_INDEX_SECRET** on that Worker; do not commit the secret.
3. On the **trusted LOC SQL Gateway**, set **LOC_SEARCH_INDEX_URL** to the HTTPS origin of the private Worker, and set the same **LOC_SEARCH_INDEX_SECRET**. The Cloudflare Container ingress forwards these variables to the Deno backend when configured.
4. For multiple independent SQL datasets, configure the trusted Gateway/container with **LOC_SEARCH_DATASETS_JSON** (see the example below), backed by existing **LOC_DB_CONNECTIONS_JSON** server-side profiles. Keep each user-defined logical ID stable and lower-case; never place passwords or URLs in the index.
5. Backfill each **logical dataset** separately with a signed **Scope manage** LOC SQL delegation, and environment **LOC_INDEX_SCOPE_ID**, **LOC_INDEX_DB_ID**, **LOC_SQL_GATEWAY_URL**, **LOC_SQL_DELEGATION_TOKEN**, plus index URL and secret. First run `LOC_INDEX_VERIFY_ONLY=true node scripts/rebuild-loc-search-index.mjs` to verify authorized SQL coverage and local shard sizing **without writing LOC_KV**. Then, with a quiesced dataset, run `node scripts/rebuild-loc-search-index.mjs`. The builder uses read-only **index-snapshot** Gateway requests with a private `x-loc-index-secret`, and stages on local temporary disk. All document UIDs are checked before updating the index. A successful build uploads only populated shards, prunes pre-scan deltas and publishes an explicit readiness manifest. `POST /v1/status` returns operational readiness without exposing articles.
6. The isolated, **non-deploying** GitHub Actions workflow `loc-flexsearch-index-tests.yml` runs all three suites: `node --test scripts/test-loc-search-index.mjs scripts/test-loc-federated-galaxy-search.mjs scripts/test-loc-search-index-stage.mjs`. Keep `LOC_SEARCH_INDEX_ENABLED` unset/false unless coverage and consistency have been verified; it is not automatically enabled by merging this PR.

Example **trusted server-only** logical source registry (never accepted from the browser):

```json
{
  "lo3rwang": [
    {"databaseId":"db1","provider":"supabase","engine":"postgres","connection_alias":"supabase_current"},
    {"databaseId":"db2","provider":"custom","engine":"mysql","connection_alias":"office_mysql"}
  ]
}
```

When a Scope has multiple registered datasets, a qualifying Galaxy content search fans out through the same Gateway, produces one globally ordered page, and keeps each source's `databaseId`. **Post-commit Galaxy, MCP Append and short-import index writes also resolve the stable `databaseId` from the trusted registry** before writing KV; they do not accidentally create a second, orphan index under the physical connection alias. A registered Scope whose configured SQL alias cannot be matched skips index ingestion rather than inventing a database identity. When the index is unavailable, every registered database is searched with the existing SQL content predicate; it does **not** silently search only the primary. Ordinary single-database behavior remains unchanged when the registry is absent. The qualified `expectedDbId` field is checked against this trusted registry (or the existing configured source in legacy mode), preventing same-UID collisions and wrong-database failover.

For public Galaxy text searches, the Gateway independently applies `search=true` plus private-site filtering; a dataset-qualified public article read applies `list=true` plus private-site filtering. Authorized Scope administrators continue to use their existing signed grant. These Kysely conditions are independent of native PostgreSQL RLS.

GitHub merges do **not** deploy a Worker, change server configuration or populate KV automatically. Secrets, routing configuration and Cloudflare deployment are separate steps.

## Workload and cost

- KV Free write and storage quotas are per account, not multiplied by Namespace or Worker.
- The Worker bounds results to 200 candidate IDs and each dataset to 48 immutable deltas; on limits, it returns incomplete and preserves SQL fallback rather than silently truncating.
- Search hints are accepted for UID prefiltering **only when the exact search term is a mandatory SQL `content.contains` predicate**; a mismatched hint, broader OR or compound expression leaves SQL authoritative instead of silently dropping articles.
- The Worker uses the native Workers KV `get(keys, 'json')` API to read up to four index shards together, with a single-key fallback if the 25 MB bulk-response limit is reached. This reduces read-request overhead without introducing a new storage adapter.
- The Worker currently loads up to 32 base shard snapshots plus delta segments per search. Memory/latency against production volume **has not been measured**; do not claim a 1-second SLA without evidence.
- ZModel's `LocFederatedRef` and `LocAnchorLink` are **virtual types**, not automatically generated database policies. ZenStack's low-level **`$qb` bypasses `PolicyPlugin` policies**, even where a policy-aware client is created. The current fixed-control-model adapters therefore still rely on **the signed Gateway and Kysely filters** for effective access, not an assumed automatic policy SQL predicate. Galaxy row permissions remain the Gateway/Kysely responsibility until a separately validated policy-aware ORM cutover. No new RLS rules are necessary.
- A text index is not a substitute for SQL COUNT, Culture temporal aggregation, Trace geographic queries, SQL Gateway routing or LOC Auth.
