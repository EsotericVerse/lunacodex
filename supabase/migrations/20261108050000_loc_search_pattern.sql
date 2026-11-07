-- Owner-authorized LOC Keyword lookup; no FlexSearch, RPC or RLS policy.
-- A single logical Scope row per literal term, with a deduplicated article UID array.
-- Cross-provider database aliasing may be encoded in scopeid when configured.
create table if not exists silver.loc_search_pattern (
  scopeid varchar(64) not null,
  pattern text not null,
  count bigint not null default 0 check (count >= 0),
  uid_list text[] not null default '{}'::text[],
  update_time timestamptz not null default now(),
  constraint loc_search_pattern_pkey primary key (scopeid, pattern),
  constraint loc_search_pattern_nonempty check (char_length(pattern) between 1 and 256)
);

comment on table silver.loc_search_pattern is
  'Each literal keyword or Item title -> its own matched article count and deduplicated Galaxy UIDs.';
comment on column silver.loc_search_pattern.count is
  'One matched article counts once for this literal keyword; not the containing Item total.';
comment on column silver.loc_search_pattern.update_time is
  'Time when uid_list last changed; count-only adjustments preserve it.';

-- No public table GRANT: LOC Auth-scoped Kysely managed actions own reads
-- and writes. The existing Scope/Galaxy public SELECT contract is unaffected.
