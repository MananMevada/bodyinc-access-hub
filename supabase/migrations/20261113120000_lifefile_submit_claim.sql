-- One pharmacy send at a time. Stripe and the patient portal can confirm the same
-- additional payment together. Both used to read "no Life File id yet" and each created
-- an order. Claiming the row first lets only one of those calls reach Life File.

ALTER TABLE public.medication_requests
  DROP CONSTRAINT IF EXISTS medication_requests_life_file_status_check;

ALTER TABLE public.medication_requests
  ADD CONSTRAINT medication_requests_life_file_status_check
  CHECK (
    life_file_status IS NULL
    OR life_file_status IN ('submitting', 'submitted', 'accepted', 'failed')
  );

COMMENT ON COLUMN public.medication_requests.life_file_status IS
  'LifeFile submission: submitting (in flight) | submitted | accepted | failed. Null means not attempted.';

CREATE OR REPLACE FUNCTION public.claim_life_file_submission(p_request_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_order_id text;
  v_updated timestamptz;
BEGIN
  SELECT life_file_status, life_file_order_id, updated_at
    INTO v_status, v_order_id, v_updated
  FROM public.medication_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'missing';
  END IF;

  -- Any saved pharmacy id means the order exists. A failed status must not create another one.
  IF v_order_id IS NOT NULL THEN
    RETURN 'already_sent';
  END IF;

  -- Another call is inside the Life File request. A crashed claim can be taken after 10 minutes.
  IF v_status = 'submitting'
     AND v_updated IS NOT NULL
     AND v_updated > now() - interval '10 minutes' THEN
    RETURN 'in_progress';
  END IF;

  IF v_status IN ('submitted', 'accepted') THEN
    RETURN 'already_sent';
  END IF;

  UPDATE public.medication_requests
  SET life_file_status = 'submitting',
      life_file_error = NULL,
      updated_at = now()
  WHERE id = p_request_id;

  RETURN 'claimed';
END;
$$;

REVOKE ALL ON FUNCTION public.claim_life_file_submission(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_life_file_submission(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_life_file_submission(uuid) TO service_role;
