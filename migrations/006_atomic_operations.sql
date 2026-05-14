-- ============================================
-- Migration 006: Atomic Operations (DRAFT — DO NOT RUN BLIND)
-- ============================================
--
-- ⚠ STATUS: This is a design draft. Read carefully and test in a staging
-- Supabase project before running in production. The corresponding
-- client-side code changes (in sales.js, daily-operations.js) are NOT yet
-- in the repo — applying this migration alone will NOT change behavior.
--
-- WHY:
-- The current code does read-modify-write on products.current_stock:
--   const prod = await db.getById('products', id);
--   await db.update('products', id, { current_stock: prod.current_stock - qty });
-- Two concurrent operations race; one update silently overwrites the other.
-- Multi-step writes (sale + sale_items + stock + transactions) also have no
-- atomicity — a partial failure leaves the DB inconsistent.
--
-- This migration provides Postgres functions that the client calls via
-- supabase.rpc('fn_name', { ... }). Each function runs in a single
-- transaction, so either all rows commit or none do.
--
-- ROLLOUT PLAN (recommended):
--   1. Apply this migration in a staging project.
--   2. Update client code to call the RPCs (db.adjustStock, db.recordSale).
--   3. Test both demo mode and production paths.
--   4. Apply in production.
--   5. Remove the legacy direct-update code paths once everything is wired
--      through the RPCs.

-- --------------------------------------------------------
-- 1. adjust_stock(product_id, delta) — atomic stock change
-- --------------------------------------------------------
-- Returns the new stock value, or raises an exception if the resulting
-- stock would go negative (i.e. someone else already deducted).
-- Use a positive `delta` for stock-in / restore, negative for sale / issue.

CREATE OR REPLACE FUNCTION adjust_stock(p_product_id INTEGER, p_delta NUMERIC)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
  v_new_stock NUMERIC;
BEGIN
  UPDATE products
     SET current_stock = current_stock + p_delta,
         updated_at = now()
   WHERE id = p_product_id
     AND current_stock + p_delta >= 0
   RETURNING current_stock INTO v_new_stock;

  IF v_new_stock IS NULL THEN
    RAISE EXCEPTION 'Insufficient stock for product %', p_product_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN v_new_stock;
END;
$$;


-- --------------------------------------------------------
-- 2. record_sale(...) — atomic multi-item sale + stock deduction
-- --------------------------------------------------------
-- Inserts the sales row, all sale_items, deducts product stocks (via
-- adjust_stock for the same insufficient-stock guard), and writes
-- inventory_transactions — all in one transaction.
--
-- Input shape for p_items (JSONB):
--   [
--     { "product_id": 7, "quantity": 2, "unit_price": 450 },
--     { "product_id": 13, "quantity": 0.5, "unit_price": 12000 }
--   ]
--
-- Returns the new sale_id.

CREATE OR REPLACE FUNCTION record_sale(
  p_party_id INTEGER,
  p_items JSONB,
  p_payment_status TEXT,
  p_payment_method TEXT,
  p_amount_received NUMERIC,
  p_expected_payment_date DATE,
  p_sale_date DATE,
  p_notes TEXT,
  p_recorded_by UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_sale_id INTEGER;
  v_total NUMERIC := 0;
  v_item JSONB;
  v_product_id INTEGER;
  v_quantity NUMERIC;
  v_unit_price NUMERIC;
  v_line_total NUMERIC;
BEGIN
  -- Compute grand total from items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_total := v_total + ((v_item->>'quantity')::NUMERIC * (v_item->>'unit_price')::NUMERIC);
  END LOOP;

  -- Insert sale header
  INSERT INTO sales (
    party_id, total_amount, payment_status, payment_method,
    amount_received, expected_payment_date, sale_date, notes, recorded_by
  ) VALUES (
    p_party_id, v_total, p_payment_status, p_payment_method,
    COALESCE(p_amount_received, 0), p_expected_payment_date, p_sale_date, p_notes, p_recorded_by
  )
  RETURNING id INTO v_sale_id;

  -- Insert sale_items + deduct stock + log transactions
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := (v_item->>'product_id')::INTEGER;
    v_quantity := (v_item->>'quantity')::NUMERIC;
    v_unit_price := (v_item->>'unit_price')::NUMERIC;
    v_line_total := v_quantity * v_unit_price;

    INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, line_total)
    VALUES (v_sale_id, v_product_id, v_quantity, v_unit_price, v_line_total);

    -- Atomic deduction with insufficient-stock guard
    PERFORM adjust_stock(v_product_id, -v_quantity);

    INSERT INTO inventory_transactions (
      product_id, type, quantity, reference_type, reference_id, performed_by, notes
    ) VALUES (
      v_product_id, 'sale', -v_quantity, 'sale', v_sale_id, p_recorded_by,
      CASE WHEN p_party_id IS NULL THEN 'Sale to walk-in' ELSE 'Sale to party' END
    );
  END LOOP;

  RETURN v_sale_id;
