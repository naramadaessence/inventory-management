-- ============================================
-- Migration 012: Payment Followups Sync
-- Run after migration 011.
-- ============================================
--
-- 1. Drops the non-negative constraint on payment_followups amount_collected,
--    allowing negative values for admin corrections.
-- 2. Updates update_sale to automatically insert a correction row into 
--    payment_followups if the admin edits a bill and changes the amount_received.

BEGIN;

ALTER TABLE payment_followups
  DROP CONSTRAINT IF EXISTS payment_followups_nonnegative_amount;

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
  p_performer_id UUID,
  p_sale_type TEXT DEFAULT 'gst'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_old_item RECORD;
  v_item JSONB;
  v_product_id INTEGER;
  v_quantity NUMERIC;
  v_unit_price NUMERIC;
  v_line_total NUMERIC;
  v_total NUMERIC := 0;
  v_amount_received NUMERIC;
  v_sale_type TEXT;
  v_old_collected NUMERIC;
  v_diff NUMERIC;
BEGIN
  IF v_actor IS NULL OR NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can edit sales'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_performer_id IS NOT NULL AND p_performer_id <> v_actor THEN
    RAISE EXCEPTION 'Performer must match authenticated user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_payment_status NOT IN ('paid', 'partial', 'pending') THEN
    RAISE EXCEPTION 'Invalid payment status'
      USING ERRCODE = 'check_violation';
  END IF;

  v_sale_type := COALESCE(p_sale_type, 'gst');
  IF v_sale_type NOT IN ('gst', 'cash') THEN
    RAISE EXCEPTION 'Invalid sale type'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Sale must have at least one item'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM 1 FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale % does not exist', p_sale_id;
  END IF;

  FOR v_old_item IN
    SELECT product_id, quantity FROM sale_items WHERE sale_id = p_sale_id
  LOOP
    PERFORM adjust_stock(v_old_item.product_id, v_old_item.quantity);

    INSERT INTO inventory_transactions (
      product_id, type, quantity, reference_type, reference_id, performed_by, notes
    ) VALUES (
      v_old_item.product_id, 'sale_edit_restore', v_old_item.quantity,
      'sale', p_sale_id, v_actor,
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

    PERFORM 1 FROM products WHERE id = v_product_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % does not exist', v_product_id
        USING ERRCODE = 'foreign_key_violation';
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
      'sale', p_sale_id, v_actor,
      'Sale edited - new item stock deducted'
    );
  END LOOP;

  v_total := round(v_total, 2);
  v_amount_received := CASE
    WHEN p_payment_status = 'paid' THEN v_total
    ELSE round(COALESCE(p_amount_received, 0), 2)
  END;

  IF v_amount_received < 0 OR v_amount_received > v_total THEN
    RAISE EXCEPTION 'Amount received cannot exceed sale total'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE sales
     SET party_id = p_party_id,
         total_amount = v_total,
         payment_status = p_payment_status,
         payment_method = p_payment_method,
         amount_received = v_amount_received,
         expected_payment_date = CASE WHEN p_payment_status = 'paid' THEN NULL ELSE p_expected_payment_date END,
         sale_date = COALESCE(p_sale_date, CURRENT_DATE),
         notes = p_notes,
         sale_type = v_sale_type
   WHERE id = p_sale_id;

  -- Handle syncing with payment_followups
  SELECT COALESCE(SUM(amount_collected), 0) INTO v_old_collected
    FROM payment_followups
   WHERE sale_id = p_sale_id;

  v_diff := v_amount_received - v_old_collected;

  IF v_diff <> 0 THEN
    INSERT INTO payment_followups (
      sale_id, party_id, visited_by, visit_date, status_update,
      payment_method, amount_collected, expected_payment_date, notes
    ) VALUES (
      p_sale_id, p_party_id, v_actor, now(), p_payment_status,
      p_payment_method, v_diff, 
      CASE WHEN p_payment_status = 'paid' THEN NULL ELSE p_expected_payment_date END,
      'Admin edit bill correction'
    );
  END IF;

END;
$$;

COMMIT;
