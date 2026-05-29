-- ============================================
-- One-off cleanup: remove sales entries whose bill total is 18000
-- ============================================
-- Purpose:
--   Client requested clearing/resetting only the sales data for entries of
--   18000, while leaving party, product stock, and other data unchanged.
--
-- Important:
--   This intentionally does NOT call delete_sale(), because delete_sale()
--   restores stock. This script removes sales rows and directly-related
--   sales/audit/payment-followup data without changing products.current_stock.
--
-- Run in Supabase SQL Editor after reviewing the preview SELECT.

-- Preview rows that will be removed:
SELECT id, party_id, total_amount, payment_status, amount_received, sale_date, recorded_by, created_at
FROM sales
WHERE total_amount = 18000
ORDER BY created_at DESC;

BEGIN;

CREATE TEMP TABLE target_sales_to_clear AS
SELECT id
FROM sales
WHERE total_amount = 18000;

-- Remove collection/follow-up rows tied to those sales so the sales delete is not FK-blocked.
DELETE FROM payment_followups
WHERE sale_id IN (SELECT id FROM target_sales_to_clear);

-- Remove sale audit rows for those bills so the inventory log no longer shows cleared sales.
-- This does not touch stock quantities.
DELETE FROM inventory_transactions
WHERE reference_type = 'sale'
  AND reference_id IN (SELECT id FROM target_sales_to_clear)
  AND type IN ('sale', 'sale_edit', 'sale_edit_restore', 'sale_delete');

-- sale_items are deleted automatically through ON DELETE CASCADE.
DELETE FROM sales
WHERE id IN (SELECT id FROM target_sales_to_clear);

COMMIT;
