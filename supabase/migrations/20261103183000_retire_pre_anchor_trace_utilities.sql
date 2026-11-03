-- Retire legacy pre-Anchor Trace utilities after the four-table consolidation.
-- These refer to trace_type, route_list, anchor_list and UID4, absent from current unified Anchor.
-- Verified zero SQL, RLS, View, Trigger and catalog dependencies.
-- Retain domain_has_repeated_labels, which still has a live constraint dependency.
BEGIN;
DROP FUNCTION silver.trace_normalize_place_name(text) RESTRICT;
DROP FUNCTION silver.trace_prevent_identity_change() RESTRICT;
DROP FUNCTION silver.validate_scoped_trace_map() RESTRICT;
NOTIFY pgrst,'reload schema';
COMMIT;
