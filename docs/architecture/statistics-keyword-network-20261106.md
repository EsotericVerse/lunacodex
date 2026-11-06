# Statistics / Keyword relationship editor — 2026-11-06

## Statistics (Recharts 3)

The prior statistics query and chart components remain in use. A shared `semanticStatisticChartTypes` selector checks the already-available chart capabilities against the metric's meaning, instead of offering ten interchangeable graphs. Temporal total/source data may use line, area, stacked, bar and (where meaningful) a moving-average composed view. Location, multimedia facets and keyword ranking share the same category/keyword statistical concept. Overlapping keyword/media hits cannot be safely presented as exclusive pie slices. Recharts' native `Brush` is enabled only for series with more than 32 time buckets. Results still come from the original bounded query; no new database round trips.

## Keyword editor (vis-network 10)

The existing Class → Group → Item → judging-word graph is now directly editable without leaving its tab: selection opens the same manual node editor alongside the graph. Empty Groups render, enabling direct creation of a new Item. The same managed-save/stale-analysis mechanisms and Edit Dock remain in charge. Arbitrary graph links and blind deletes are intentionally unavailable, preserving hierarchical data consistency.

The Network instance persists across node expansions; graph refresh keeps view/selection. Canvas colors are re-read from current published LOC Theme tokens on Theme changes. Narrow/mobile views use a vertical hierarchy, a stacked inspector and 44px-or-larger touch controls. The PELT suggestion button and analysis workflow remain unchanged.

**Boundaries:** front-end only. No new/modified SQL, RPC, Schema, indexes, ZModel, database drivers, authentication, or deployment workflows. Regression validation: pure chart selection tests plus real mobile/theme/browser verification after deployment.