END;
$$;


-- --------------------------------------------------------
-- 3. approve_issue(session_id, approver_id) — admin approves a stock issue
-- --------------------------------------------------------
-- Loops over the session's checkout_items, atomically deducts each product's
-- stock, logs an inventory_transactions row per product, and flips the
-- session status to 'checked_out'. Raises if any item has insufficient stock.

CREATE OR REPLACE FUNCTION approve_issue(p_session_id INTEGER, p_approver_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_item RECORD;
BEGIN
  -- Verify the session is in the right state.
  PERFORM 1 FROM checkout_sessions WHERE id = p_session_id AND status = 'pending_issue';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session % is not pending_issue', p_session_id;
  END IF;

  -- Atomically deduct stock for each item; adjust_stock raises if insufficient.
  FOR v_item IN
    SELECT product_id, checkout_quantity FROM checkout_items WHERE session_id = p_session_id
  LOOP
    PERFORM adjust_stock(v_item.product_id, -v_item.checkout_quantity);

    INSERT INTO inventory_transactions (
      product_id, type, quantity, reference_type, reference_id, performed_by, notes
    ) VALUES (
      v_item.product_id, 'checkout', -v_item.checkout_quantity,
      'checkout_session', p_session_id, p_approver_id, 'Approved issue to seller'
    );
  END LOOP;

  UPDATE checkout_sessions
     SET status = 'checked_out',
         approved_by = p_approver_id,
         approved_at = now()
   WHERE id = p_session_id;
END;
$$;


-- --------------------------------------------------------
-- 4. approve_return(session_id, approver_id) — admin approves a return
-- --------------------------------------------------------
-- Loops over checkout_items, atomically restores stock for the returned
-- quantity, logs an inventory_transactions row per product, and flips the
-- session status to 'checked_in'. Items with NULL or zero checkin_quantity
-- are skipped.

CREATE OR REPLACE FUNCTION approve_return(p_session_id INTEGER, p_approver_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_item RECORD;
BEGIN
  PERFORM 1 FROM checkout_sessions WHERE id = p_session_id AND status = 'pending_approval';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session % is not pending_approval', p_session_id;
  END IF;

  FOR v_item IN
    SELECT product_id, checkin_quantity FROM checkout_items
     WHERE session_id = p_session_id AND COALESCE(checkin_quantity, 0) > 0
  LOOP
    PERFORM adjust_stock(v_item.product_id, v_item.checkin_quantity);

    INSERT INTO inventory_transactions (
      product_id, type, quantity, reference_type, reference_id, performed_by, notes
    ) VALUES (
      v_item.product_id, 'checkin', v_item.checkin_quantity,
      'checkout_session', p_session_id, p_approver_id, 'Approved return — stock restored'
    );
  END LOOP;

  UPDATE checkout_sessions
     SET status = 'checked_in',
         approved_by = p_approver_id,
         approved_at = now()
   WHERE id = p_session_id;
END;
$$;


-- --------------------------------------------------------
-- 5. delete_sale(sale_id, performer_id) — admin deletes a sale, restores stock
-- --------------------------------------------------------
-- Restores stock for every sale_item, logs an inventory_transactions row
-- per product (type='sale_delete' for traceability), then deletes the sale
-- row (sale_items cascade via FK). Note: stock is restored as positive
-- adjust_stock — this never raises, since restore can't go negative.

CREATE OR REPLACE FUNCTION delete_sale(p_sale_id INTEGER, p_performer_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_item RECORD;
BEGIN
  PERFORM 1 FROM sales WHERE id = p_sale_id;
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
      'Sale deleted — stock restored'
    );
  END LOOP;

  -- sale_items cascade-delete via FK
  DELETE FROM sales WHERE id = p_sale_id;
END;
$$;


-- --------------------------------------------------------
-- GRANT execute on the new functions to authenticated users.
-- --------------------------------------------------------
GRANT EXECUTE ON FUNCTION adjust_stock(INTEGER, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION record_sale(INTEGER, JSONB, TEXT, TEXT, NUMERIC, DATE, DATE, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION approve_issue(INTEGER, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION approve_return(INTEGER, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_sale(INTEGER, UUID) TO authenticated;
