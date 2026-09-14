create table public.action_plan_records (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'draft' check (status in ('draft','finalised')),
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalised_at timestamptz
);
create index action_plan_records_owner_updated on public.action_plan_records(owner_id,updated_at desc);
alter table public.action_plan_records enable row level security;
grant select,insert,update on public.action_plan_records to authenticated;
revoke all on public.action_plan_records from anon;
create policy action_plan_owner_read on public.action_plan_records for select to authenticated using (owner_id=(select auth.uid()));
create policy action_plan_owner_insert on public.action_plan_records for insert to authenticated with check (owner_id=(select auth.uid()) and status='draft');
create policy action_plan_owner_update on public.action_plan_records for update to authenticated using (owner_id=(select auth.uid()) and status='draft') with check (owner_id=(select auth.uid()));
create function public.action_plan_stamp() returns trigger language plpgsql set search_path='' as $$
begin
  if TG_OP='UPDATE' then
    if old.status='finalised' then raise exception 'Finalised plans are read only. Create a review.'; end if;
    if new.owner_id<>old.owner_id or new.id<>old.id then raise exception 'Record identity cannot change'; end if;
    new.created_at:=old.created_at;
    new.revision:=old.revision+1;
  else new.created_at:=now(); new.revision:=1;
  end if;
  new.updated_at:=now();
  new.finalised_at:=case when new.status='finalised' then now() else null end;
  return new;
end $$;
revoke all on function public.action_plan_stamp() from public,anon,authenticated;
create trigger action_plan_record_stamp before insert or update on public.action_plan_records for each row execute function public.action_plan_stamp();

create schema if not exists action_plan_private;
revoke all on schema action_plan_private from public,anon,authenticated;
create table action_plan_private.mailboxes (owner_id uuid primary key references auth.users(id) on delete cascade, email text not null, token_cipher text not null, updated_at timestamptz not null default now());
create table action_plan_private.oauth_states (state text primary key, owner_id uuid not null references auth.users(id) on delete cascade, verifier text not null, expires_at timestamptz not null);
create table public.action_plan_email_events (plan_id uuid primary key references public.action_plan_records(id), owner_id uuid not null references auth.users(id), status text not null check (status in ('sending','sent','failed','unknown')), sender text not null, recipient text not null, provider_message_id text, sent_at timestamptz, detail text, updated_at timestamptz not null default now());
alter table public.action_plan_email_events enable row level security;
grant select on public.action_plan_email_events to authenticated;
revoke all on public.action_plan_email_events from anon;
create policy action_plan_email_owner_read on public.action_plan_email_events for select to authenticated using (owner_id=(select auth.uid()));
alter table action_plan_private.mailboxes enable row level security;
alter table action_plan_private.oauth_states enable row level security;
