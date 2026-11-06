# Statistics / Keyword relationship editor — 2026-11-06

## Statistics (Recharts 3)

The prior statistics query and chart components remain in use. A shared `semanticStatisticChartTypes` selector checks the already-available chart capabilities against the metric's meaning, instead of offering ten interchangeable graphs. Temporal total/source data may use line, area, stacked, bar and (where meaningful) a moving-average composed view. Location, multimedia facets and keyword ranking share the same category/keyword statistical concept. Overlapping keyword/media hits cannot be safely presented as exclusive pie slices. Recharts' native `Brush` is enabled only for series with more than 32 time buckets. Results still come from the original bounded query; no new database round trips.

## Keyword editor (vis-network 10)

The existing Class → Group → Item → judging-word graph is now directly editable without leaving its tab: selection opens the same manual node editor alongside the graph. Empty Groups render, enabling direct creation of a new Item. The same managed-save/stale-analysis mechanisms and Edit Dock remain in charge. Arbitrary graph links and blind deletes are intentionally unavailable, preserving hierarchical data consistency.

The Network instance persists across node expansions; graph refresh keeps view/selection. Canvas colors are re-read from current published LOC Theme tokens on Theme changes. Narrow/mobile views use a vertical hierarchy, a stacked inspector and 44px-or-larger touch controls. The PELT suggestion button and analysis workflow remain unchanged.

**Boundaries:** front-end only. No new/modified SQL, RPC, Schema, indexes, ZModel, database drivers, authentication, or deployment workflows. Regression validation: pure chart selection tests plus real mobile/theme/browser verification after deployment.

## Statistic-first chart selection

A display is chosen by the question and the data, not by listing ten Recharts components. The first chart is automatic; manually selected alternatives remain available only if the underlying data supports them.

| Active statistic | Default | Meaningful alternatives |
| --- | --- | --- |
| Scope / LOC totals | time-series Line | total + moving-average Composed, Area, time-bucket Bar |
| Source / child-Scope activity | time-series Line | time-bucket Bar, Area, mutually exclusive source Stacked; Pie/Treemap only for bounded categorical composition |
| Place associations | ranked vertical Bar | location time trend Line or Area; never Pie/Stacked when an article may have more than one location |
| Keywords: Group / Item / mixed | ranked vertical Bar | Group trends Line/Area when actual dated Group counts exist; Item remains ranked without fabricated dated counts |
| Cross-member / cross-metric | multi-line time-series | grouped time-bucket Bar; Scatter only for two varying numerical series; no stacking of overlapping measures |

The legacy multimedia facet component remains unmounted: the active Statistics page deliberately uses totals, source, location and keywords. Do not reactivate deprecated media statistics merely to make a module appear utilized. Overlapping keyword/media counts and cross-comparison lanes never masquerade as additive stacked areas or exclusive slices.

Automatic defaults use the existing shared selector. The data queries, time windows, Kysely, authorization, database Schema, RPC and export logic are unchanged. Browser/Node verification must still be recorded separately from source inspection.

## Multi-Class keyword analytics (2026-11-06)

Multimedia, locations and other future categories are configured by the owner **inside the existing Keyword tree**. The site must not infer their Class IDs from words such as “media” or “place”, invent data, or create separate statistical types before those classifications exist. Statistics exposes the full authorized Keyword Class selector. Culture exposes its full authorized Class selector, with Category / Class labels when available.

The Keywords management **reanalysis** tab has an explicit Class selector; it passes that exact Class UID to the unchanged classifier and writes results only for that Class. Its completion metadata is keyed under the existing `keyword_meta.by_class[Class UID]`; counts now include `matchedDocuments`, `analyzedDocuments`, `itemMatches` and `occurrences`, alongside `completedAt`. A different Class is neither cleared nor implicitly reanalyzed. This is the existing JSON metadata field, not a new Schema/Anchor attribute. The single `current_keyword_class_uid` remains the default selection, not a limit on how many Classes can be analyzed or viewed.

Existing Keyword Group and Item summaries remain governed by their actual Class UID and the existing authorization. No new RPC, table, index, Article content search or additional independent media/place aggregation is introduced. Counts must come from an actual completed analysis; a Class not yet analyzed has no result.

## Class-scoped last analysis date (2026-11-06)

The Keywords **重新分析** dropdown enumerates all editable Classes, including each Class's own last completion date or `未解析`. Selecting a Class changes the visible last-run date and count; clicking Analyze runs exactly that Class with the existing classifier.

`keyword_meta.by_class[Class UID].completedAt` is the **only** authoritative completion date. Its sibling count fields are scoped to the same UID. The historical Scope-level `staticstime` is not a shared completion date and is no longer used for Class readiness in the frontend or Kysely analytics. Existing update paths clear the old mirror instead of writing the selected Class's timestamp into a Scope-global value. Legacy records with only a Scope-wide date are treated as `未解析` until that Class is analyzed again; dates must not be guessed or copied between Classes.

No new columns, tables, RPC, indexes or changes to keyword matching rules.
