-- ============================================
-- Migration 017: Keep return notes history on resubmit
-- Run after migration 016. Safe to re-run (CREATE OR REPLACE, same signature).
-- ============================================
--
-- submit_return (migration 016) overwrote checkout_sessions.notes, so when an
-- admin used "Send back" and the staff member resubmitted, the
-- "Return sent back: <reason>" line was lost. This version appends the new
-- note to the existing notes instead. Nothing else changes.

BEGIN;
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
  v_usage JSONB;
  v_item checkout_items%ROWTYPE;
  v_product products%ROWTYPE;
  v_is_machine BOOLEAN;
  v_seen INTEGER[] := '{}';
  v_item_id INTEGER;
  v_returned NUMERIC;
  v_used NUMERIC;
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
  GET DIAGNOSTICS v_item_count = ROW_COUNT;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) <> v_item_count THEN
    RAISE EXCEPTION 'Every issued item must be included in the return'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Re-submission after "Send back" replaces the previous usage lines.
  DELETE FROM checkout_usage WHERE session_id = p_session_id;

  FOR v_input IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    BEGIN
      v_item_id := (v_input->>'item_id')::INTEGER;
    EXCEPTION WHEN others THEN
      v_item_id := NULL;
    END;

    SELECT * INTO v_item FROM checkout_items
     WHERE id = v_item_id AND session_id = p_session_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Return item does not belong to this session'
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_item.id = ANY (v_seen) THEN
      RAISE EXCEPTION 'Return item listed twice'
        USING ERRCODE = 'check_violation';
    END IF;
    v_seen := v_seen || v_item.id;

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

    IF v_input->'usage' IS NOT NULL AND jsonb_typeof(v_input->'usage') NOT IN ('array', 'null') THEN
      RAISE EXCEPTION 'Invalid usage reason'
        USING ERRCODE = 'check_violation';
    END IF;

    v_used := 0;
    FOR v_usage IN
      SELECT * FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(v_input->'usage') = 'array' THEN v_input->'usage' ELSE '[]'::jsonb END
      )
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

      IF v_u_reason = 'installation' AND v_is_machine THEN
        IF v_u_party IS NULL THEN
          RAISE EXCEPTION 'Choose the customer where % was installed', v_product.name
            USING ERRCODE = 'check_violation';
        END IF;
        IF v_u_qty <> trunc(v_u_qty) THEN
          RAISE EXCEPTION 'Installed machines must be whole numbers'
            USING ERRCODE = 'check_violation';
        END IF;
      END IF;

      INSERT INTO checkout_usage (item_id, session_id, product_id, reason, quantity, party_id, notes)
      VALUES (
        v_item.id, p_session_id, v_item.product_id, v_u_reason, v_u_qty, v_u_party,
        NULLIF(btrim(COALESCE(v_usage->>'notes', '')), '')
      );

      v_used := v_used + v_u_qty;
    END LOOP;

    v_used := round(v_used, 3);
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

  UPDATE checkout_sessions
     SET status = 'pending_approval',
         checkin_time = now(),
         -- Keep earlier notes (e.g. "Return sent back: ...") so the history survives a resubmit.
         notes = concat_ws(E'\n', NULLIF(notes, ''), NULLIF(btrim(COALESCE(p_notes, '')), '')),
         has_discrepancy = v_has_discrepancy
   WHERE id = p_session_id;

  RETURN jsonb_build_object('has_discrepancy', v_has_discrepancy);
END;
$$;

-- Signature unchanged, so the existing REVOKE/GRANT from migration 016 still applies.

COMMIT;

-- Verify (expect true):
-- select pg_get_functiondef('submit_return(integer, jsonb, text, uuid)'::regprocedure) like '%concat_ws%';