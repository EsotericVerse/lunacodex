# LOC Keyword search pattern lookup

`silver.loc_search_pattern` is the small SQL lookup for defined Keyword **words**, not a
full-text index, a PELT suggestion list, or a Keyword **Item** total.

## One row = one literal keyword

- `scopeid`: owning Scope; `(scopeid, pattern)` is the existing primary key.
- `pattern`: the Item title itself **or** one literal word in the Item's keyword list.
  An expression such as `NOR` / `AND` / `TO` / `NAME` is a rule, not a literal word.
- `count`: how many distinct eligible Galaxy articles matched **this exact word**
  under the current keyword classifier's per-document matching semantics. A
  repeated occurrence of one word in one article still counts once.
- `uid_list`: distinct matching eight-character Galaxy article UIDs in this Scope;
  this is the index's data, not a second copy of Galaxy content.
- `update_time`: time the word's UID list last changed. A count-only or display
  update without a UID change does not advance the timestamp.

The Item's original `total` and Group scoring remain separate, because one
Item may contain several words. Duplicate literal words declared by multiple
Items are deduplicated by normalized spelling and article UID.

## Write/read flow

Keyword Class reanalysis reads eligible Galaxy articles in its existing
bounded pages. During the **same** parsing pass, it collects each matched
literal word and article UID; it does not run a second full-text scan.
After validating the full article count, the trusted Scope write path
updates `silver.loc_search_pattern`. Only when the pattern write succeeds
does Class completion get published.

Search input autocomplete is debounced, returns at most 10 word suggestions
from this table, and is invoked only for Scopes authorized by the existing
LOC management principal. It retrieves `pattern` and `count`, not `uid_list`
or article content. Ordinary SQL full-text search remains unchanged.

The table records overall word counts, **not a daily/monthly time series**.
Time-bucketed keyword density still requires article dates; `update_time`
is an index-maintenance timestamp, not the article publication date.

PELT suggested Keywords are unchanged and are not an index writer.
FlexSearch Worker deployment and the retired FlexSearch workflow are
unrelated to this table.
