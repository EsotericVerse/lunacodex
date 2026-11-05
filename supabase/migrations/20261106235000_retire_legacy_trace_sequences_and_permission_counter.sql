-- Legacy *_trace tables are retired in favor of *_anchor and Base62 UID.
-- The old per-Trace short-sequences have no DB object dependencies or
-- active SQL/JS callers. No CASCADE and no Galaxy or Anchor data writes.
-- The old diagnostic counter RPC references silver.lo3rwang.count,
-- which was deliberately removed; it has no callers or dependencies.
DROP FUNCTION IF EXISTS silver.record_permission_check(text);
DROP SEQUENCE IF EXISTS silver.lo3rwang_trace_short_seq RESTRICT;
DROP SEQUENCE IF EXISTS silver.loc_trace_short_seq RESTRICT;
DROP SEQUENCE IF EXISTS silver.lrunes_trace_short_seq RESTRICT;
