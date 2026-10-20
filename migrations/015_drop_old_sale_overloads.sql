-- ============================================
-- Migration 015: Drop superseded record_sale / update_sale overloads
-- Run after migration 014. Run ONCE in the Supabase SQL editor.
-- ============================================
--
-- Migrations 011 and 012 added a p_sale_type parameter by CREATE OR REPLACE
-- with a new argument list, which created NEW functions instead of replacing
-- the migration 010 versions. Production (checked 2026-10-20) therefore has
-- two overloads of each. The app always sends p_sale_type, so only the new
-- ones are used; a call without it is ambiguous. The old update_sale also
-- lacks the migration 012 payment_followups correction sync.
--
-- 011/012 also never revoked EXECUTE from PUBLIC/anon on the new functions
-- (010 did for the old ones). Both functions already reject unauthenticated
-- callers internally; this restores the 010 grant pattern as defense in depth.
--
-- Safe to re-run: DROP ... IF EXISTS, REVOKE/GRANT are idempotent.

BEGIN;

DROP FUNCTION IF EXISTS record_sale(INTEGER, JSONB, TEXT, TEXT, NUMERIC, DATE, DATE, TEXT, UUID);
DROP FUNCTION IF EXISTS update_sale(INTEGER, INTEGER, JSONB, TEXT, TEXT, NUMERIC, DATE, DATE, TEXT, UUID);

REVOKE ALL ON FUNCTION record_sale(INTEGER, JSONB, TEXT, TEXT, NUMERIC, DATE, DATE, TEXT, UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION update_sale(INTEGER, INTEGER, JSONB, TEXT, TEXT, NUMERIC, DATE, DATE, TEXT, UUID, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION record_sale(INTEGER, JSONB, TEXT, TEXT, NUMERIC, DATE, DATE, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION update_sale(INTEGER, INTEGER, JSONB, TEXT, TEXT, NUMERIC, DATE, DATE, TEXT, UUID, TEXT) TO authenticated;

COMMIT;

-- Verify (expect exactly one row each, ending in "p_sale_type text"):
-- select proname, pg_get_function_identity_arguments(oid) from pg_proc
--  where pronamespace = 'public'::regnamespace and proname in ('record_sale', 'update_sale');
