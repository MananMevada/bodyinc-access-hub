ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS availability_note text,
  ADD COLUMN IF NOT EXISTS is_unavailable boolean NOT NULL DEFAULT false;

-- Tell the assigned practitioner when a patient submits or edits intake answers.
CREATE OR REPLACE FUNCTION public.notify_provider_on_intake_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_req record;
BEGIN
  FOR v_req IN
    SELECT id, provider_id
    FROM public.medication_requests
    WHERE session_id = NEW.session_id
      AND provider_id IS NOT NULL
      AND status IN (
        'pending_review',
        'provider_assigned',
        'payment_completed',
        'approved',
        'awaiting_additional_payment'
      )
  LOOP
    IF EXISTS (
      SELECT 1
      FROM public.notifications
      WHERE user_id = v_req.provider_id
        AND type = 'intake_updated'
        AND entity_id = v_req.id
        AND created_at > now() - interval '15 minutes'
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.notifications (user_id, type, title, body, link, entity_id)
    VALUES (
      v_req.provider_id,
      'intake_updated',
      'Intake form updated',
      'A patient updated their intake form. Review the order before you decide.',
      '/provider/requests/' || v_req.id::text,
      v_req.id
    );
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_provider_on_intake_change failed: %', sqlerrm;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_provider_on_intake_change ON public.intake_session_questionnaire_responses;
CREATE TRIGGER notify_provider_on_intake_change
AFTER INSERT OR UPDATE ON public.intake_session_questionnaire_responses
FOR EACH ROW EXECUTE FUNCTION public.notify_provider_on_intake_change();
