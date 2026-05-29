-- ============================================
-- Migration 009: Edit Bill RPC + Sale Delete Audit Type Fix
-- Run this in Supabase SQL Editor BEFORE deploying the matching client code.
-- ============================================
--
-- Fixes:
--   1. Existing delete_sale() wrote inventory_transactions.type = 'sale_delete',
--      but the table CHECK constraint did not allow that value.
--   2. Adds update_sale() so admins can edit bill line items atomically.
--
-- The update flow restores old sale-item stock, replaces sale_items, deducts
-- the edited item quantities, updates the sale header, and writes audit rows.
-- If any deduction would make stock negative, the whole RPC rolls back.

BEGIN;

ALTER TABLE inventory_transactions
  DROP CONSTRAINT IF EXISTS inventory_transactions_type_check;

ALTER TABLE inventory_transactions
  ADD CONSTRAINT inventory_transactions_type_check
  CHECK (type IN (
    'checkout',
    'checkin',
    'sale',
    'sale_edit',
    'sale_edit_restore',
    'sale_delete',
    'rental_out',
    'rental_return',
    'damage',
    'stock_in',
    'adjustment'
  ));

CREATE OR REPLACE FUNCTION update_sale(
  p_sale_id INTEGER,
  p_party_id INTEGER,
  p_items JSONB,
  p_payment_status TEXT,
  p_payment_method TEXT,
  p_amount_received NUMERIC,
  p_expected_payment_date DATE,
  p_sale_date DATE,
  p_notes TEXT,
  p_performer_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_old_item RECORD;
  v_item JSONB;
  v_product_id INTEGER;
  v_quantity NUMERIC;
  v_unit_price NUMERIC;
  v_line_total NUMERIC;
  v_total NUMERIC := 0;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can edit sales'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Sale must have at least one item'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM 1 FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale % does not exist', p_sale_id;
  END IF;

  -- Restore old item stock first. Any later exception rolls this back.
  FOR v_old_item IN
    SELECT product_id, quantity FROM sale_items WHERE sale_id = p_sale_id
  LOOP
    PERFORM adjust_stock(v_old_item.product_id, v_old_item.quantity);

    INSERT INTO inventory_transactions (
      product_id, type, quantity, reference_type, reference_id, performed_by, notes
    ) VALUES (
      v_old_item.product_id, 'sale_edit_restore', v_old_item.quantity,
      'sale', p_sale_id, p_performer_id,
      'Sale edited - old item stock restored'
    );
  END LOOP;

  DELETE FROM sale_items WHERE sale_id = p_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := (v_item->>'product_id')::INTEGER;
    v_quantity := (v_item->>'quantity')::NUMERIC;
    v_unit_price := (v_item->>'unit_price')::NUMERIC;

    IF v_product_id IS NULL OR v_quantity IS NULL OR v_quantity <= 0 OR v_unit_price IS NULL OR v_unit_price < 0 THEN
      RAISE EXCEPTION 'Invalid sale item'
        USING ERRCODE = 'check_violation';
    END IF;

    v_line_total := round(v_quantity * v_unit_price, 2);
    v_total := v_total + v_line_total;

    INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, line_total)
    VALUES (p_sale_id, v_product_id, v_quantity, v_unit_price, v_line_total);

    PERFORM adjust_stock(v_product_id, -v_quantity);

    INSERT INTO inventory_transactions (
      product_id, type, quantity, reference_type, reference_id, performed_by, notes
    ) VALUES (
      v_product_id, 'sale_edit', -v_quantity,
      'sale', p_sale_id, p_performer_id,
      'Sale edited - new item stock deducted'
    );
  END LOOP;

  IF COALESCE(p_amount_received, 0) > v_total THEN
    RAISE EXCEPTION 'Amount received cannot exceed sale total'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE sales
     SET party_id = p_party_id,
         total_amount = v_total,
         payment_status = p_payment_status,
         payment_method = p_payment_method,
         amount_received = COALESCE(p_amount_received, 0),
         expected_payment_date = p_expected_payment_date,
         sale_date = p_sale_date,
         notes = p_notes
   WHERE id = p_sale_id;
END;
$$;

CREATE OR REPLACE FUNCTION delete_sale(p_sale_id INTEGER, p_performer_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_item RECORD;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can delete sales'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM 1 FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale % does not exist', p_sale_id;
  END IF;

  FOR v_item IN
    SELECT product_id, quantity FROM sale_items WHERE sale_id = p_sale_id
  LOOP
    PERFORM adjust_stock(v_item.product_id, v_item.quantity);

    INSERT INTO inventory_transactions (
      product_id, type, quantity, reference_type, reference_id, performed_by, notes
    ) VALUES (
      v_item.product_id, 'sale_delete', v_item.quantity,
      'sale', p_sale_id, p_performer_id,
      'Sale deleted - stock restored'
    );
  END LOOP;

  DELETE FROM sales WHERE id = p_sale_id;
END;
$$;

GRANT EXECUTE ON FUNCTION update_sale(INTEGER, INTEGER, JSONB, TEXT, TEXT, NUMERIC, DATE, DATE, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_sale(INTEGER, UUID) TO authenticated;

COMMIT;
