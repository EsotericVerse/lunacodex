# LOC Keyword search pattern — 2026-11-08

The owner-selected lookup is **`silver.loc_search_pattern`**, not FlexSearch, RAG, Cloudflare KV, or a new full-text tokenizer. It reuses the existing per-Class Keyword Item classification results; the PELT **建議關鍵詞** functionality is separate and unchanged.

## Physical data contract

Exactly five columns:

| Column | Meaning |
| --- | --- |
| `scopeid` | The owning Scope (a future database-qualified Scope can reuse this identifier without a separate field). |
| `pattern` | Normalized NFKC literal Item title or a literal string in that Item's `keyword` list. Judgement-rule expressions are excluded. |
| `count` | **The literal keyword's own hit count**, not the Item group's total. The existing classifier counts one match per word per article, so this equals the length of that word's deduplicated UID list. |
| `uid_list` | Sorted, deduplicated eight-character Galaxy UID strings that matched that **word**, independent of other words in the same Item. |
| `update_time` | Last time this term's UID set changed. Count-only changes preserve the original timestamp. |

A compound `(scopeid, pattern)` primary key is the only index; **no** redundant per-article index, per-Class field, FlexSearch Worker, trigger, or RPC. Date-interval density is not inferable from these five fields alone: time-specific charts still need article dates or an existing dated aggregate, not an invented count.

## Reanalysis flow

1. The existing selected-Class reanalysis scans the eligible Galaxy content **once**, via its existing date/createtime reader. While the compiled classifier checks each **literal word** already, it now also records which article UID matched each word, deduplicating the same UID across Items.
2. The original Group/Item Anchor total write stays for compatibility with existing Culture/Statistics consumers; there is **no** duplicate full UID array stored on unified Anchor.
3. An additional completion callback turns the freshly produced **per-word** results into one word/title -> UID mapping. It issues a single authenticated, Scope-authorized native Kysely `sync_search_patterns` action. This action does **not** read Galaxy or redo tokenization; it only checks the small Item catalogue, compares existing patterns, upserts changed rows, and removes terms no longer present in any Item. The Class completion marker is saved **only after** the pattern write succeeds.
4. Existing Class-only reanalysis remains Class-only. Other Classes' live words are not globally purged. An Item alias present in more than one Class is a shared logical term; without an Item/Class provenance column, a later single-Class reanalysis cannot perfectly subtract the other Class's previous contribution. This is a deliberate current five-column limit, not a reason to silently add a sixth field.

**Allowed pattern levels:** only an **Item name** and its individual **literal keywords** enter `silver.loc_search_pattern`. **Group and Class names never enter the table**, and reanalysis of a selected Class must not analyze or merge other Classes. **Important:** Item is a keyword group, not one keyword. Item.total and search_pattern.count are different. An identical word shared by several Items in the selected Class counts the same article only once.

For large scopes, pattern UID arrays are uploaded in bounded batches (at most 700 kB each) because the existing Kysely POST transport rejects bodies above 1 MiB. Only the last batch may prune obsolete words; Class completion waits for every batch. Ordinary autocomplete remains one small read.\n\nThe table starts empty until that Scope's first new analysis. Historical Item totals alone cannot reconstruct article UID arrays; do **not** invent UID lists from counts or claim that old data was backfilled.

## Autocomplete

The Search page debounces user input (220 ms), requests at most ten `pattern,count` records through the existing LOC Auth delegated Kysely action and applies authorized Scope filters. No UID arrays, article text, unauthorized private Class contents, or repeated permission checks on ordinary public page load are returned to the browser. The original Galaxy search remains authoritative after a suggestion is clicked and retains its existing date/source/visibility filters.

The public, separately curated **建議搜尋** display remains independent from this owner-only autocompleter. A signed-out visitor does not receive private Keyword Item terms.

No changes to PELT suggestions, ZModel hierarchy, external database contents, or Cloudflare. Non-PostgreSQL destinations must have an equivalent table and dialect-specific write port before enabling the new server action there; the existing ordinary Search remains unaffected.

## Verification

- `node --test scripts/test-loc-search-pattern.mjs scripts/test-keyword-reanalysis.mjs`
- Runtime: verify the first completed reanalysis writes patterns, returns distinct UIDs, and only changes `update_time` on a different UID set.
- Permission: verify an unsigned or unauthorized Scope does not receive private pattern suggestions. No anonymous `SELECT` grant is created for the table.
