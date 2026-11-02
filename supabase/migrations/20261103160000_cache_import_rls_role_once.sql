-- Cache constant role checks per SQL statement; preserve RLS predicates and grants.
BEGIN;
ALTER POLICY "anchor_member_read" ON silver."lo3rwang_anchor" USING (((SELECT silver.can_manage_scope('lo3rwang'::text)) OR ((type = ANY (ARRAY['date'::text, 'period'::text, 'era'::text, 'point'::text, 'path'::text, 'trace'::text, 'image'::text, 'video'::text, 'rune'::text, 'suno'::text])) AND (invisible = false))));
ALTER POLICY "anchor_owner_delete" ON silver."lo3rwang_anchor" USING ((SELECT silver.can_manage_scope('lo3rwang'::text)));
ALTER POLICY "anchor_owner_insert" ON silver."lo3rwang_anchor" WITH CHECK ((SELECT silver.can_manage_scope('lo3rwang'::text)));
ALTER POLICY "anchor_owner_update" ON silver."lo3rwang_anchor" USING ((SELECT silver.can_manage_scope('lo3rwang'::text))) WITH CHECK ((SELECT silver.can_manage_scope('lo3rwang'::text)));
ALTER POLICY "lo3rwang_galaxy_scope_update" ON silver."lo3rwang_galaxy" USING ((SELECT silver.can_manage_scope('lo3rwang'::text))) WITH CHECK ((SELECT silver.can_manage_scope('lo3rwang'::text)));
ALTER POLICY "anchor_member_read" ON silver."lrunes_anchor" USING (((SELECT silver.can_manage_scope('lrunes'::text)) OR ((type = ANY (ARRAY['date'::text, 'period'::text, 'era'::text, 'point'::text, 'path'::text, 'trace'::text, 'image'::text, 'video'::text, 'rune'::text, 'suno'::text])) AND (invisible IS FALSE))));
ALTER POLICY "anchor_owner_delete" ON silver."lrunes_anchor" USING ((SELECT silver.can_manage_scope('lrunes'::text)));
ALTER POLICY "anchor_owner_insert" ON silver."lrunes_anchor" WITH CHECK ((SELECT silver.can_manage_scope('lrunes'::text)));
ALTER POLICY "anchor_owner_update" ON silver."lrunes_anchor" USING ((SELECT silver.can_manage_scope('lrunes'::text))) WITH CHECK ((SELECT silver.can_manage_scope('lrunes'::text)));
ALTER POLICY "lrunes_galaxy_authenticated_read" ON silver."lrunes_galaxy" USING (((((able ->> 'search'::text))::boolean IS TRUE) OR (SELECT silver.can_manage_scope('lrunes'::text))));
ALTER POLICY "lrunes_galaxy_scope_update" ON silver."lrunes_galaxy" USING ((SELECT silver.can_manage_scope('lrunes'::text))) WITH CHECK ((SELECT silver.can_manage_scope('lrunes'::text)));
COMMIT;
