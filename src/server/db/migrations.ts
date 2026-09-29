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
];
