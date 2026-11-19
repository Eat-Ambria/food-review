-- Migration 9: audio storage, departments and the other things Submit needs.
alter table public.submissions drop constraint if exists submissions_processing_status_check;
alter table public.submissions add constraint submissions_processing_status_check
  check (processing_status in ('submitted', 'processing', 'awaiting_confirmation', 'needs_review',
                               'pending_assignment', 'assigned', 'failed'));

alter table public.issues add column if not exists original_text text;

insert into public.issue_categories (name, description, sort_order) values
  ('Kitchen',        'Food taste, quality, quantity, temperature, hygiene of food, delay in food preparation, wrong menu items', 10),
  ('F&B Service',    'Serving staff, delay in serving, service manners, buffet/counter management, table service', 20),
  ('Beverage',       'Bar, drinks, mocktails, tea/coffee, water, ice, beverage counters', 30),
  ('Crockery',       'Plates, glasses, cutlery, crockery shortage, dirty or broken crockery', 40),
  ('Housekeeping',   'Cleanliness, washrooms, garbage, dust, linen, smell, cleaning during the event', 50),
  ('Maintenance',    'AC, electricity, lights, power cut, generator, plumbing, water leakage, furniture, repairs', 60),
  ('Decor',          'Decoration, flowers, stage, mandap, decor setup delay or damage', 70),
  ('Entertainment',  'DJ, sound system, music, mic, band, performers, lighting effects', 80),
  ('Security',       'Security guards, entry control, theft, parking, crowd, safety', 90),
  ('Horticulture',   'Lawn, grass, plants, garden, mosquitoes in lawn area', 100),
  ('IT & Tech',      'Wi-Fi, screens, projector, LED wall, CCTV, technical equipment', 110),
  ('Other',          'Anything that does not fit the categories above', 999)
on conflict (name) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recordings', 'recordings', false, 10485760,
        array['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/wav', 'audio/x-m4a', 'audio/aac'])
on conflict (id) do nothing;

drop policy if exists recordings_insert_own on storage.objects;
create policy recordings_insert_own on storage.objects for insert to authenticated
  with check (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_active_user()
  );

drop policy if exists recordings_select_own on storage.objects;
create policy recordings_select_own on storage.objects for select to authenticated
  using (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_active_user()
  );
