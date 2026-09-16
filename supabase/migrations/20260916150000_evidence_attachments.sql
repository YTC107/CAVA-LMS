-- Persistent Unit 2/3 evidence metadata. File bytes remain in the private Storage bucket.
create table if not exists public.evidence_attachments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  learner_id uuid not null references public.learners(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  storage_bucket text not null default 'cava-evidence',
  storage_path text not null unique,
  original_filename text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size >= 0),
  content_hash text,
  status text not null default 'pending' check (status in ('pending','uploaded','failed','locked','removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  uploaded_at timestamptz,
  locked_at timestamptz,
  locked_by uuid references auth.users(id) on delete restrict,
  removed_at timestamptz
);

create index if not exists evidence_attachments_owner_learner
  on public.evidence_attachments(owner_id, learner_id, created_at desc);
create index if not exists evidence_attachments_status
  on public.evidence_attachments(status);

create table if not exists public.evidence_attachment_criteria (
  id uuid primary key default gen_random_uuid(),
  attachment_id uuid not null references public.evidence_attachments(id) on delete cascade,
  unit_code text not null check (unit_code in ('unit2','unit3')),
  learning_outcome_code text not null check (learning_outcome_code ~ '^lo[1-9][0-9]*$'),
  assessment_criterion text not null check (assessment_criterion ~ '^[1-9][0-9]*\.[1-9][0-9]*$'),
  evidence_type text,
  created_at timestamptz not null default now(),
  unique (attachment_id, unit_code, learning_outcome_code, assessment_criterion)
);

create index if not exists evidence_attachment_criteria_lookup
  on public.evidence_attachment_criteria(unit_code, learning_outcome_code, assessment_criterion, created_at desc);

alter table public.evidence_attachments enable row level security;
alter table public.evidence_attachment_criteria enable row level security;

-- The Edge Function performs the allocation check and uses the service role for
-- Storage and metadata writes. These policies protect direct table access.
create policy evidence_attachments_owner_read on public.evidence_attachments
  for select to authenticated
  using (owner_id = (select auth.uid()) and status <> 'removed' and exists (
    select 1 from public."assessor_assignments table" aa
    where aa.assessor_id = (select auth.uid()) and aa.learner_id = evidence_attachments.learner_id
  ));
create policy evidence_attachments_owner_insert on public.evidence_attachments
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and uploaded_by = (select auth.uid()) and exists (
    select 1 from public."assessor_assignments table" aa
    where aa.assessor_id = (select auth.uid()) and aa.learner_id = evidence_attachments.learner_id
  ));
create policy evidence_attachments_owner_update on public.evidence_attachments
  for update to authenticated
  using (owner_id = (select auth.uid()) and status not in ('locked','removed') and exists (
    select 1 from public."assessor_assignments table" aa
    where aa.assessor_id = (select auth.uid()) and aa.learner_id = evidence_attachments.learner_id
  ))
  with check (owner_id = (select auth.uid()) and uploaded_by = (select auth.uid()) and exists (
    select 1 from public."assessor_assignments table" aa
    where aa.assessor_id = (select auth.uid()) and aa.learner_id = evidence_attachments.learner_id
  ));

create policy evidence_attachment_criteria_owner_read on public.evidence_attachment_criteria
  for select to authenticated
  using (exists (
    select 1 from public.evidence_attachments a
    where a.id = attachment_id
      and a.owner_id = (select auth.uid())
      and a.status <> 'removed'
  ));

insert into storage.buckets (id, name, public)
values ('cava-evidence', 'cava-evidence', false)
on conflict (id) do update set public = excluded.public;

-- No direct browser Storage policies are granted. The protected Edge Function
-- issues short-lived signed upload/download capabilities after authorization.
