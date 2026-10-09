-- Схема за Supabase (регион ЕС). Изпълни в SQL Editor.
-- Преди това: Authentication -> изключи "Allow new users to sign up",
-- после ръчно създай ЕДИН потребител за младоженците (имейл + парола).

-- ========== Отговори (RSVP) ==========
create table if not exists public.rsvps (
  id          uuid primary key default gen_random_uuid(),
  guest_code  text unique,
  name        text not null check (char_length(name) between 2 and 80),
  attending   text not null check (attending in ('yes', 'no')),
  guests      int  not null default 0 check (guests between 0 and 10),
  note        text check (note is null or char_length(note) <= 300),
  created_at  timestamptz not null default now()
);

alter table public.rsvps enable row level security;

-- гостите (anon) могат САМО да добавят отговор, не и да четат чужди
create policy "anon inserts rsvp" on public.rsvps
  for insert to anon with check (true);

-- чете само влезлият потребител (младоженците)
create policy "owner reads rsvp" on public.rsvps
  for select to authenticated using (true);

-- ========== Снимки ==========
create table if not exists public.photos (
  id          uuid primary key default gen_random_uuid(),
  path        text not null unique,
  uploader    text check (uploader is null or char_length(uploader) <= 40),
  kind        text not null default 'photo' check (kind in ('photo','video')),
  approved    boolean not null default false,
  created_at  timestamptz not null default now()
);

alter table public.photos enable row level security;

-- гост може да качи само НЕодобрена снимка
create policy "anon inserts photo" on public.photos
  for insert to anon with check (approved = false);

-- всички виждат само одобрените
create policy "anyone reads approved photos" on public.photos
  for select to anon, authenticated using (approved = true);

-- младоженците виждат, одобряват и трият всичко
create policy "owner reads all photos" on public.photos
  for select to authenticated using (true);
create policy "owner updates photos" on public.photos
  for update to authenticated using (true) with check (true);
create policy "owner deletes photos" on public.photos
  for delete to authenticated using (true);

-- ========== Хранилище за файловете ==========
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wedding-photos', 'wedding-photos', true, 52428800, array['image/jpeg','video/mp4','video/webm','video/quicktime'])
on conflict (id) do nothing;

create policy "anon uploads to wedding-photos" on storage.objects
  for insert to anon with check (bucket_id = 'wedding-photos');

create policy "owner manages wedding-photos" on storage.objects
  for all to authenticated
  using (bucket_id = 'wedding-photos') with check (bucket_id = 'wedding-photos');

-- ========== След събитието ==========
-- Отговорите (имена, алергии) се изтриват:
--   delete from public.rsvps;
-- Снимките остават до договорения срок (keepUntil в data/couple.json),
-- а младоженците са свалили своя ZIP от таблото.
