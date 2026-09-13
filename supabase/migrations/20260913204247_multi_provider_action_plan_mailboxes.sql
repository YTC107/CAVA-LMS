-- Additive upgrade of the existing Gmail mailbox schema. Existing rows remain Google connections.
alter table action_plan_private.mailboxes add column if not exists provider text not null default 'google'
  check (provider in ('google','microsoft','icloud','yahoo','custom'));
alter table action_plan_private.mailboxes add column if not exists connection_status text not null default 'connected'
  check (connection_status in ('connected','reconnect_required'));
alter table action_plan_private.oauth_states add column if not exists provider text not null default 'google'
  check (provider in ('google','microsoft'));
alter table action_plan_private.oauth_states add column if not exists expected_email text;
create table if not exists action_plan_private.connection_guards (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  generation text not null,
  updated_at timestamptz not null default now()
);
alter table action_plan_private.connection_guards enable row level security;
revoke all on schema action_plan_private from public, anon, authenticated;
revoke all on all tables in schema action_plan_private from public, anon, authenticated;
-- No client policies: mailbox credentials, states and guards are backend-only by design.
alter table action_plan_private.mailboxes enable row level security;
alter table action_plan_private.oauth_states enable row level security;
create index if not exists action_plan_oauth_owner on action_plan_private.oauth_states(owner_id);
create index if not exists action_plan_oauth_expiry on action_plan_private.oauth_states(expires_at);
