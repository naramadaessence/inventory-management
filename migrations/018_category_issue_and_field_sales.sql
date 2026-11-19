-- ============================================
-- Migration 018: "Any <category>" issue lines and bills from field stock
-- Run after migration 017. Run ONCE in the Supabase SQL editor.
-- ============================================
--
-- Contract: knowledge-base/category-issue.md. Demo-mode mirror of every
-- function below: js/supabase.js (demoRpc). Shared client rules:
-- js/utils/field-stock.js.
--
-- 1. "Any" issue lines. A checkout_items row with product_id NULL and
--    category_id set means "N of any product in this category" (e.g. any 10
--    refills). Issuing it does NOT change product stock: the quantity is HELD
--    against the category (Σ category stock − held = free on the shelf) while
--    the session is checked_out / pending_approval.
-- 2. On the return the staff member names the type of every piece:
--    per product Returned + Used (usage lines) + Sold (from linked bills,
--    computed here) + Lost must add up to exactly the issued quantity.
--    submit_return writes one child checkout_items row per product
--    (parent_item_id = the Any line); approve_return takes stock off each
--    product exactly once (checkout −taken, checkin +returned).
-- 3. Bills from field stock. record_sale(p_checkout_session_id) links a bill
--    to the staff member's open session and does NOT deduct warehouse stock;
--    the session's return books it as "Sold" usage. update_sale / delete_sale
--    respect the link (no stock moves; item changes locked once the return
--    is submitted). This settles ISSUE-023 for bills linked this way.
--
-- Signature changes: record_sale gains p_checkout_session_id (11 args); the
-- old 10-arg version is dropped. All other functions keep their signatures.

BEGIN;

-- --------------------------------------------------------
-- 1. Columns
-- --------------------------------------------------------
ALTER TABLE checkout_items
  ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES categories(id),
  ADD COLUMN IF NOT EXISTS parent_item_id INTEGER REFERENCES checkout_items(id) ON DELETE CASCADE;

-- A line is either a product line or an "Any <category>" line. Child rows
-- (parent_item_id set) are always product rows. NOT VALID: legacy rows are
-- not re-checked; new and updated rows must satisfy it.
ALTER TABLE checkout_items
  DROP CONSTRAINT IF EXISTS checkout_items_product_or_category;
ALTER TABLE checkout_items
  ADD CONSTRAINT checkout_items_product_or_category
  CHECK (product_id IS NOT NULL OR (category_id IS NOT NULL AND parent_item_id IS NULL)) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_checkout_items_parent ON checkout_items(parent_item_id);
CREATE INDEX IF NOT EXISTS idx_checkout_items_category ON checkout_items(category_id) WHERE product_id IS NULL;

ALTER TABLE checkout_usage
  ADD COLUMN IF NOT EXISTS sale_id INTEGER REFERENCES sales(id) ON DELETE SET NULL;
ALTER TABLE checkout_usage
  DROP CONSTRAINT IF EXISTS checkout_usage_reason_check;
ALTER TABLE checkout_usage
  ADD CONSTRAINT checkout_usage_reason_check
  CHECK (reason IN ('customer_service', 'installation', 'other', 'sold'));

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS checkout_session_id INTEGER REFERENCES checkout_sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sales_checkout_session ON sales(checkout_session_id) WHERE checkout_session_id IS NOT NULL;

-- --------------------------------------------------------
-- 2. RLS: sellers may only add lines to their own *pending request*, and
--    never child rows (those are written by submit_return only).
-- --------------------------------------------------------
DROP POLICY IF EXISTS "Sellers create own items" ON checkout_items;
CREATE POLICY "Sellers create own items" ON checkout_items
  FOR INSERT WITH CHECK (
    parent_item_id IS NULL AND EXISTS (
      SELECT 1 FROM checkout_sessions
       WHERE id = checkout_items.session_id
         AND seller_id = auth.uid()
         AND status = 'pending_issue'
    )
  );

-- --------------------------------------------------------
-- 3. Helpers
-- --------------------------------------------------------

-- Quantity of a category held by open "Any" lines (stock still counted in
-- products.current_stock but physically out with staff).
CREATE OR REPLACE FUNCTION checkout_held_qty(p_category_id INTEGER, p_exclude_session INTEGER DEFAULT NULL)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(ci.checkout_quantity), 0)
    FROM checkout_items ci
    JOIN checkout_sessions s ON s.id = ci.session_id
   WHERE ci.product_id IS NULL
     AND ci.parent_item_id IS NULL
     AND ci.category_id = p_category_id
     AND s.status IN ('checked_out', 'pending_approval')
     AND (p_exclude_session IS NULL OR s.id <> p_exclude_session);
$$;

