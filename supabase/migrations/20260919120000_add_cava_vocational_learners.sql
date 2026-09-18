-- Assessor-owned vocational learner identities. These are not Hub login accounts.
create table if not exists public.cava_vocational_learners (
  id uuid primary key default gen_random_uuid(),
  assessor_id uuid not null references auth.users(id) on delete cascade,
  learner_slot text not null check (learner_slot in ('l1', 'l2')),
  full_name text not null check (length(btrim(full_name)) between 2 and 160),
  email text not null check (length(btrim(email)) <= 254 and email ~* '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$'),
  qualification_label text not null check (qualification_label in ('Level 2 Gym Instructor', 'Level 3 Personal Trainer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assessor_id, learner_slot)
);

alter table public.cava_vocational_learners enable row level security;
create policy cava_vocational_learners_owner_read on public.cava_vocational_learners
  for select to authenticated using (assessor_id = (select auth.uid()));
create policy cava_vocational_learners_owner_insert on public.cava_vocational_learners
  for insert to authenticated with check (assessor_id = (select auth.uid()));
create policy cava_vocational_learners_owner_update on public.cava_vocational_learners
  for update to authenticated using (assessor_id = (select auth.uid()))
  with check (assessor_id = (select auth.uid()));

-- Existing evidence rows reference legacy public.learners records. New vocational
-- identities use the same UUID column without creating fake login accounts.
alter table public.evidence_attachments
  add column if not exists learner_source text not null default 'legacy'
  check (learner_source in ('legacy', 'vocational'));
alter table public.evidence_attachments
  drop constraint if exists evidence_attachments_learner_id_fkey;
create index if not exists evidence_attachments_source_learner
  on public.evidence_attachments(learner_source, learner_id);
