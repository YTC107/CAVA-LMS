-- Add explicit learner-slot metadata without changing existing assignment rows.
alter table public."assessor_assignments table"
  add column if not exists learner_slot text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'assessor_assignments_learner_slot_check'
      and conrelid = 'public."assessor_assignments table"'::regclass
  ) then
    alter table public."assessor_assignments table"
      add constraint assessor_assignments_learner_slot_check
      check (learner_slot in ('l1', 'l2'));
  end if;
end $$;

create unique index if not exists assessor_assignments_assessor_l1_unique
  on public."assessor_assignments table" (assessor_id)
  where learner_slot = 'l1';

create unique index if not exists assessor_assignments_assessor_l2_unique
  on public."assessor_assignments table" (assessor_id)
  where learner_slot = 'l2';
