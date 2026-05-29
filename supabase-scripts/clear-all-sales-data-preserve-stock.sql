-- ============================================
-- One-off cleanup: remove ALL sales data while preserving stock
-- ============================================
-- Purpose:
--   Use this if the client means: "clear/reset the current sales total
--   of roughly 18000, but keep party, product stock, and other data."
--
-- Important:
--   This intentionally does NOT call delete_sale(), because delete_sale()
--   restores stock. This script removes sales rows and directly-related
--   sales/audit/payment-followup data without changing products.current_stock.
--
-- Recommended process:
--   1. Run the preview SELECT first by itself.
--   2. If the listed rows are exactly what should be cleared, run the
--      transaction block.

-- Preview all sales rows that will be removed:
SELECT id, party_id, total_amount, payment_status, amount_received, sale_date, recorded_by, created_at
FROM sales
ORDER BY created_at DESC;

-- Transaction block. Run only after previewing the rows above.
BEGIN;

CREATE TEMP TABLE target_sales_to_clear AS
SELECT id
FROM sales;

DELETE FROM payment_followups
WHERE sale_id IN (SELECT id FROM target_sales_to_clear);

DELETE FROM inventory_transactions
WHERE reference_type = 'sale'
  AND reference_id IN (SELECT id FROM target_sales_to_clear)
  AND type IN ('sale', 'sale_edit', 'sale_edit_restore', 'sale_delete');

-- sale_items are deleted automatically through ON DELETE CASCADE.
DELETE FROM sales
WHERE id IN (SELECT id FROM target_sales_to_clear);

COMMIT;
