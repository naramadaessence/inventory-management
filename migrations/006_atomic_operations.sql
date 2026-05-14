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
-- TODO: Future RPCs (same pattern, not yet drafted)
-- --------------------------------------------------------
-- approve_issue(session_id, approver_id)   — deduct stock + flip status
-- approve_return(session_id, approver_id)  — restore stock + flip status
-- delete_sale(sale_id)                     — restore stock + cascade delete
--
-- Each should:
--   1. Update its primary table (checkout_sessions / sales)
--   2. Loop over related items, calling adjust_stock for each
--   3. Insert inventory_transactions for the audit trail
--
-- Since RLS still applies to functions called by the client, these need to
-- run as SECURITY DEFINER or the RLS policies must allow the calling user
-- to make the underlying UPDATEs/INSERTs. The simplest path is to mark
-- these functions SECURITY DEFINER and add explicit role checks inside.

-- --------------------------------------------------------
-- GRANT execute on the new functions to authenticated users.
-- --------------------------------------------------------
GRANT EXECUTE ON FUNCTION adjust_stock(INTEGER, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION record_sale(INTEGER, JSONB, TEXT, TEXT, NUMERIC, DATE, DATE, TEXT, UUID) TO authenticated;
