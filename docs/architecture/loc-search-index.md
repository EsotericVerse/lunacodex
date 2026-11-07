# LOC Search Index — FlexSearch / LOC_KV

The Galaxy SQL Schema remains unchanged. This is an **optional index accelerator**, not a new SQL database, a new RLS rule, an RPC, or an MCP buffer. There is no data synchronization between independent SQL providers.

## Implemented

- FlexSearch version **0.8.212**, repo dependency from PR #1215. The index uses the same **CJK encoder** in Node backfill and Cloudflare Worker; versioned v2 keys prevent mixing older tokenization with new deltas.
- A private **loc-search-index Worker** bound to the existing Cloudflare **LOC_KV** namespace. The old MCP buffer Worker is not reused.
- Full document identity now **reuses PR #1219's virtual ZModel `LocFederatedRef`**. `locGlobalUid({databaseId,scopeId,uid})` produces the stable global UID, and FlexSearch adds `entityType` as an independent namespace. Two SQL sources with identical local UIDs never collide. Internal `databaseId` values are stable **lower-case** registry keys (for example, display label `DB1` can map to `db1`); they are independent of hosting vendors.
- Authenticated index operations: search, documents, snapshots, reset, coverage and bounded delta pruning. Service secret stays server-side.
- SQL Gateway accepts the optional search hint, obtains candidate UIDs through the index Worker, checks each returned `globalUid` against the **same ZModel federation contract**, then **still evaluates SQL content, publication, source, date and Scope permissions**. The index alone never grants content access.
- Search result keys and selected-article reads retain the logical database identifier; `expectedDbId` is **a verified routing assertion, never a browser-selected SQL connection**. A wrong database ID is rejected instead of returning a same-UID record from another source.
- Missing, incomplete, overloaded or unavailable index: original SQL search fallback.
- Gateway post-commit updates, MCP append/sync and short import write immutable delta segments. New Append content is indexed without rewriting a shared KV base shard. Old deleted or edited postings may remain as harmless candidates; SQL rechecks actual content.
- Initial indexing tool **scripts/rebuild-loc-search-index.mjs** builds 32 logical UID shards in-memory and uploads one snapshot per populated shard, rather than performing one KV write per article.

## Boundaries

The current SQL Gateway has one configured primary database and its existing backup choices. It **does not yet federate one Scope across two simultaneously active SQL targets**. The index contract supports multiple logical dbIds, but SQL multi-target orchestration and article-detail routing are separate work.

Cloudflare Workers KV is **eventually consistent**. A new index delta can lag a successful SQL commit, especially across regions. Even though SQL revalidation prevents stale/private content from being displayed, it cannot guarantee that an index has not temporarily omitted new matches. For that reason, **index-based narrowing is disabled by default**. Enable it only once full coverage, ingestion and acceptable freshness have been established. Strict read-after-write search requires a stronger consistency protocol than plain KV.

An index marked complete must cover all eligible documents, including private documents that might later become public. A public/anonymous-only backfill does not prove full coverage. Rebuilding requires a quiesced logical source or coordinated snapshot: the included builder assumes no concurrent mutation. The builder prunes only delta segments dated **before** the SQL scan's start, preserving newer append events; if a source reaches the per-source cap of 48 deltas, indexed narrowing falls back to SQL until a coordinated rebuild/compaction.

## Deployment / cutover (not automatic)

1. Retain existing LOC_KV. The former MCP buffer at workers/loc-channel1 and the loc-auth hourly Cron are unrelated to the new search tier; neither is modified or deleted by this PR. Decide their retirement separately.
2. Deploy workers/loc-search-index/wrangler.jsonc using the existing Wrangler workflow. Configure a random 32+ character, server-only **LOC_SEARCH_INDEX_SECRET** on that Worker; do not commit the secret.
3. On the **trusted LOC SQL Gateway**, set **LOC_SEARCH_INDEX_URL** to the HTTPS origin of the private Worker, and set the same **LOC_SEARCH_INDEX_SECRET**. The Cloudflare Container ingress forwards these variables to the Deno backend when configured.
4. Backfill each **logical dataset** separately using authorized, complete SQL read credentials and environment **LOC_INDEX_SCOPE_ID**, **LOC_INDEX_DB_ID**, **LOC_SQL_GATEWAY_URL**, **LOC_SQL_DELEGATION_TOKEN**, plus index URL and secret. Run node scripts/rebuild-loc-search-index.mjs. The logical DB ID must match the SQL Gateway server-side alias/dataset ID.
5. Run **npm run test:search-index**. Only after verified coverage and acceptable KV freshness, set **LOC_SEARCH_INDEX_ENABLED=true** on the trusted SQL Gateway. Leave it unset/false to preserve original SQL search.

GitHub merges do **not** deploy a Worker or populate KV automatically. Secrets and Cloudflare routing are separate steps.

## Workload and cost

- KV Free write and storage quotas are per account, not multiplied by Namespace or Worker.
- The Worker bounds results to 200 candidate IDs and each dataset to 48 immutable deltas; on limits, it returns incomplete and preserves SQL fallback rather than silently truncating.
- The Worker currently loads up to 32 base shard snapshots plus delta segments per search. Memory/latency against production volume **has not been measured**; do not claim a 1-second SLA without evidence.
- ZModel's `LocFederatedRef` and `LocAnchorLink` are **virtual types**, not automatically generated database policies. ZenStack's low-level **`$qb` bypasses `PolicyPlugin` policies**, even where a policy-aware client is created. The current fixed-control-model adapters therefore still rely on **the signed Gateway and Kysely filters** for effective access, not an assumed automatic policy SQL predicate. Galaxy row permissions remain the Gateway/Kysely responsibility until a separately validated policy-aware ORM cutover. No new RLS rules are necessary.
- A text index is not a substitute for SQL COUNT, Culture temporal aggregation, Trace geographic queries, SQL Gateway routing or LOC Auth.
