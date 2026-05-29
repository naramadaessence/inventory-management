-- ============================================
-- Migration 010: Data Consistency Hardening
-- Run after migrations 006 and 009.
-- ============================================
--
-- Fixes:
--   1. Harden sales RPC validation and permissions.
--   2. Prevent sale delete failures when payment followups reference the bill.
--   3. Move remaining stock-mutating workflows behind transactional RPCs.
--   4. Lock down direct sale_items writes through RLS.
--   5. Revoke direct adjust_stock RPC access; stock changes must go through
--      business-specific functions that write audit rows.

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

-- Followup rows are visit/payment history. Preserve them if the bill is later
-- deleted, but detach them so the sale delete is not FK-blocked.
ALTER TABLE payment_followups
  DROP CONSTRAINT IF EXISTS payment_followups_sale_id_fkey;

ALTER TABLE payment_followups
  ADD CONSTRAINT payment_followups_sale_id_fkey
  FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE SET NULL;

-- Table-level guardrails. NOT VALID avoids blocking this migration on any
-- legacy data; new/updated rows must satisfy the constraints immediately.
ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_current_stock_nonnegative;
ALTER TABLE products
  ADD CONSTRAINT products_current_stock_nonnegative
  CHECK (current_stock >= 0) NOT VALID;

ALTER TABLE sales
  DROP CONSTRAINT IF EXISTS sales_amounts_nonnegative;
ALTER TABLE sales
  ADD CONSTRAINT sales_amounts_nonnegative
  CHECK (total_amount >= 0 AND amount_received >= 0 AND amount_received <= total_amount) NOT VALID;

ALTER TABLE sale_items
  DROP CONSTRAINT IF EXISTS sale_items_positive_quantity;
ALTER TABLE sale_items
  ADD CONSTRAINT sale_items_positive_quantity
  CHECK (quantity > 0) NOT VALID;

ALTER TABLE sale_items
  DROP CONSTRAINT IF EXISTS sale_items_nonnegative_price;
ALTER TABLE sale_items
  ADD CONSTRAINT sale_items_nonnegative_price
  CHECK (unit_price >= 0 AND line_total >= 0) NOT VALID;

ALTER TABLE stock_intakes
  DROP CONSTRAINT IF EXISTS stock_intakes_positive_quantity;
ALTER TABLE stock_intakes
  ADD CONSTRAINT stock_intakes_positive_quantity
  CHECK (quantity > 0) NOT VALID;

ALTER TABLE damage_reports
  DROP CONSTRAINT IF EXISTS damage_reports_positive_quantity;
ALTER TABLE damage_reports
  ADD CONSTRAINT damage_reports_positive_quantity
  CHECK (quantity > 0) NOT VALID;

ALTER TABLE payment_followups
  DROP CONSTRAINT IF EXISTS payment_followups_nonnegative_amount;
ALTER TABLE payment_followups
  ADD CONSTRAINT payment_followups_nonnegative_amount
  CHECK (amount_collected >= 0) NOT VALID;

-- adjust_stock is now an internal primitive. Public UI flows call the
-- business-specific RPCs below, each of which writes the audit row too.
REVOKE ALL ON FUNCTION adjust_stock(INTEGER, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION adjust_stock(INTEGER, NUMERIC) FROM anon;
REVOKE ALL ON FUNCTION adjust_stock(INTEGER, NUMERIC) FROM authenticated;

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
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_recorded_by UUID;
  v_sale_id INTEGER;
  v_total NUMERIC := 0;
  v_amount_received NUMERIC;
  v_item JSONB;
  v_product_id INTEGER;
  v_quantity NUMERIC;
  v_unit_price NUMERIC;
  v_line_total NUMERIC;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_recorded_by IS NOT NULL AND p_recorded_by <> v_actor AND NOT is_admin() THEN
    RAISE EXCEPTION 'Cannot record a sale for another user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_recorded_by := COALESCE(p_recorded_by, v_actor);

  IF p_payment_status NOT IN ('paid', 'partial', 'pending') THEN
    RAISE EXCEPTION 'Invalid payment status'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Sale must have at least one item'
      USING ERRCODE = 'check_violation';
  END IF;

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

  INSERT INTO sales (
    party_id, total_amount, payment_status, payment_method,
    amount_received, expected_payment_date, sale_date, notes, recorded_by
  ) VALUES (
    p_party_id, v_total, p_payment_status, p_payment_method,
    v_amount_received,
    CASE WHEN p_payment_status = 'paid' THEN NULL ELSE p_expected_payment_date END,
    COALESCE(p_sale_date, CURRENT_DATE), p_notes, v_recorded_by
  )
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := (v_item->>'product_id')::INTEGER;
    v_quantity := (v_item->>'quantity')::NUMERIC;
    v_unit_price := (v_item->>'unit_price')::NUMERIC;
    v_line_total := round(v_quantity * v_unit_price, 2);

    INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, line_total)
    VALUES (v_sale_id, v_product_id, v_quantity, v_unit_price, v_line_total);

    PERFORM adjust_stock(v_product_id, -v_quantity);

    INSERT INTO inventory_transactions (
      product_id, type, quantity, reference_type, reference_id, performed_by, notes
    ) VALUES (
      v_product_id, 'sale', -v_quantity, 'sale', v_sale_id, v_recorded_by,
      CASE WHEN p_party_id IS NULL THEN 'Sale to walk-in' ELSE 'Sale to party' END
    );
  END LOOP;

  RETURN v_sale_id;
