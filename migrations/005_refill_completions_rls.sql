-- ============================================
-- Migration 005: Scope refill_completions RLS to acting user
-- Run this in Supabase SQL Editor.
-- ============================================
--
-- Migration 004 created refill_completions with permissive policies:
--   INSERT WITH CHECK (true)
--   DELETE USING (true)
-- That allowed any authenticated caller to mark any party's refill as
-- completed by anyone (the `completed_by` column was unconstrained).
--
-- This migration tightens the policies so:
--   - INSERT requires completed_by to match the calling user (or be NULL,
--     since demo localStorage may not always populate it via this path).
--   - DELETE is allowed only by admins or the user who created the row.
--
-- `completed_by` stays TEXT (not UUID) because the demo-mode localStorage
-- store uses string IDs ("admin-1") while production uses UUIDs. The
-- auth.uid()::text cast bridges both.

DROP POLICY IF EXISTS "refill_completions_insert" ON refill_completions;
DROP POLICY IF EXISTS "refill_completions_delete" ON refill_completions;

CREATE POLICY "refill_completions_insert" ON refill_completions
  FOR INSERT
  WITH CHECK (completed_by IS NULL OR completed_by = auth.uid()::text);

CREATE POLICY "refill_completions_delete" ON refill_completions
  FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    OR completed_by = auth.uid()::text
  );

-- SELECT policy remains permissive (refill list is shown across the app).
