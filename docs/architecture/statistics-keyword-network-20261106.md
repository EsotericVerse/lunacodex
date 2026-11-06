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

## Multimedia and locations are Keyword Categories (2026-11-06)

The Statistics navigation includes **Multimedia (Keywords)** and **Place**, but neither is an independent statistics data source. They invoke exactly the same authorized Keyword Class directory, stored analysis summary and Recharts Group/Item ranking as the Keywords view. A category name selects the matching visible Classes (media: 多媒體／媒體／media／multimedia; place: 地點／空間／place／location); a public Class without a category name may match its exact Class name. Changing Class reuses the existing keyed summary reader; it does not scan `galaxy.media_link`, parse media metadata, join anchors or fetch a second place summary.

If no matching visible Category/Class has been configured or analyzed, the UI says so; it **does not invent** media or geographic keyword counts. The old standalone media facet and place summary are not mounted from this statistics page. Neither legacy data nor a second statistical hierarchy is restored. All classifications remain Category → Class → Group → Item, with the existing ownership/share visibility. This is frontend routing only; no Schema, RPC, additional database round trips per chosen Class, or changes to Portable.