-- Held quantity per category, for the UI (sellers cannot see other staff's
-- sessions through RLS).
CREATE OR REPLACE FUNCTION get_category_holds()
RETURNS TABLE (category_id INTEGER, held NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ci.category_id, SUM(ci.checkout_quantity)
    FROM checkout_items ci
    JOIN checkout_sessions s ON s.id = ci.session_id
   WHERE auth.uid() IS NOT NULL
     AND ci.product_id IS NULL
     AND ci.parent_item_id IS NULL
     AND s.status IN ('checked_out', 'pending_approval')
   GROUP BY ci.category_id;
$$;

-- Validates a session's issue lines against stock BEFORE any deduction:
--   * Any lines: category exists, qty > 0, whole pieces for unit categories,
--     at most one Any line per category.
--   * Per product: Σ product lines ≤ current_stock.
--   * Per category touched: Σ lines (product + Any) ≤ Σ category stock − held
--     by other sessions.
-- Locks the categories involved so two issues cannot both take the same
-- free stock.
CREATE OR REPLACE FUNCTION check_issue_availability(p_session_id INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
BEGIN
  FOR v_row IN
    SELECT ci.id, ci.checkout_quantity AS qty, ci.category_id, c.name AS cat_name, c.type AS cat_type
      FROM checkout_items ci
      LEFT JOIN categories c ON c.id = ci.category_id
     WHERE ci.session_id = p_session_id
       AND ci.parent_item_id IS NULL
       AND ci.product_id IS NULL
  LOOP
    IF v_row.category_id IS NULL OR v_row.cat_name IS NULL THEN
      RAISE EXCEPTION 'Invalid issue line: choose a product or a category'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_row.qty IS NULL OR v_row.qty <= 0 THEN
      RAISE EXCEPTION 'Quantity for Any % must be greater than zero', v_row.cat_name
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_row.cat_type = 'unit' AND v_row.qty <> trunc(v_row.qty) THEN
      RAISE EXCEPTION 'Any % must be whole pieces', v_row.cat_name
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  SELECT c.name AS cat_name INTO v_row
    FROM checkout_items ci
    JOIN categories c ON c.id = ci.category_id
   WHERE ci.session_id = p_session_id AND ci.product_id IS NULL AND ci.parent_item_id IS NULL
   GROUP BY c.id, c.name
  HAVING count(*) > 1
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Any % is listed twice; combine it into one line', v_row.cat_name
      USING ERRCODE = 'check_violation';
  END IF;

  -- A product line counts against its product's category even if the row
  -- also carries a category_id (sellers insert request rows directly).
  PERFORM 1 FROM categories
   WHERE id IN (
     SELECT COALESCE(p.category_id, ci.category_id)
       FROM checkout_items ci
       LEFT JOIN products p ON p.id = ci.product_id
      WHERE ci.session_id = p_session_id AND ci.parent_item_id IS NULL
   )
   ORDER BY id
   FOR UPDATE;

  FOR v_row IN
    SELECT p.id, p.name, COALESCE(p.current_stock, 0) AS stock, SUM(ci.checkout_quantity) AS qty
      FROM checkout_items ci
      JOIN products p ON p.id = ci.product_id
     WHERE ci.session_id = p_session_id AND ci.parent_item_id IS NULL
     GROUP BY p.id, p.name, p.current_stock
  LOOP
    IF v_row.qty > v_row.stock + 1e-9 THEN
      RAISE EXCEPTION 'Insufficient stock for %', v_row.name
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  FOR v_row IN
    SELECT c.id, c.name, c.type,
           (SELECT COALESCE(SUM(GREATEST(p.current_stock, 0)), 0) FROM products p WHERE p.category_id = c.id) AS stock,
           checkout_held_qty(c.id, p_session_id) AS held,
           (SELECT COALESCE(SUM(ci.checkout_quantity), 0)
              FROM checkout_items ci
              LEFT JOIN products p ON p.id = ci.product_id
             WHERE ci.session_id = p_session_id
               AND ci.parent_item_id IS NULL
               AND COALESCE(p.category_id, ci.category_id) = c.id) AS wanted
      FROM categories c
     WHERE c.id IN (
       SELECT COALESCE(p.category_id, ci.category_id)
         FROM checkout_items ci
         LEFT JOIN products p ON p.id = ci.product_id
        WHERE ci.session_id = p_session_id AND ci.parent_item_id IS NULL
     )
  LOOP
    IF v_row.wanted > v_row.stock - v_row.held + 1e-9 THEN
      RAISE EXCEPTION 'Not enough % in the warehouse: % free (% out with staff as Any), % asked',
        v_row.name,
        trim_scale(GREATEST(v_row.stock - v_row.held, 0)),
        trim_scale(v_row.held),
        trim_scale(v_row.wanted)
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
END;
$$;

-- A field-stock bill may only sell what the session issued:
--   per product: sold beyond the product's own lines must come from an Any
--   line of its category; per category: that overflow ≤ the Any quantity.
CREATE OR REPLACE FUNCTION check_field_sale_capacity(p_session_id INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
BEGIN
  FOR v_row IN
    WITH sold AS (
      SELECT si.product_id, SUM(si.quantity) AS qty
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
       WHERE s.checkout_session_id = p_session_id
       GROUP BY si.product_id
    ), specific AS (
      SELECT product_id, SUM(checkout_quantity) AS qty
        FROM checkout_items
       WHERE session_id = p_session_id AND parent_item_id IS NULL AND product_id IS NOT NULL
       GROUP BY product_id
    )
    SELECT p.id, p.name, p.category_id, sold.qty AS sold_qty,
           GREATEST(sold.qty - COALESCE(specific.qty, 0), 0) AS overflow,
           EXISTS (
             SELECT 1 FROM checkout_items a
              WHERE a.session_id = p_session_id AND a.product_id IS NULL
                AND a.parent_item_id IS NULL AND a.category_id = p.category_id
           ) AS has_any
      FROM sold
      JOIN products p ON p.id = sold.product_id
      LEFT JOIN specific ON specific.product_id = sold.product_id
  LOOP
    IF v_row.overflow > 1e-9 AND NOT v_row.has_any THEN
      RAISE EXCEPTION '% was not issued to this staff member (or more is billed than was issued)', v_row.name
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  FOR v_row IN
    WITH sold AS (
      SELECT si.product_id, SUM(si.quantity) AS qty
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
       WHERE s.checkout_session_id = p_session_id
       GROUP BY si.product_id
    ), specific AS (
      SELECT product_id, SUM(checkout_quantity) AS qty
        FROM checkout_items
       WHERE session_id = p_session_id AND parent_item_id IS NULL AND product_id IS NOT NULL
       GROUP BY product_id
    ), overflow AS (
      SELECT p.category_id, SUM(GREATEST(sold.qty - COALESCE(specific.qty, 0), 0)) AS qty
        FROM sold
        JOIN products p ON p.id = sold.product_id
        LEFT JOIN specific ON specific.product_id = sold.product_id
       GROUP BY p.category_id
    )
    SELECT c.name, o.qty AS overflow, a.checkout_quantity AS any_qty
      FROM overflow o
      JOIN checkout_items a
        ON a.session_id = p_session_id AND a.product_id IS NULL
       AND a.parent_item_id IS NULL AND a.category_id = o.category_id
      JOIN categories c ON c.id = o.category_id
  LOOP
    IF v_row.overflow > v_row.any_qty + 1e-9 THEN
      RAISE EXCEPTION 'Bills sell % from Any %, but only % were issued',
        trim_scale(v_row.overflow), v_row.name, trim_scale(v_row.any_qty)
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
END;
$$;

-- Session a field bill may be linked to: must be checked_out and belong to
-- the actor (or the actor is an admin). Returns the session row.
CREATE OR REPLACE FUNCTION assert_open_field_session(p_session_id INTEGER)
RETURNS checkout_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session checkout_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_session FROM checkout_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session % not found', p_session_id;
  END IF;
  IF NOT is_admin() AND v_session.seller_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'You can only bill from your own field stock'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_session.status <> 'checked_out' THEN
    RAISE EXCEPTION 'Field stock of session % is not open (its return was already submitted)', p_session_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN v_session;
END;
$$;

-- --------------------------------------------------------
-- 4. Issue: admin_issue_stock / approve_issue
--    p_items: [{ "product_id": 7, "quantity": 2 } | { "category_id": 3, "quantity": 10 }]
-- --------------------------------------------------------
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
  v_category_id INTEGER;
  v_quantity NUMERIC;
  v_line RECORD;
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
    BEGIN
      v_product_id := NULLIF(v_item->>'product_id', '')::INTEGER;
      v_category_id := NULLIF(v_item->>'category_id', '')::INTEGER;
      v_quantity := (v_item->>'quantity')::NUMERIC;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Invalid checkout item'
        USING ERRCODE = 'check_violation';
    END;

    IF v_quantity IS NULL OR v_quantity <= 0
       OR (v_product_id IS NULL AND v_category_id IS NULL)
       OR (v_product_id IS NOT NULL AND v_category_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Invalid checkout item'
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_product_id IS NOT NULL THEN
      PERFORM 1 FROM products WHERE id = v_product_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Product % does not exist', v_product_id
          USING ERRCODE = 'foreign_key_violation';
      END IF;
    END IF;

    INSERT INTO checkout_items (
      session_id, product_id, category_id, checkout_quantity, checkin_quantity, is_flagged, flag_reason
    ) VALUES (
      v_session_id, v_product_id, v_category_id, v_quantity, NULL, false, NULL
    );
  END LOOP;

  PERFORM check_issue_availability(v_session_id);

  -- Product lines leave stock now; Any lines are held until the return.
  FOR v_line IN
    SELECT product_id, checkout_quantity FROM checkout_items
     WHERE session_id = v_session_id AND product_id IS NOT NULL
     ORDER BY id
  LOOP
    PERFORM adjust_stock(v_line.product_id, -v_line.checkout_quantity);

    INSERT INTO inventory_transactions (
      product_id, type, quantity, reference_type, reference_id, performed_by, notes
    ) VALUES (
      v_line.product_id, 'checkout', -v_line.checkout_quantity,
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

  PERFORM check_issue_availability(p_session_id);

  FOR v_item IN
    SELECT product_id, checkout_quantity FROM checkout_items
     WHERE session_id = p_session_id AND product_id IS NOT NULL AND parent_item_id IS NULL
     ORDER BY id
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

-- --------------------------------------------------------
-- 5. Sales from field stock
-- --------------------------------------------------------
DROP FUNCTION IF EXISTS record_sale(INTEGER, JSONB, TEXT, TEXT, NUMERIC, DATE, DATE, TEXT, UUID, TEXT);

CREATE OR REPLACE FUNCTION record_sale(
  p_party_id INTEGER,
  p_items JSONB,
  p_payment_status TEXT,
  p_payment_method TEXT,
  p_amount_received NUMERIC,
  p_expected_payment_date DATE,
  p_sale_date DATE,
  p_notes TEXT,
  p_recorded_by UUID,
  p_sale_type TEXT DEFAULT 'gst',
  p_checkout_session_id INTEGER DEFAULT NULL
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
  v_sale_type TEXT;
  v_session checkout_sessions%ROWTYPE;
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

  IF p_checkout_session_id IS NOT NULL THEN
    SELECT * INTO v_session FROM assert_open_field_session(p_checkout_session_id);
    -- The staff member made the sale; this also keeps the bill visible to
    -- them (sellers read the bills they recorded).
    v_recorded_by := v_session.seller_id;
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
    amount_received, expected_payment_date, sale_date, notes, recorded_by, sale_type,
    checkout_session_id
  ) VALUES (
    p_party_id, v_total, p_payment_status, p_payment_method,
    v_amount_received,
    CASE WHEN p_payment_status = 'paid' THEN NULL ELSE p_expected_payment_date END,
    COALESCE(p_sale_date, CURRENT_DATE), p_notes, v_recorded_by, v_sale_type,
    p_checkout_session_id
  )
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := (v_item->>'product_id')::INTEGER;
    v_quantity := (v_item->>'quantity')::NUMERIC;
    v_unit_price := (v_item->>'unit_price')::NUMERIC;
    v_line_total := round(v_quantity * v_unit_price, 2);

    INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, line_total)
    VALUES (v_sale_id, v_product_id, v_quantity, v_unit_price, v_line_total);

    -- Field-stock bills: stock already left with the staff member; the
    -- session's return books it as Sold.
    IF p_checkout_session_id IS NULL THEN
      PERFORM adjust_stock(v_product_id, -v_quantity);

      INSERT INTO inventory_transactions (
        product_id, type, quantity, reference_type, reference_id, performed_by, notes
      ) VALUES (
        v_product_id, 'sale', -v_quantity, 'sale', v_sale_id, v_recorded_by,
        CASE WHEN p_party_id IS NULL THEN 'Sale to walk-in' ELSE 'Sale to party' END
      );
    END IF;
  END LOOP;

  IF p_checkout_session_id IS NOT NULL THEN
    PERFORM check_field_sale_capacity(p_checkout_session_id);
  END IF;

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
  v_sale sales%ROWTYPE;
  v_session_status TEXT;
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
  v_items_changed BOOLEAN;
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

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale % does not exist', p_sale_id;
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
  END LOOP;

  IF v_sale.checkout_session_id IS NOT NULL THEN
    SELECT status INTO v_session_status FROM checkout_sessions WHERE id = v_sale.checkout_session_id FOR UPDATE;

    -- Same products and quantities (prices may change)?
    SELECT EXISTS (
      SELECT product_id, SUM(qty) FROM (
        SELECT product_id, quantity AS qty FROM sale_items WHERE sale_id = p_sale_id
        UNION ALL
        SELECT (e->>'product_id')::INTEGER, -((e->>'quantity')::NUMERIC) FROM jsonb_array_elements(p_items) e
      ) d
      GROUP BY product_id
      HAVING abs(SUM(qty)) > 1e-9
    ) INTO v_items_changed;

    IF v_items_changed AND v_session_status = 'pending_approval' THEN
      RAISE EXCEPTION 'Bill #% is part of a submitted field return. Send the return back first, then change its items', p_sale_id
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_items_changed AND v_session_status IS DISTINCT FROM 'checked_out' THEN
      RAISE EXCEPTION 'Bill #% was settled in an approved field return; its products and quantities can no longer change', p_sale_id
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
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
  END IF;

  DELETE FROM sale_items WHERE sale_id = p_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := (v_item->>'product_id')::INTEGER;
    v_quantity := (v_item->>'quantity')::NUMERIC;
    v_unit_price := (v_item->>'unit_price')::NUMERIC;

    v_line_total := round(v_quantity * v_unit_price, 2);
    v_total := v_total + v_line_total;

    INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, line_total)
    VALUES (p_sale_id, v_product_id, v_quantity, v_unit_price, v_line_total);

    IF v_sale.checkout_session_id IS NULL THEN
      PERFORM adjust_stock(v_product_id, -v_quantity);

      INSERT INTO inventory_transactions (
        product_id, type, quantity, reference_type, reference_id, performed_by, notes
      ) VALUES (
        v_product_id, 'sale_edit', -v_quantity,
        'sale', p_sale_id, v_actor,
        'Sale edited - new item stock deducted'
      );
    END IF;
  END LOOP;

  IF v_sale.checkout_session_id IS NOT NULL AND v_session_status = 'checked_out' THEN
    PERFORM check_field_sale_capacity(v_sale.checkout_session_id);
  END IF;

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

CREATE OR REPLACE FUNCTION delete_sale(p_sale_id INTEGER, p_performer_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_sale sales%ROWTYPE;
  v_session_status TEXT;
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

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale % does not exist', p_sale_id;
  END IF;

  IF v_sale.checkout_session_id IS NOT NULL THEN
    SELECT status INTO v_session_status FROM checkout_sessions WHERE id = v_sale.checkout_session_id FOR UPDATE;
    IF v_session_status = 'pending_approval' THEN
      RAISE EXCEPTION 'Bill #% is part of a submitted field return. Send the return back first, then delete the bill', p_sale_id
        USING ERRCODE = 'check_violation';
    END IF;
    -- Open session: the pieces are still with the staff member.
    -- Approved session: stock was settled by the return. Either way no stock moves.
  ELSE
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
  END IF;

  UPDATE payment_followups
     SET sale_id = NULL
   WHERE sale_id = p_sale_id;

  DELETE FROM sales WHERE id = p_sale_id;
END;
$$;

-- --------------------------------------------------------
-- 6. submit_return
--    p_items: one entry per issued line (child rows are rebuilt here):
--      product line: { "item_id": 1, "returned_quantity": 2,
--                      "usage": [{ "reason", "quantity", "party_id"?, "notes"? }] }
--      Any line:     { "item_id": 2, "breakdown": [
--                        { "product_id": 7, "returned_quantity": 3, "lost_quantity": 0,
--                          "usage": [...] }, ... ] }
--    "sold" usage is never sent: it is computed from the bills linked to the
--    session (sales.checkout_session_id) and allocated to the product's own
--    lines first, then to the Any line of its category.
--    Any line: Σ(returned + used + sold + lost) must equal the issued
--    quantity exactly. Lost above the tolerance is a mismatch to classify.
--    Returns { "has_discrepancy": bool }.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION submit_return(
  p_session_id INTEGER,
  p_items JSONB,
  p_notes TEXT DEFAULT NULL,
  p_submitted_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_session checkout_sessions%ROWTYPE;
  v_item_count INTEGER;
  v_input JSONB;
  v_entry JSONB;
  v_usage JSONB;
  v_item checkout_items%ROWTYPE;
  v_product products%ROWTYPE;
  v_category categories%ROWTYPE;
  v_is_machine BOOLEAN;
  v_seen INTEGER[];
  v_seen_products INTEGER[];
  v_item_id INTEGER;
  v_entry_product INTEGER;
  v_child_id INTEGER;
  v_returned NUMERIC;
  v_lost NUMERIC;
  v_used NUMERIC;
  v_sold NUMERIC;
  v_u_qty NUMERIC;
  v_u_reason TEXT;
  v_u_party INTEGER;
  v_difference NUMERIC;
  v_consumed NUMERIC;
  v_limit NUMERIC;
  v_tolerance NUMERIC;
  v_mismatch BOOLEAN;
  v_reasons TEXT[];
  v_flag_reason TEXT;
  v_has_discrepancy BOOLEAN := false;
  v_sum_returned NUMERIC;
  v_sum_used NUMERIC;
  v_sum_lost NUMERIC;
  v_accounted NUMERIC;
  v_take NUMERIC;
  v_sold_row RECORD;
  v_line RECORD;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_submitted_by IS NOT NULL AND p_submitted_by <> v_actor THEN
    RAISE EXCEPTION 'Submitter must match authenticated user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_session FROM checkout_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session % not found', p_session_id;
  END IF;

  IF NOT is_admin() AND v_session.seller_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Only the assigned staff member or an admin can submit this return'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_session.status <> 'checked_out' THEN
    RAISE EXCEPTION 'Session % is not checked out', p_session_id;
  END IF;

  PERFORM 1 FROM checkout_items WHERE session_id = p_session_id FOR UPDATE;

  -- Re-submission after "Send back": rebuild usage and child rows.
  DELETE FROM checkout_usage WHERE session_id = p_session_id;
  DELETE FROM checkout_items WHERE session_id = p_session_id AND parent_item_id IS NOT NULL;

  SELECT count(*) INTO v_item_count FROM checkout_items WHERE session_id = p_session_id;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) <> v_item_count THEN
    RAISE EXCEPTION 'Every issued item must be included in the return'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Sold quantities from linked bills, to be allocated: product lines first.
  CREATE TEMP TABLE IF NOT EXISTS _sold_left (
    product_id INTEGER, sale_id INTEGER, party_id INTEGER, qty NUMERIC
  ) ON COMMIT DROP;
  DELETE FROM _sold_left;
  INSERT INTO _sold_left (product_id, sale_id, party_id, qty)
  SELECT si.product_id, s.id, s.party_id, SUM(si.quantity)
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
   WHERE s.checkout_session_id = p_session_id
   GROUP BY si.product_id, s.id, s.party_id;

  v_seen := '{}';
  FOR v_input IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    BEGIN
      v_item_id := (v_input->>'item_id')::INTEGER;
    EXCEPTION WHEN others THEN
      v_item_id := NULL;
    END;

    SELECT * INTO v_item FROM checkout_items
     WHERE id = v_item_id AND session_id = p_session_id AND parent_item_id IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Return item does not belong to this session'
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_item.id = ANY (v_seen) THEN
      RAISE EXCEPTION 'Return item listed twice'
        USING ERRCODE = 'check_violation';
    END IF;
    v_seen := v_seen || v_item.id;
  END LOOP;

  -- Pass 1: product lines (they take sold quantities first), in item id
  -- order whatever the order of p_items (same as allocateSold() on the client).
  FOR v_input IN
    SELECT e FROM jsonb_array_elements(p_items) e ORDER BY (e->>'item_id')::INTEGER
  LOOP
    SELECT * INTO v_item FROM checkout_items WHERE id = (v_input->>'item_id')::INTEGER;
    CONTINUE WHEN v_item.product_id IS NULL;

    SELECT * INTO v_product FROM products WHERE id = v_item.product_id;
    v_is_machine := is_machine_product(v_item.product_id);

    BEGIN
      v_returned := round((v_input->>'returned_quantity')::NUMERIC, 3);
    EXCEPTION WHEN others THEN
      v_returned := NULL;
    END;
    IF v_returned IS NULL OR v_returned < 0 THEN
      RAISE EXCEPTION 'Invalid returned quantity for %', v_product.name
        USING ERRCODE = 'check_violation';
    END IF;

    v_used := submit_return_usage(v_item.id, p_session_id, v_item.product_id, v_product.name, v_is_machine, v_input->'usage');

    -- Sold on linked bills, up to what this line issued.
    v_sold := 0;
    FOR v_sold_row IN
      SELECT ctid, sale_id, party_id, qty FROM _sold_left
       WHERE product_id = v_item.product_id AND qty > 0
       ORDER BY sale_id
    LOOP
      v_take := LEAST(v_sold_row.qty, COALESCE(v_item.checkout_quantity, 0) - v_sold);
      EXIT WHEN v_take <= 0;
      INSERT INTO checkout_usage (item_id, session_id, product_id, reason, quantity, party_id, notes, sale_id)
      VALUES (v_item.id, p_session_id, v_item.product_id, 'sold', v_take, v_sold_row.party_id,
              'Bill #' || v_sold_row.sale_id, v_sold_row.sale_id);
      UPDATE _sold_left SET qty = qty - v_take WHERE ctid = v_sold_row.ctid;
      v_sold := v_sold + v_take;
    END LOOP;

    v_used := round(v_used + v_sold, 3);
    v_difference := round(COALESCE(v_item.checkout_quantity, 0) - v_returned - v_used, 3);

    SELECT value INTO v_tolerance FROM app_settings
     WHERE key = CASE WHEN v_product.type = 'liquid' THEN 'liquid_tolerance_kg' ELSE 'unit_tolerance' END;
    IF v_tolerance IS NULL OR v_tolerance < 0 THEN
      v_tolerance := CASE WHEN v_product.type = 'liquid' THEN 0.010 ELSE 0 END;
    END IF;
    v_mismatch := abs(v_difference) > v_tolerance + 1e-9;

    v_consumed := round(COALESCE(v_item.checkout_quantity, 0) - v_returned, 3);
    v_limit := COALESCE(NULLIF(v_product.max_daily_consumption, 0), 30);

    v_reasons := '{}';
    IF v_mismatch THEN
      v_reasons := v_reasons || (
        CASE WHEN v_difference > 0 THEN 'Shortage' ELSE 'Excess' END || ' of ' ||
        CASE WHEN v_product.type = 'liquid'
          THEN round(abs(v_difference), 3)::TEXT || ' kg'
          ELSE trim_scale(abs(v_difference))::TEXT || ' pcs'
        END
      );
    END IF;
    IF v_consumed > v_limit THEN
      v_reasons := v_reasons || (
        'Consumed ' || trim_scale(v_consumed)::TEXT || ' exceeds daily limit ' || trim_scale(v_limit)::TEXT
      );
    END IF;
    v_flag_reason := NULLIF(array_to_string(v_reasons, '; '), '');

    UPDATE checkout_items
       SET checkin_quantity = v_returned,
           used_quantity = v_used,
           difference = v_difference,
           has_mismatch = v_mismatch,
           is_flagged = (v_flag_reason IS NOT NULL),
           flag_reason = v_flag_reason,
           discrepancy_type = NULL,
           discrepancy_note = NULL
     WHERE id = v_item.id;

    v_has_discrepancy := v_has_discrepancy OR v_mismatch;
  END LOOP;

  -- Pass 2: Any lines. Every piece is named by type.
  FOR v_input IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_item FROM checkout_items WHERE id = (v_input->>'item_id')::INTEGER;
    CONTINUE WHEN v_item.product_id IS NOT NULL;

    SELECT * INTO v_category FROM categories WHERE id = v_item.category_id;

    IF v_input->'breakdown' IS NULL OR jsonb_typeof(v_input->'breakdown') <> 'array' THEN
      RAISE EXCEPTION 'Say which % came back, were used or lost', v_category.name
        USING ERRCODE = 'check_violation';
    END IF;

    v_seen_products := '{}';
    v_sum_returned := 0;
    v_sum_used := 0;
    v_sum_lost := 0;

    -- Products sold from this line but missing from the breakdown still get a row.
    FOR v_entry IN
      SELECT e FROM jsonb_array_elements(v_input->'breakdown') e
      UNION ALL
      SELECT jsonb_build_object('product_id', sl.product_id, 'returned_quantity', 0, 'lost_quantity', 0, 'usage', '[]'::jsonb)
        FROM (SELECT DISTINCT product_id FROM _sold_left WHERE qty > 0) sl
        JOIN products p ON p.id = sl.product_id
       WHERE p.category_id = v_item.category_id
         AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_input->'breakdown') b
            WHERE (b->>'product_id') = sl.product_id::TEXT
         )
    LOOP
      BEGIN
        v_entry_product := (v_entry->>'product_id')::INTEGER;
      EXCEPTION WHEN others THEN
        v_entry_product := NULL;
      END;
      SELECT * INTO v_product FROM products WHERE id = v_entry_product;
      IF NOT FOUND OR v_product.category_id IS DISTINCT FROM v_item.category_id THEN
        RAISE EXCEPTION 'Choose a % product for every line', v_category.name
          USING ERRCODE = 'check_violation';
      END IF;
      IF v_entry_product = ANY (v_seen_products) THEN
        RAISE EXCEPTION '% is listed twice', v_product.name
          USING ERRCODE = 'check_violation';
      END IF;
      v_seen_products := v_seen_products || v_entry_product;
      v_is_machine := is_machine_product(v_entry_product);

      BEGIN
        v_returned := round(COALESCE(NULLIF(v_entry->>'returned_quantity', ''), '0')::NUMERIC, 3);
        v_lost := round(COALESCE(NULLIF(v_entry->>'lost_quantity', ''), '0')::NUMERIC, 3);
      EXCEPTION WHEN others THEN
        v_returned := NULL;
      END;
      IF v_returned IS NULL OR v_returned < 0 OR v_lost IS NULL OR v_lost < 0 THEN
        RAISE EXCEPTION 'Invalid quantity for %', v_product.name
          USING ERRCODE = 'check_violation';
      END IF;
      IF v_category.type = 'unit' AND (v_returned <> trunc(v_returned) OR v_lost <> trunc(v_lost)) THEN
        RAISE EXCEPTION '% must be whole pieces', v_product.name
          USING ERRCODE = 'check_violation';
      END IF;

      -- Child row first so usage lines can point at it; quantities set below.
      INSERT INTO checkout_items (
        session_id, product_id, category_id, parent_item_id, checkout_quantity, is_flagged
      ) VALUES (
        p_session_id, v_entry_product, v_item.category_id, v_item.id, 0, false
      )
      RETURNING id INTO v_child_id;

      v_used := submit_return_usage(v_child_id, p_session_id, v_entry_product, v_product.name, v_is_machine, v_entry->'usage');
      IF v_category.type = 'unit' AND v_used <> trunc(v_used) THEN
        RAISE EXCEPTION '% must be whole pieces', v_product.name
          USING ERRCODE = 'check_violation';
      END IF;

      v_sold := 0;
      FOR v_sold_row IN
        SELECT ctid, sale_id, party_id, qty FROM _sold_left
         WHERE product_id = v_entry_product AND qty > 0
         ORDER BY sale_id
      LOOP
        INSERT INTO checkout_usage (item_id, session_id, product_id, reason, quantity, party_id, notes, sale_id)
        VALUES (v_child_id, p_session_id, v_entry_product, 'sold', v_sold_row.qty, v_sold_row.party_id,
                'Bill #' || v_sold_row.sale_id, v_sold_row.sale_id);
        UPDATE _sold_left SET qty = 0 WHERE ctid = v_sold_row.ctid;
        v_sold := v_sold + v_sold_row.qty;
      END LOOP;

      v_used := round(v_used + v_sold, 3);

      IF v_returned + v_used + v_lost <= 0 THEN
        DELETE FROM checkout_items WHERE id = v_child_id;
        CONTINUE;
      END IF;

      SELECT value INTO v_tolerance FROM app_settings
       WHERE key = CASE WHEN v_product.type = 'liquid' THEN 'liquid_tolerance_kg' ELSE 'unit_tolerance' END;
      IF v_tolerance IS NULL OR v_tolerance < 0 THEN
        v_tolerance := CASE WHEN v_product.type = 'liquid' THEN 0.010 ELSE 0 END;
      END IF;
      v_mismatch := v_lost > v_tolerance + 1e-9;
      v_flag_reason := CASE WHEN v_mismatch THEN
        'Lost ' || CASE WHEN v_product.type = 'liquid'
          THEN round(v_lost, 3)::TEXT || ' kg'
          ELSE trim_scale(v_lost)::TEXT || ' pcs' END
        END;

      UPDATE checkout_items
         SET checkout_quantity = round(v_returned + v_used + v_lost, 3),
             checkin_quantity = v_returned,
             used_quantity = v_used,
             difference = v_lost,
             has_mismatch = v_mismatch,
             is_flagged = v_mismatch,
             flag_reason = v_flag_reason,
             discrepancy_type = NULL,
             discrepancy_note = NULL
       WHERE id = v_child_id;

      v_sum_returned := v_sum_returned + v_returned;
      v_sum_used := v_sum_used + v_used;
      v_sum_lost := v_sum_lost + v_lost;
      v_has_discrepancy := v_has_discrepancy OR v_mismatch;
    END LOOP;

    v_accounted := round(v_sum_returned + v_sum_used + v_sum_lost, 3);
    IF abs(v_accounted - COALESCE(v_item.checkout_quantity, 0)) > 1e-9 THEN
      RAISE EXCEPTION 'Any %: % issued but % accounted for. Name every piece (returned, used, sold or lost)',
        v_category.name, trim_scale(v_item.checkout_quantity), trim_scale(v_accounted)
        USING ERRCODE = 'check_violation';
    END IF;

    -- Summary on the Any line itself (stock is moved through the children).
    UPDATE checkout_items
       SET checkin_quantity = round(v_sum_returned, 3),
           used_quantity = round(v_sum_used, 3),
           difference = round(v_sum_lost, 3),
           has_mismatch = false,
           is_flagged = false,
           flag_reason = NULL,
           discrepancy_type = NULL,
           discrepancy_note = NULL
     WHERE id = v_item.id;
  END LOOP;

  SELECT p.name INTO v_line
    FROM _sold_left sl JOIN products p ON p.id = sl.product_id
   WHERE sl.qty > 1e-9
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Bills from this field stock sell more % than was issued', v_line.name
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE checkout_sessions
     SET status = 'pending_approval',
         checkin_time = now(),
         notes = concat_ws(E'\n', NULLIF(notes, ''), NULLIF(btrim(COALESCE(p_notes, '')), '')),
         has_discrepancy = v_has_discrepancy
   WHERE id = p_session_id;

  RETURN jsonb_build_object('has_discrepancy', v_has_discrepancy);
END;
$$;

-- Usage lines typed by staff (customer service / installation / other) for
-- one checkout_items row. Returns their total. 'sold' is not accepted here.
CREATE OR REPLACE FUNCTION submit_return_usage(
  p_item_id INTEGER,
  p_session_id INTEGER,
  p_product_id INTEGER,
  p_product_name TEXT,
  p_is_machine BOOLEAN,
  p_usage JSONB
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usage JSONB;
  v_u_reason TEXT;
  v_u_qty NUMERIC;
  v_u_party INTEGER;
  v_used NUMERIC := 0;
BEGIN
  IF p_usage IS NOT NULL AND jsonb_typeof(p_usage) NOT IN ('array', 'null') THEN
    RAISE EXCEPTION 'Invalid usage reason'
      USING ERRCODE = 'check_violation';
  END IF;

  FOR v_usage IN
    SELECT * FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_usage) = 'array' THEN p_usage ELSE '[]'::jsonb END)
  LOOP
    v_u_reason := v_usage->>'reason';
    IF v_u_reason IS NULL OR v_u_reason NOT IN ('customer_service', 'installation', 'other') THEN
      RAISE EXCEPTION 'Invalid usage reason'
        USING ERRCODE = 'check_violation';
    END IF;

    BEGIN
      v_u_qty := round((v_usage->>'quantity')::NUMERIC, 3);
    EXCEPTION WHEN others THEN
      v_u_qty := NULL;
    END;
    IF v_u_qty IS NULL OR v_u_qty <= 0 THEN
      RAISE EXCEPTION 'Usage quantity must be greater than zero'
        USING ERRCODE = 'check_violation';
    END IF;

    BEGIN
      v_u_party := NULLIF((v_usage->>'party_id')::INTEGER, 0);
    EXCEPTION WHEN others THEN
      v_u_party := NULL;
    END;
    IF v_u_party IS NOT NULL THEN
      PERFORM 1 FROM parties WHERE id = v_u_party;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer % does not exist', v_u_party
          USING ERRCODE = 'foreign_key_violation';
      END IF;
    END IF;

    IF v_u_reason = 'installation' AND p_is_machine THEN
      IF v_u_party IS NULL THEN
        RAISE EXCEPTION 'Choose the customer where % was installed', p_product_name
          USING ERRCODE = 'check_violation';
      END IF;
      IF v_u_qty <> trunc(v_u_qty) THEN
        RAISE EXCEPTION 'Installed machines must be whole numbers'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    INSERT INTO checkout_usage (item_id, session_id, product_id, reason, quantity, party_id, notes)
    VALUES (
      p_item_id, p_session_id, p_product_id, v_u_reason, v_u_qty, v_u_party,
      NULLIF(btrim(COALESCE(v_usage->>'notes', '')), '')
    );

    v_used := v_used + v_u_qty;
  END LOOP;

  RETURN round(v_used, 3);
END;
$$;

-- --------------------------------------------------------
-- 7. approve_return: product lines restore Returned; Any children take
--    stock off each named product once (checkout −taken, checkin +returned).
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION approve_return(
  p_session_id INTEGER,
  p_approver_id UUID,
  p_resolutions JSONB DEFAULT '[]'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_session checkout_sessions%ROWTYPE;
  v_resolutions JSONB := CASE WHEN jsonb_typeof(p_resolutions) = 'array' THEN p_resolutions ELSE '[]'::jsonb END;
  v_item RECORD;
  v_res JSONB;
  v_type TEXT;
  v_note TEXT;
  v_install RECORD;
  v_staff_name TEXT;
  v_stock NUMERIC;
BEGIN
  IF v_actor IS NULL OR NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can approve returns'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_approver_id IS NOT NULL AND p_approver_id <> v_actor THEN
    RAISE EXCEPTION 'Approver must match authenticated user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_session FROM checkout_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session % not found', p_session_id;
  END IF;
  IF v_session.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'Session % is not pending_approval', p_session_id;
  END IF;

  PERFORM 1 FROM checkout_items WHERE session_id = p_session_id FOR UPDATE;

  FOR v_item IN
    SELECT ci.id, p.name AS product_name
      FROM checkout_items ci
      LEFT JOIN products p ON p.id = ci.product_id
     WHERE ci.session_id = p_session_id AND COALESCE(ci.has_mismatch, false)
     ORDER BY ci.id
  LOOP
    SELECT r INTO v_res
      FROM jsonb_array_elements(v_resolutions) WITH ORDINALITY AS t(r, n)
     WHERE jsonb_typeof(r) = 'object' AND (r->>'item_id') = v_item.id::TEXT
     ORDER BY n DESC
     LIMIT 1;
    v_type := v_res->>'discrepancy_type';
    v_note := btrim(COALESCE(v_res->>'note', ''));
    IF v_res IS NULL
       OR v_type IS NULL
       OR v_type NOT IN ('wastage', 'loss', 'staff_shortage', 'counting_error', 'excess_return', 'other')
       OR v_note = '' THEN
      RAISE EXCEPTION 'Classify the difference for % and add a note before approving', COALESCE(v_item.product_name, 'item')
        USING ERRCODE = 'check_violation';
    END IF;

    UPDATE checkout_items
       SET discrepancy_type = v_type,
           discrepancy_note = v_note
     WHERE id = v_item.id;
  END LOOP;

  -- Product lines: stock left at issue; returned pieces come back.
  FOR v_item IN
    SELECT product_id, checkin_quantity FROM checkout_items
     WHERE session_id = p_session_id
       AND parent_item_id IS NULL
       AND product_id IS NOT NULL
       AND COALESCE(checkin_quantity, 0) > 0
     ORDER BY id
  LOOP
    PERFORM adjust_stock(v_item.product_id, v_item.checkin_quantity);

    INSERT INTO inventory_transactions (
      product_id, type, quantity, reference_type, reference_id, performed_by, notes
    ) VALUES (
      v_item.product_id, 'checkin', v_item.checkin_quantity,
      'checkout_session', p_session_id, v_actor, 'Approved return - stock restored'
    );
  END LOOP;

  SELECT full_name INTO v_staff_name FROM profiles WHERE id = v_session.seller_id;

  FOR v_install IN
    SELECT u.product_id, u.quantity, u.party_id, pa.name AS party_name
      FROM checkout_usage u
      LEFT JOIN parties pa ON pa.id = u.party_id
     WHERE u.session_id = p_session_id
       AND u.reason = 'installation'
       AND is_machine_product(u.product_id)
     ORDER BY u.id
  LOOP
    PERFORM adjust_stock(v_install.product_id, v_install.quantity);

    UPDATE products
       SET installed_qty = COALESCE(installed_qty, 0) + v_install.quantity,
           updated_at = now()
     WHERE id = v_install.product_id;

    INSERT INTO inventory_transactions (
      product_id, type, quantity, reference_type, reference_id, performed_by, notes
    ) VALUES (
      v_install.product_id, 'installed', v_install.quantity,
      'checkout_session', p_session_id, v_actor,
      'Installed at ' || COALESCE(v_install.party_name, 'customer') || ' - moved to Installed Qty'
    );

    INSERT INTO installations (
      party_id, product_id, quantity, installation_date, status, removed_date, notes
    ) VALUES (
      v_install.party_id, v_install.product_id, v_install.quantity::INTEGER,
      CURRENT_DATE, 'active', NULL,
      'Installed by ' || COALESCE(v_staff_name, 'staff') || ' (Daily Operations session #' || p_session_id || ')'
    );
  END LOOP;

  -- Any lines: stock never left at issue; take what was used, sold or lost.
  -- Runs after the installations above, which count installed machines back
  -- into Total Stock, so an installed machine is never refused here.
  FOR v_item IN
    SELECT ci.product_id, ci.checkout_quantity, COALESCE(ci.checkin_quantity, 0) AS returned,
           p.name AS product_name, c.name AS category_name
      FROM checkout_items ci
      JOIN products p ON p.id = ci.product_id
      LEFT JOIN categories c ON c.id = ci.category_id
     WHERE ci.session_id = p_session_id AND ci.parent_item_id IS NOT NULL
     ORDER BY ci.id
  LOOP
    SELECT current_stock INTO v_stock FROM products WHERE id = v_item.product_id FOR UPDATE;
    IF COALESCE(v_stock, 0) + v_item.returned - v_item.checkout_quantity < -1e-9 THEN
      RAISE EXCEPTION 'Stock of % is lower than this return takes (% in stock). Correct the stock first',
        v_item.product_name, trim_scale(COALESCE(v_stock, 0))
        USING ERRCODE = 'check_violation';
    END IF;

    PERFORM adjust_stock(v_item.product_id, v_item.returned - v_item.checkout_quantity);

    INSERT INTO inventory_transactions (
      product_id, type, quantity, reference_type, reference_id, performed_by, notes
    ) VALUES (
      v_item.product_id, 'checkout', -v_item.checkout_quantity,
      'checkout_session', p_session_id, v_actor,
      'Issued as Any ' || COALESCE(v_item.category_name, 'category') || ' - type named on return'
    );

    IF v_item.returned > 0 THEN
      INSERT INTO inventory_transactions (
        product_id, type, quantity, reference_type, reference_id, performed_by, notes
      ) VALUES (
        v_item.product_id, 'checkin', v_item.returned,
        'checkout_session', p_session_id, v_actor, 'Approved return - stock restored'
      );
    END IF;
  END LOOP;

  UPDATE checkout_sessions
     SET status = 'checked_in',
         approved_by = v_actor,
         approved_at = now()
   WHERE id = p_session_id;
END;
$$;

-- --------------------------------------------------------
-- 8. reject_return ("Send back"): also removes the Any children.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION reject_return(
  p_session_id INTEGER,
  p_reason TEXT,
  p_approver_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_session checkout_sessions%ROWTYPE;
  v_reason TEXT := btrim(COALESCE(p_reason, ''));
BEGIN
  IF v_actor IS NULL OR NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can send a return back'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_approver_id IS NOT NULL AND p_approver_id <> v_actor THEN
    RAISE EXCEPTION 'Approver must match authenticated user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_session FROM checkout_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session % not found', p_session_id;
  END IF;
  IF v_session.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'Session % is not pending_approval', p_session_id;
  END IF;

  IF v_reason = '' THEN
    RAISE EXCEPTION 'Give a reason for sending the return back'
      USING ERRCODE = 'check_violation';
  END IF;

  DELETE FROM checkout_usage WHERE session_id = p_session_id;
  DELETE FROM checkout_items WHERE session_id = p_session_id AND parent_item_id IS NOT NULL;

  UPDATE checkout_items
     SET checkin_quantity = NULL,
         used_quantity = NULL,
         difference = NULL,
         has_mismatch = false,
         is_flagged = false,
         flag_reason = NULL,
         discrepancy_type = NULL,
         discrepancy_note = NULL
   WHERE session_id = p_session_id;

  UPDATE checkout_sessions
     SET status = 'checked_out',
         checkin_time = NULL,
         has_discrepancy = false,
         notes = concat_ws(E'\n', NULLIF(notes, ''), 'Return sent back: ' || v_reason)
   WHERE id = p_session_id;
END;
$$;

-- --------------------------------------------------------
-- 9. Grants (exact signatures). Internal helpers are not callable from the
--    API; get_category_holds is (read-only, no row details).
-- --------------------------------------------------------
REVOKE ALL ON FUNCTION checkout_held_qty(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION check_issue_availability(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION check_field_sale_capacity(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION assert_open_field_session(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION submit_return_usage(INTEGER, INTEGER, INTEGER, TEXT, BOOLEAN, JSONB) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION get_category_holds() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION admin_issue_stock(UUID, JSONB, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION approve_issue(INTEGER, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION record_sale(INTEGER, JSONB, TEXT, TEXT, NUMERIC, DATE, DATE, TEXT, UUID, TEXT, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION update_sale(INTEGER, INTEGER, JSONB, TEXT, TEXT, NUMERIC, DATE, DATE, TEXT, UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION delete_sale(INTEGER, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION submit_return(INTEGER, JSONB, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION approve_return(INTEGER, UUID, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION reject_return(INTEGER, TEXT, UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION get_category_holds() TO authenticated;
GRANT EXECUTE ON FUNCTION admin_issue_stock(UUID, JSONB, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION approve_issue(INTEGER, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION record_sale(INTEGER, JSONB, TEXT, TEXT, NUMERIC, DATE, DATE, TEXT, UUID, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION update_sale(INTEGER, INTEGER, JSONB, TEXT, TEXT, NUMERIC, DATE, DATE, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_sale(INTEGER, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION submit_return(INTEGER, JSONB, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION approve_return(INTEGER, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION reject_return(INTEGER, TEXT, UUID) TO authenticated;

COMMIT;

-- ============================================
-- Verification (read-only; run after COMMIT)
-- ============================================
-- New columns (expect 4 rows):
-- select table_name, column_name from information_schema.columns
--  where table_schema = 'public' and (
--        (table_name = 'checkout_items' and column_name in ('category_id', 'parent_item_id'))
--     or (table_name = 'checkout_usage' and column_name = 'sale_id')
--     or (table_name = 'sales' and column_name = 'checkout_session_id'))
--  order by 1, 2;
--
-- Exactly one record_sale, ending in "p_checkout_session_id integer":
-- select proname, pg_get_function_identity_arguments(oid) from pg_proc
--  where pronamespace = 'public'::regnamespace
--    and proname in ('record_sale', 'update_sale', 'delete_sale', 'admin_issue_stock', 'approve_issue',
--                    'submit_return', 'approve_return', 'reject_return', 'get_category_holds')
--  order by 1, 2;
--
-- Nothing held yet (expect 0 rows):
-- select * from get_category_holds();
