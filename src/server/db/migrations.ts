export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: "init",
    sql: `
create table app_users (
  email text primary key,
  name text,
  role text not null default 'viewer' check (role in ('viewer','editor','admin')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

-- Target overrides on top of Snowflake MTD_TARGET_* tables.
-- branch_code '*' = category-level target (scales all store targets in that category/month).
create table target_overrides (
  id bigserial primary key,
  category text not null,
  branch_code text not null,
  grain text not null check (grain in ('month','week','day')),
  period_start date not null,
  target numeric(14,2) not null check (target >= 0),
  note text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_by text not null,
  updated_at timestamptz not null default now(),
  unique (category, branch_code, grain, period_start)
);
create index target_overrides_period on target_overrides (period_start);

create table target_history (
  id bigserial primary key,
  override_id bigint,
  category text not null,
  branch_code text not null,
  grain text not null,
  period_start date not null,
  old_target numeric(14,2),
  new_target numeric(14,2),
  action text not null check (action in ('create','update','delete','upload')),
  note text,
  batch_id uuid,
  changed_by text not null,
  changed_at timestamptz not null default now()
);
create index target_history_key on target_history (category, branch_code, period_start);

create table app_settings (
  key text primary key,
  value jsonb not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

create table saved_views (
  id bigserial primary key,
  owner_email text not null,
  name text not null,
  path text not null,
  query text not null default '',
  shared boolean not null default false,
  created_at timestamptz not null default now()
);

create table audit_log (
  id bigserial primary key,
  actor text not null,
  action text not null,
  entity text not null,
  entity_id text,
  detail jsonb,
  at timestamptz not null default now()
);
create index audit_log_at on audit_log (at desc);
`,
  },
  {
    version: 2,
    name: "ai_copilot",
    sql: `
create table ai_conversations (
  id uuid primary key,
  owner_email text not null,
  title text not null,
  messages jsonb not null default '[]',
  results jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_conversations_owner on ai_conversations (owner_email, updated_at desc);

create table ai_turns (
  id bigserial primary key,
  conversation_id uuid not null references ai_conversations(id) on delete cascade,
  owner_email text not null,
  question text not null,
  response jsonb,
  tools jsonb,
  usage jsonb,
  model text,
  latency_ms int,
  error text,
  feedback smallint,
  created_at timestamptz not null default now()
);
create index ai_turns_conv on ai_turns (conversation_id, id);
`,
  },
  {
    version: 3,
    name: "username_password_auth",
    sql: `
-- Identity moves from email (SSO) to admin-managed username + password; roles are admin | viewer.
alter table app_users rename column email to username;
alter table app_users add column password_hash text;
alter table app_users add column created_by text;
alter table app_users add column password_changed_at timestamptz;
alter table app_users drop constraint if exists app_users_role_check;
update app_users set role = 'viewer' where role not in ('viewer','admin');
alter table app_users add constraint app_users_role_check check (role in ('viewer','admin'));
-- users that signed in via SSO have no password and cannot log in until an admin sets one
alter table ai_conversations rename column owner_email to owner;
alter table ai_turns rename column owner_email to owner;
alter table saved_views rename column owner_email to owner;
`,
  },
  {
    version: 4,
    name: "action_tracking",
    sql: `
create table action_status (
  key text primary key,
  status text not null check (status in ('open','done','dismissed')),
  note text,
  updated_by text not null,
  updated_at timestamptz not null default now()
);
`,
  },
  {
    version: 5,
    name: "channel_targets",
    sql: `
-- Month targets for channels without a Snowflake target (Online, Marketplace). Never inferred — admins set them.
create table channel_targets (
  id bigserial primary key,
  channel text not null check (channel in ('online','marketplace')),
  category text not null, -- registry key or '*' for all categories
  month date not null,
  target numeric(14,2) not null check (target >= 0),
  note text,
  updated_by text not null,
  updated_at timestamptz not null default now(),
  unique (channel, category, month)
);
`,
  },
];