END;
$$;

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
         notes = p_notes
   WHERE id = p_sale_id;
END;
$$;

CREATE OR REPLACE FUNCTION delete_sale(p_sale_id INTEGER, p_performer_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_item RECORD;
BEGIN
  IF v_actor IS NULL OR NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can delete sales'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_performer_id IS NOT NULL AND p_performer_id <> v_actor THEN
    RAISE EXCEPTION 'Performer must match authenticated user'
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
      'sale', p_sale_id, v_actor,
      'Sale deleted - stock restored'
    );
  END LOOP;

  UPDATE payment_followups
     SET sale_id = NULL
   WHERE sale_id = p_sale_id;

  DELETE FROM sales WHERE id = p_sale_id;
END;
$$;

CREATE OR REPLACE FUNCTION record_payment_followup(
  p_sale_id INTEGER,
  p_party_id INTEGER,
  p_status_update TEXT,
  p_payment_method TEXT,
  p_amount_collected NUMERIC,
  p_expected_payment_date DATE,
  p_notes TEXT,
  p_visited_by UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_sale sales%ROWTYPE;
  v_party_id INTEGER := p_party_id;
  v_amount NUMERIC := round(COALESCE(p_amount_collected, 0), 2);
  v_balance NUMERIC;
  v_new_received NUMERIC;
  v_new_status TEXT;
  v_followup_id INTEGER;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_visited_by IS NOT NULL AND p_visited_by <> v_actor AND NOT is_admin() THEN
    RAISE EXCEPTION 'Cannot log a visit for another user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_status_update NOT IN ('paid', 'partial', 'pending', 'no_payment', 'promised', 'visited') THEN
    RAISE EXCEPTION 'Invalid followup status'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_amount < 0 THEN
    RAISE EXCEPTION 'Amount collected cannot be negative'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_sale_id IS NOT NULL THEN
    SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Sale % does not exist', p_sale_id;
    END IF;

    IF NOT is_admin() AND v_sale.recorded_by <> v_actor THEN
      RAISE EXCEPTION 'Cannot update another seller''s sale'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF v_sale.party_id IS NOT NULL THEN
      IF v_party_id IS NOT NULL AND v_party_id <> v_sale.party_id THEN
        RAISE EXCEPTION 'Followup party must match linked sale party'
          USING ERRCODE = 'check_violation';
      END IF;
      v_party_id := v_sale.party_id;
    END IF;
    v_balance := round(v_sale.total_amount - COALESCE(v_sale.amount_received, 0), 2);

    IF v_amount > v_balance THEN
      RAISE EXCEPTION 'Amount collected cannot exceed sale balance'
        USING ERRCODE = 'check_violation';
    END IF;

    IF p_status_update = 'paid' AND v_amount < v_balance THEN
      RAISE EXCEPTION 'Paid status requires collecting the remaining balance'
        USING ERRCODE = 'check_violation';
    END IF;

    v_new_received := round(COALESCE(v_sale.amount_received, 0) + v_amount, 2);
    v_new_status := CASE
      WHEN v_new_received >= v_sale.total_amount THEN 'paid'
      WHEN v_new_received > 0 OR p_status_update = 'partial' THEN 'partial'
      ELSE 'pending'
    END;

    UPDATE sales
       SET amount_received = v_new_received,
           payment_status = v_new_status,
           payment_method = COALESCE(p_payment_method, payment_method),
           expected_payment_date = CASE WHEN v_new_status = 'paid' THEN NULL ELSE COALESCE(p_expected_payment_date, expected_payment_date) END
     WHERE id = p_sale_id;
  END IF;

  IF v_party_id IS NULL THEN
    RAISE EXCEPTION 'Party is required for a followup'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO payment_followups (
    sale_id, party_id, visited_by, visit_date, status_update,
    payment_method, amount_collected, expected_payment_date, notes
  ) VALUES (
    p_sale_id, v_party_id, COALESCE(p_visited_by, v_actor), now(), p_status_update,
    p_payment_method, v_amount, p_expected_payment_date, p_notes
  )
  RETURNING id INTO v_followup_id;

  RETURN v_followup_id;
END;
$$;

CREATE OR REPLACE FUNCTION set_product_stock(
  p_product_id INTEGER,
  p_new_stock NUMERIC,
  p_performer_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_old_stock NUMERIC;
  v_delta NUMERIC;
BEGIN
  IF v_actor IS NULL OR NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can adjust product stock'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_performer_id IS NOT NULL AND p_performer_id <> v_actor THEN
    RAISE EXCEPTION 'Performer must match authenticated user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_new_stock IS NULL OR p_new_stock < 0 THEN
    RAISE EXCEPTION 'Stock cannot be negative'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT current_stock INTO v_old_stock
    FROM products
   WHERE id = p_product_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % does not exist', p_product_id;
  END IF;

  v_delta := p_new_stock - v_old_stock;

  UPDATE products
     SET current_stock = p_new_stock,
         updated_at = now()
   WHERE id = p_product_id;

  IF v_delta <> 0 THEN
    INSERT INTO inventory_transactions (
      product_id, type, quantity, reference_type, reference_id, performed_by, notes
    ) VALUES (
      p_product_id, 'adjustment', v_delta, 'product', p_product_id, v_actor,
      COALESCE(p_notes, 'Manual stock adjustment')
    );
  END IF;

  RETURN p_new_stock;
END;
$$;

CREATE OR REPLACE FUNCTION record_stock_intake(
  p_product_id INTEGER,
  p_quantity NUMERIC,
  p_supplier TEXT,
  p_notes TEXT,
  p_received_by UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_intake_id INTEGER;
BEGIN
  IF v_actor IS NULL OR NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can record stock intake'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_received_by IS NOT NULL AND p_received_by <> v_actor THEN
    RAISE EXCEPTION 'Receiver must match authenticated user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO stock_intakes (product_id, quantity, supplier, notes, received_by)
  VALUES (p_product_id, p_quantity, p_supplier, p_notes, v_actor)
  RETURNING id INTO v_intake_id;

  PERFORM adjust_stock(p_product_id, p_quantity);

  INSERT INTO inventory_transactions (
    product_id, type, quantity, reference_type, reference_id, performed_by, notes
  ) VALUES (
    p_product_id, 'stock_in', p_quantity, 'stock_intake', v_intake_id, v_actor,
    COALESCE(p_notes, 'Stock intake')
  );

  RETURN v_intake_id;
END;
$$;

CREATE OR REPLACE FUNCTION record_damage_loss(
  p_product_id INTEGER,
  p_damage_type TEXT,
  p_quantity NUMERIC,
  p_reason TEXT,
  p_report_date DATE,
  p_reported_by UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_report_id INTEGER;
BEGIN
  IF v_actor IS NULL OR NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can report damage/loss'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_reported_by IS NOT NULL AND p_reported_by <> v_actor THEN
    RAISE EXCEPTION 'Reporter must match authenticated user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_damage_type NOT IN ('damaged', 'lost', 'expired') THEN
    RAISE EXCEPTION 'Invalid damage type'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO damage_reports (product_id, damage_type, quantity, reason, report_date, reported_by)
  VALUES (p_product_id, p_damage_type, p_quantity, p_reason, COALESCE(p_report_date, CURRENT_DATE), v_actor)
  RETURNING id INTO v_report_id;

  PERFORM adjust_stock(p_product_id, -p_quantity);

  INSERT INTO inventory_transactions (
    product_id, type, quantity, reference_type, reference_id, performed_by, notes
  ) VALUES (
    p_product_id, 'damage', -p_quantity, 'damage_report', v_report_id, v_actor,
    p_damage_type || ': ' || COALESCE(p_reason, '')
  );

  RETURN v_report_id;
END;
$$;

CREATE OR REPLACE FUNCTION create_rental(
  p_product_id INTEGER,
  p_party_id INTEGER,
  p_quantity INTEGER,
  p_rental_date DATE,
  p_expected_return_date DATE,
  p_rent_amount NUMERIC,
  p_notes TEXT,
  p_performer_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_rental_id INTEGER;
BEGIN
  IF v_actor IS NULL OR NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can create rentals'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_performer_id IS NOT NULL AND p_performer_id <> v_actor THEN
    RAISE EXCEPTION 'Performer must match authenticated user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO rentals (
    product_id, party_id, quantity, rental_date, expected_return_date,
    actual_return_date, rent_amount, status, notes
  ) VALUES (
    p_product_id, p_party_id, p_quantity, COALESCE(p_rental_date, CURRENT_DATE),
    p_expected_return_date, NULL, COALESCE(p_rent_amount, 0), 'active', p_notes
  )
  RETURNING id INTO v_rental_id;

  PERFORM adjust_stock(p_product_id, -p_quantity);

  INSERT INTO inventory_transactions (
    product_id, type, quantity, reference_type, reference_id, performed_by, notes
  ) VALUES (
    p_product_id, 'rental_out', -p_quantity, 'rental', v_rental_id, v_actor, 'Rental out'
  );

  RETURN v_rental_id;
END;
$$;

CREATE OR REPLACE FUNCTION return_rental(p_rental_id INTEGER, p_performer_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_rental RECORD;
BEGIN
  IF v_actor IS NULL OR NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can return rentals'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_performer_id IS NOT NULL AND p_performer_id <> v_actor THEN
    RAISE EXCEPTION 'Performer must match authenticated user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_rental
    FROM rentals
   WHERE id = p_rental_id
     AND status = 'active'
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active rental % does not exist', p_rental_id;
  END IF;

  UPDATE rentals
     SET status = 'returned',
         actual_return_date = CURRENT_DATE
   WHERE id = p_rental_id;

  PERFORM adjust_stock(v_rental.product_id, COALESCE(v_rental.quantity, 1));

  INSERT INTO inventory_transactions (
    product_id, type, quantity, reference_type, reference_id, performed_by, notes
  ) VALUES (
    v_rental.product_id, 'rental_return', COALESCE(v_rental.quantity, 1),
    'rental', p_rental_id, v_actor, 'Rental returned'
  );
END;
$$;

CREATE OR REPLACE FUNCTION admin_issue_stock(
  p_seller_id UUID,
  p_items JSONB,
  p_approver_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_session_id INTEGER;
  v_item JSONB;
  v_product_id INTEGER;
  v_quantity NUMERIC;
BEGIN
  IF v_actor IS NULL OR NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can issue stock immediately'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_approver_id IS NOT NULL AND p_approver_id <> v_actor THEN
    RAISE EXCEPTION 'Approver must match authenticated user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_seller_id IS NULL THEN
    RAISE EXCEPTION 'Seller is required'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one checkout item is required'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO checkout_sessions (
    seller_id, checkout_time, checkin_time, status, approved_by, approved_at, notes
  ) VALUES (
    p_seller_id, now(), NULL, 'checked_out', v_actor, now(), ''
  )
  RETURNING id INTO v_session_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := (v_item->>'product_id')::INTEGER;
    v_quantity := (v_item->>'quantity')::NUMERIC;

    IF v_product_id IS NULL OR v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'Invalid checkout item'
        USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO checkout_items (
      session_id, product_id, checkout_quantity, checkin_quantity, is_flagged, flag_reason
    ) VALUES (
      v_session_id, v_product_id, v_quantity, NULL, false, NULL
    );

    PERFORM adjust_stock(v_product_id, -v_quantity);

    INSERT INTO inventory_transactions (
      product_id, type, quantity, reference_type, reference_id, performed_by, notes
    ) VALUES (
      v_product_id, 'checkout', -v_quantity,
      'checkout_session', v_session_id, v_actor, 'Issued to seller'
    );
  END LOOP;

  RETURN v_session_id;
END;
$$;

CREATE OR REPLACE FUNCTION approve_issue(p_session_id INTEGER, p_approver_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_item RECORD;
BEGIN
  IF v_actor IS NULL OR NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can approve issues'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_approver_id IS NOT NULL AND p_approver_id <> v_actor THEN
    RAISE EXCEPTION 'Approver must match authenticated user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM 1 FROM checkout_sessions WHERE id = p_session_id AND status = 'pending_issue' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session % is not pending_issue', p_session_id;
  END IF;

  FOR v_item IN
    SELECT product_id, checkout_quantity FROM checkout_items WHERE session_id = p_session_id
  LOOP
    PERFORM adjust_stock(v_item.product_id, -v_item.checkout_quantity);

    INSERT INTO inventory_transactions (
      product_id, type, quantity, reference_type, reference_id, performed_by, notes
    ) VALUES (
      v_item.product_id, 'checkout', -v_item.checkout_quantity,
      'checkout_session', p_session_id, v_actor, 'Approved issue to seller'
    );
  END LOOP;

  UPDATE checkout_sessions
     SET status = 'checked_out',
         approved_by = v_actor,
         approved_at = now()
   WHERE id = p_session_id;
END;
$$;

CREATE OR REPLACE FUNCTION approve_return(p_session_id INTEGER, p_approver_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_item RECORD;
BEGIN
  IF v_actor IS NULL OR NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can approve returns'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_approver_id IS NOT NULL AND p_approver_id <> v_actor THEN
    RAISE EXCEPTION 'Approver must match authenticated user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM 1 FROM checkout_sessions WHERE id = p_session_id AND status = 'pending_approval' FOR UPDATE;
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
      'checkout_session', p_session_id, v_actor, 'Approved return - stock restored'
    );
  END LOOP;

  UPDATE checkout_sessions
     SET status = 'checked_in',
         approved_by = v_actor,
         approved_at = now()
   WHERE id = p_session_id;
END;
$$;

-- Tighten direct table API access. The RPCs above own sale/followup line writes.
DO $policy_cleanup$
DECLARE
  v_policy RECORD;
BEGIN
  FOR v_policy IN
    SELECT tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('sales', 'sale_items', 'payment_followups')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_policy.policyname, v_policy.tablename);
  END LOOP;
END
$policy_cleanup$;

CREATE POLICY "Admins manage sales" ON sales
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "Sellers read own sales" ON sales
  FOR SELECT USING (is_admin() OR recorded_by = auth.uid());

CREATE POLICY "Read visible sale_items" ON sale_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM sales
       WHERE sales.id = sale_items.sale_id
         AND (is_admin() OR sales.recorded_by = auth.uid())
    )
  );

CREATE POLICY "Admins manage followups" ON payment_followups
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "Users read own followups" ON payment_followups
  FOR SELECT USING (is_admin() OR visited_by = auth.uid());

REVOKE ALL ON FUNCTION record_sale(INTEGER, JSONB, TEXT, TEXT, NUMERIC, DATE, DATE, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION update_sale(INTEGER, INTEGER, JSONB, TEXT, TEXT, NUMERIC, DATE, DATE, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION delete_sale(INTEGER, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION record_payment_followup(INTEGER, INTEGER, TEXT, TEXT, NUMERIC, DATE, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION set_product_stock(INTEGER, NUMERIC, UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION record_stock_intake(INTEGER, NUMERIC, TEXT, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION record_damage_loss(INTEGER, TEXT, NUMERIC, TEXT, DATE, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION create_rental(INTEGER, INTEGER, INTEGER, DATE, DATE, NUMERIC, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION return_rental(INTEGER, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION admin_issue_stock(UUID, JSONB, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION approve_issue(INTEGER, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION approve_return(INTEGER, UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION record_sale(INTEGER, JSONB, TEXT, TEXT, NUMERIC, DATE, DATE, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION update_sale(INTEGER, INTEGER, JSONB, TEXT, TEXT, NUMERIC, DATE, DATE, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_sale(INTEGER, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION record_payment_followup(INTEGER, INTEGER, TEXT, TEXT, NUMERIC, DATE, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION set_product_stock(INTEGER, NUMERIC, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION record_stock_intake(INTEGER, NUMERIC, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION record_damage_loss(INTEGER, TEXT, NUMERIC, TEXT, DATE, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION create_rental(INTEGER, INTEGER, INTEGER, DATE, DATE, NUMERIC, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION return_rental(INTEGER, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_issue_stock(UUID, JSONB, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION approve_issue(INTEGER, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION approve_return(INTEGER, UUID) TO authenticated;

COMMIT;
