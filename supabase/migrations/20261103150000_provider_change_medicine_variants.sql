-- Providers can read doses on a medicine that is hidden from the patient shop
-- when that medicine is marked "Show to providers when changing a patient's medicine".

create policy "Providers read variants on provider-visible medicines"
on public.medicine_variants
for select
to authenticated
using (
  public.has_role(auth.uid(), 'provider'::public.app_role)
  and exists (
    select 1
    from public.medicines m
    where m.id = medicine_variants.medicine_id
      and m.show_to_providers = true
  )
);
