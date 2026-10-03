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
  {
    version: 6,
    name: "udaan_control_centre",
    sql: `
-- Month targets for every channel × category (Stores = "Offline" in the plan). Rupees.
create table month_targets (
  channel text not null check (channel in ('stores','online','marketplace')),
  category text not null,
  month date not null,
  target numeric(14,2) not null check (target >= 0),
  note text,
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (channel, category, month)
);
insert into month_targets(channel, category, month, target, note, updated_by)
  select channel, category, month, target, note, updated_by from channel_targets where category <> '*'
  on conflict do nothing;
insert into month_targets(channel, category, month, target, note, updated_by) values
('stores','accessories','2026-04-01',1000000,'FY26-27 plan (seed)','seed'),
('stores','accessories','2026-05-01',1000000,'FY26-27 plan (seed)','seed'),
('stores','accessories','2026-06-01',1000000,'FY26-27 plan (seed)','seed'),
('stores','accessories','2026-07-01',200000,'FY26-27 plan (seed)','seed'),
('stores','accessories','2026-08-01',200000,'FY26-27 plan (seed)','seed'),
('stores','accessories','2026-09-01',200000,'FY26-27 plan (seed)','seed'),
('stores','accessories','2026-10-01',200000,'FY26-27 plan (seed)','seed'),
('stores','accessories','2026-11-01',300000,'FY26-27 plan (seed)','seed'),
('stores','accessories','2026-12-01',700000,'FY26-27 plan (seed)','seed'),
('stores','accessories','2027-01-01',1000000,'FY26-27 plan (seed)','seed'),
('stores','accessories','2027-02-01',1000000,'FY26-27 plan (seed)','seed'),
('stores','accessories','2027-03-01',1500000,'FY26-27 plan (seed)','seed'),
('stores','bags','2026-04-01',1000000,'FY26-27 plan (seed)','seed'),
('stores','bags','2026-05-01',1000000,'FY26-27 plan (seed)','seed'),
('stores','bags','2026-06-01',1000000,'FY26-27 plan (seed)','seed'),
('stores','bags','2026-07-01',1000000,'FY26-27 plan (seed)','seed'),
('stores','bags','2026-08-01',2000000,'FY26-27 plan (seed)','seed'),
('stores','bags','2026-09-01',2000000,'FY26-27 plan (seed)','seed'),
('stores','bags','2026-10-01',2000000,'FY26-27 plan (seed)','seed'),
('stores','bags','2026-11-01',2000000,'FY26-27 plan (seed)','seed'),
('stores','bags','2026-12-01',2000000,'FY26-27 plan (seed)','seed'),
('stores','bags','2027-01-01',2000000,'FY26-27 plan (seed)','seed'),
('stores','bags','2027-02-01',2000000,'FY26-27 plan (seed)','seed'),
('stores','bags','2027-03-01',2000000,'FY26-27 plan (seed)','seed'),
('stores','belts','2026-04-01',500000,'FY26-27 plan (seed)','seed'),
('stores','belts','2026-05-01',500000,'FY26-27 plan (seed)','seed'),
('stores','belts','2026-06-01',500000,'FY26-27 plan (seed)','seed'),
('stores','belts','2026-07-01',1000000,'FY26-27 plan (seed)','seed'),
('stores','belts','2026-08-01',1000000,'FY26-27 plan (seed)','seed'),
('stores','belts','2026-09-01',1200000,'FY26-27 plan (seed)','seed'),
('stores','belts','2026-10-01',2000000,'FY26-27 plan (seed)','seed'),
('stores','belts','2026-11-01',2000000,'FY26-27 plan (seed)','seed'),
('stores','belts','2026-12-01',2000000,'FY26-27 plan (seed)','seed'),
('stores','belts','2027-01-01',2500000,'FY26-27 plan (seed)','seed'),
('stores','belts','2027-02-01',2500000,'FY26-27 plan (seed)','seed'),
('stores','belts','2027-03-01',2500000,'FY26-27 plan (seed)','seed'),
('stores','perfumes','2026-04-01',9000000,'FY26-27 plan (seed)','seed'),
('stores','perfumes','2026-05-01',10000000,'FY26-27 plan (seed)','seed'),
('stores','perfumes','2026-06-01',10000000,'FY26-27 plan (seed)','seed'),
('stores','perfumes','2026-07-01',10400000,'FY26-27 plan (seed)','seed'),
('stores','perfumes','2026-08-01',10900000,'FY26-27 plan (seed)','seed'),
('stores','perfumes','2026-09-01',11500000,'FY26-27 plan (seed)','seed'),
('stores','perfumes','2026-10-01',12100000,'FY26-27 plan (seed)','seed'),
('stores','perfumes','2026-11-01',12700000,'FY26-27 plan (seed)','seed'),
('stores','perfumes','2026-12-01',13300000,'FY26-27 plan (seed)','seed'),
('stores','perfumes','2027-01-01',14000000,'FY26-27 plan (seed)','seed'),
('stores','perfumes','2027-02-01',14700000,'FY26-27 plan (seed)','seed'),
('stores','perfumes','2027-03-01',15400000,'FY26-27 plan (seed)','seed'),
('stores','shoes','2026-04-01',6000000,'FY26-27 plan (seed)','seed'),
('stores','shoes','2026-05-01',6100000,'FY26-27 plan (seed)','seed'),
('stores','shoes','2026-06-01',6100000,'FY26-27 plan (seed)','seed'),
('stores','shoes','2026-07-01',6500000,'FY26-27 plan (seed)','seed'),
('stores','shoes','2026-08-01',6500000,'FY26-27 plan (seed)','seed'),
('stores','shoes','2026-09-01',8000000,'FY26-27 plan (seed)','seed'),
('stores','shoes','2026-10-01',11000000,'FY26-27 plan (seed)','seed'),
('stores','shoes','2026-11-01',12000000,'FY26-27 plan (seed)','seed'),
('stores','shoes','2026-12-01',11500000,'FY26-27 plan (seed)','seed'),
('stores','shoes','2027-01-01',11500000,'FY26-27 plan (seed)','seed'),
('stores','shoes','2027-02-01',12000000,'FY26-27 plan (seed)','seed'),
('stores','shoes','2027-03-01',14000000,'FY26-27 plan (seed)','seed'),
('stores','sunglasses','2026-04-01',2000000,'FY26-27 plan (seed)','seed'),
('stores','sunglasses','2026-05-01',2800000,'FY26-27 plan (seed)','seed'),
('stores','sunglasses','2026-06-01',2900000,'FY26-27 plan (seed)','seed'),
('stores','sunglasses','2026-07-01',3000000,'FY26-27 plan (seed)','seed'),
('stores','sunglasses','2026-08-01',3100000,'FY26-27 plan (seed)','seed'),
('stores','sunglasses','2026-09-01',2500000,'FY26-27 plan (seed)','seed'),
('stores','sunglasses','2026-10-01',2500000,'FY26-27 plan (seed)','seed'),
('stores','sunglasses','2026-11-01',2500000,'FY26-27 plan (seed)','seed'),
('stores','sunglasses','2026-12-01',2500000,'FY26-27 plan (seed)','seed'),
('stores','sunglasses','2027-01-01',2500000,'FY26-27 plan (seed)','seed'),
('stores','sunglasses','2027-02-01',3000000,'FY26-27 plan (seed)','seed'),
('stores','sunglasses','2027-03-01',3500000,'FY26-27 plan (seed)','seed'),
('online','accessories','2026-04-01',1000000,'FY26-27 plan (seed)','seed'),
('online','accessories','2026-05-01',1000000,'FY26-27 plan (seed)','seed'),
('online','accessories','2026-06-01',1000000,'FY26-27 plan (seed)','seed'),
('online','accessories','2026-07-01',1000000,'FY26-27 plan (seed)','seed'),
('online','accessories','2026-08-01',1000000,'FY26-27 plan (seed)','seed'),
('online','accessories','2026-09-01',1000000,'FY26-27 plan (seed)','seed'),
('online','accessories','2026-10-01',1000000,'FY26-27 plan (seed)','seed'),
('online','accessories','2026-11-01',1000000,'FY26-27 plan (seed)','seed'),
('online','accessories','2026-12-01',1000000,'FY26-27 plan (seed)','seed'),
('online','accessories','2027-01-01',1000000,'FY26-27 plan (seed)','seed'),
('online','accessories','2027-02-01',1000000,'FY26-27 plan (seed)','seed'),
('online','accessories','2027-03-01',1000000,'FY26-27 plan (seed)','seed'),
('online','bags','2026-04-01',1000000,'FY26-27 plan (seed)','seed'),
('online','bags','2026-05-01',1000000,'FY26-27 plan (seed)','seed'),
('online','bags','2026-06-01',1000000,'FY26-27 plan (seed)','seed'),
('online','bags','2026-07-01',1000000,'FY26-27 plan (seed)','seed'),
('online','bags','2026-08-01',1000000,'FY26-27 plan (seed)','seed'),
('online','bags','2026-09-01',1500000,'FY26-27 plan (seed)','seed'),
('online','bags','2026-10-01',1500000,'FY26-27 plan (seed)','seed'),
('online','bags','2026-11-01',1500000,'FY26-27 plan (seed)','seed'),
('online','bags','2026-12-01',1500000,'FY26-27 plan (seed)','seed'),
('online','bags','2027-01-01',1500000,'FY26-27 plan (seed)','seed'),
('online','bags','2027-02-01',1500000,'FY26-27 plan (seed)','seed'),
('online','bags','2027-03-01',1500000,'FY26-27 plan (seed)','seed'),
('online','belts','2026-04-01',500000,'FY26-27 plan (seed)','seed'),
('online','belts','2026-05-01',500000,'FY26-27 plan (seed)','seed'),
('online','belts','2026-06-01',500000,'FY26-27 plan (seed)','seed'),
('online','belts','2026-07-01',500000,'FY26-27 plan (seed)','seed'),
('online','belts','2026-08-01',500000,'FY26-27 plan (seed)','seed'),
('online','belts','2026-09-01',1000000,'FY26-27 plan (seed)','seed'),
('online','belts','2026-10-01',1500000,'FY26-27 plan (seed)','seed'),
('online','belts','2026-11-01',1000000,'FY26-27 plan (seed)','seed'),
('online','belts','2026-12-01',500000,'FY26-27 plan (seed)','seed'),
('online','belts','2027-01-01',500000,'FY26-27 plan (seed)','seed'),
('online','belts','2027-02-01',500000,'FY26-27 plan (seed)','seed'),
('online','belts','2027-03-01',500000,'FY26-27 plan (seed)','seed'),
('online','perfumes','2026-04-01',2000000,'FY26-27 plan (seed)','seed'),
('online','perfumes','2026-05-01',3000000,'FY26-27 plan (seed)','seed'),
('online','perfumes','2026-06-01',4500000,'FY26-27 plan (seed)','seed'),
('online','perfumes','2026-07-01',3000000,'FY26-27 plan (seed)','seed'),
('online','perfumes','2026-08-01',3000000,'FY26-27 plan (seed)','seed'),
('online','perfumes','2026-09-01',3000000,'FY26-27 plan (seed)','seed'),
('online','perfumes','2026-10-01',4000000,'FY26-27 plan (seed)','seed'),
('online','perfumes','2026-11-01',4000000,'FY26-27 plan (seed)','seed'),
('online','perfumes','2026-12-01',4000000,'FY26-27 plan (seed)','seed'),
('online','perfumes','2027-01-01',5000000,'FY26-27 plan (seed)','seed'),
('online','perfumes','2027-02-01',5000000,'FY26-27 plan (seed)','seed'),
('online','perfumes','2027-03-01',5000000,'FY26-27 plan (seed)','seed'),
('online','shoes','2026-04-01',10000000,'FY26-27 plan (seed)','seed'),
('online','shoes','2026-05-01',12000000,'FY26-27 plan (seed)','seed'),
('online','shoes','2026-06-01',14400000,'FY26-27 plan (seed)','seed'),
('online','shoes','2026-07-01',18700000,'FY26-27 plan (seed)','seed'),
('online','shoes','2026-08-01',22500000,'FY26-27 plan (seed)','seed'),
('online','shoes','2026-09-01',27000000,'FY26-27 plan (seed)','seed'),
('online','shoes','2026-10-01',31000000,'FY26-27 plan (seed)','seed'),
('online','shoes','2026-11-01',33000000,'FY26-27 plan (seed)','seed'),
('online','shoes','2026-12-01',37000000,'FY26-27 plan (seed)','seed'),
('online','shoes','2027-01-01',40000000,'FY26-27 plan (seed)','seed'),
('online','shoes','2027-02-01',38000000,'FY26-27 plan (seed)','seed'),
('online','shoes','2027-03-01',43000000,'FY26-27 plan (seed)','seed'),
('online','sunglasses','2026-04-01',900000,'FY26-27 plan (seed)','seed'),
('online','sunglasses','2026-05-01',900000,'FY26-27 plan (seed)','seed'),
('online','sunglasses','2026-06-01',900000,'FY26-27 plan (seed)','seed'),
('online','sunglasses','2026-07-01',900000,'FY26-27 plan (seed)','seed'),
('online','sunglasses','2026-08-01',900000,'FY26-27 plan (seed)','seed'),
('online','sunglasses','2026-09-01',900000,'FY26-27 plan (seed)','seed'),
('online','sunglasses','2026-10-01',900000,'FY26-27 plan (seed)','seed'),
('online','sunglasses','2026-11-01',900000,'FY26-27 plan (seed)','seed'),
('online','sunglasses','2026-12-01',900000,'FY26-27 plan (seed)','seed'),
('online','sunglasses','2027-01-01',900000,'FY26-27 plan (seed)','seed'),
('online','sunglasses','2027-02-01',900000,'FY26-27 plan (seed)','seed'),
('online','sunglasses','2027-03-01',900000,'FY26-27 plan (seed)','seed'),
('marketplace','accessories','2026-04-01',200000,'FY26-27 plan (seed)','seed'),
('marketplace','accessories','2026-05-01',200000,'FY26-27 plan (seed)','seed'),
('marketplace','accessories','2026-06-01',200000,'FY26-27 plan (seed)','seed'),
('marketplace','accessories','2026-07-01',200000,'FY26-27 plan (seed)','seed'),
('marketplace','accessories','2026-08-01',200000,'FY26-27 plan (seed)','seed'),
('marketplace','accessories','2026-09-01',200000,'FY26-27 plan (seed)','seed'),
('marketplace','accessories','2026-10-01',200000,'FY26-27 plan (seed)','seed'),
('marketplace','accessories','2026-11-01',200000,'FY26-27 plan (seed)','seed'),
('marketplace','accessories','2026-12-01',200000,'FY26-27 plan (seed)','seed'),
('marketplace','accessories','2027-01-01',200000,'FY26-27 plan (seed)','seed'),
('marketplace','accessories','2027-02-01',200000,'FY26-27 plan (seed)','seed'),
('marketplace','accessories','2027-03-01',200000,'FY26-27 plan (seed)','seed'),
('marketplace','bags','2026-04-01',300000,'FY26-27 plan (seed)','seed'),
('marketplace','bags','2026-05-01',300000,'FY26-27 plan (seed)','seed'),
('marketplace','bags','2026-06-01',300000,'FY26-27 plan (seed)','seed'),
('marketplace','bags','2026-07-01',300000,'FY26-27 plan (seed)','seed'),
('marketplace','bags','2026-08-01',300000,'FY26-27 plan (seed)','seed'),
('marketplace','bags','2026-09-01',0,'FY26-27 plan (seed)','seed'),
('marketplace','bags','2026-10-01',0,'FY26-27 plan (seed)','seed'),
('marketplace','bags','2026-11-01',0,'FY26-27 plan (seed)','seed'),
('marketplace','bags','2026-12-01',0,'FY26-27 plan (seed)','seed'),
('marketplace','bags','2027-01-01',0,'FY26-27 plan (seed)','seed'),
('marketplace','bags','2027-02-01',0,'FY26-27 plan (seed)','seed'),
('marketplace','bags','2027-03-01',0,'FY26-27 plan (seed)','seed'),
('marketplace','belts','2026-04-01',50000,'FY26-27 plan (seed)','seed'),
('marketplace','belts','2026-05-01',50000,'FY26-27 plan (seed)','seed'),
('marketplace','belts','2026-06-01',50000,'FY26-27 plan (seed)','seed'),
('marketplace','belts','2026-07-01',50000,'FY26-27 plan (seed)','seed'),
('marketplace','belts','2026-08-01',50000,'FY26-27 plan (seed)','seed'),
('marketplace','belts','2026-09-01',50000,'FY26-27 plan (seed)','seed'),
('marketplace','belts','2026-10-01',50000,'FY26-27 plan (seed)','seed'),
('marketplace','belts','2026-11-01',50000,'FY26-27 plan (seed)','seed'),
('marketplace','belts','2026-12-01',50000,'FY26-27 plan (seed)','seed'),
('marketplace','belts','2027-01-01',50000,'FY26-27 plan (seed)','seed'),
('marketplace','belts','2027-02-01',50000,'FY26-27 plan (seed)','seed'),
('marketplace','belts','2027-03-01',50000,'FY26-27 plan (seed)','seed'),
('marketplace','perfumes','2026-04-01',200000,'FY26-27 plan (seed)','seed'),
('marketplace','perfumes','2026-05-01',500000,'FY26-27 plan (seed)','seed'),
('marketplace','perfumes','2026-06-01',700000,'FY26-27 plan (seed)','seed'),
('marketplace','perfumes','2026-07-01',1000000,'FY26-27 plan (seed)','seed'),
('marketplace','perfumes','2026-08-01',4000000,'FY26-27 plan (seed)','seed'),
('marketplace','perfumes','2026-09-01',6000000,'FY26-27 plan (seed)','seed'),
('marketplace','perfumes','2026-10-01',10000000,'FY26-27 plan (seed)','seed'),
('marketplace','perfumes','2026-11-01',10000000,'FY26-27 plan (seed)','seed'),
('marketplace','perfumes','2026-12-01',10000000,'FY26-27 plan (seed)','seed'),
('marketplace','perfumes','2027-01-01',10000000,'FY26-27 plan (seed)','seed'),
('marketplace','perfumes','2027-02-01',10000000,'FY26-27 plan (seed)','seed'),
('marketplace','perfumes','2027-03-01',10000000,'FY26-27 plan (seed)','seed'),
('marketplace','shoes','2026-04-01',5000000,'FY26-27 plan (seed)','seed'),
('marketplace','shoes','2026-05-01',5000000,'FY26-27 plan (seed)','seed'),
('marketplace','shoes','2026-06-01',5000000,'FY26-27 plan (seed)','seed'),
('marketplace','shoes','2026-07-01',7000000,'FY26-27 plan (seed)','seed'),
('marketplace','shoes','2026-08-01',7500000,'FY26-27 plan (seed)','seed'),
('marketplace','shoes','2026-09-01',10000000,'FY26-27 plan (seed)','seed'),
('marketplace','shoes','2026-10-01',13000000,'FY26-27 plan (seed)','seed'),
('marketplace','shoes','2026-11-01',17000000,'FY26-27 plan (seed)','seed'),
('marketplace','shoes','2026-12-01',23000000,'FY26-27 plan (seed)','seed'),
('marketplace','shoes','2027-01-01',26000000,'FY26-27 plan (seed)','seed'),
('marketplace','shoes','2027-02-01',26000000,'FY26-27 plan (seed)','seed'),
('marketplace','shoes','2027-03-01',33000000,'FY26-27 plan (seed)','seed'),
('marketplace','sunglasses','2026-04-01',500000,'FY26-27 plan (seed)','seed'),
('marketplace','sunglasses','2026-05-01',500000,'FY26-27 plan (seed)','seed'),
('marketplace','sunglasses','2026-06-01',500000,'FY26-27 plan (seed)','seed'),
('marketplace','sunglasses','2026-07-01',500000,'FY26-27 plan (seed)','seed'),
('marketplace','sunglasses','2026-08-01',500000,'FY26-27 plan (seed)','seed'),
('marketplace','sunglasses','2026-09-01',500000,'FY26-27 plan (seed)','seed'),
('marketplace','sunglasses','2026-10-01',500000,'FY26-27 plan (seed)','seed'),
('marketplace','sunglasses','2026-11-01',500000,'FY26-27 plan (seed)','seed'),
('marketplace','sunglasses','2026-12-01',500000,'FY26-27 plan (seed)','seed'),
('marketplace','sunglasses','2027-01-01',500000,'FY26-27 plan (seed)','seed'),
('marketplace','sunglasses','2027-02-01',1000000,'FY26-27 plan (seed)','seed'),
('marketplace','sunglasses','2027-03-01',1000000,'FY26-27 plan (seed)','seed')
on conflict do nothing;

-- Daily phasing: share of the month target per day, per channel (and per state for Stores; '*' = all).
create table day_splits (
  channel text not null check (channel in ('stores','online','marketplace')),
  state text not null default '*',
  day date not null,
  weight numeric(10,6) not null check (weight >= 0),
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (channel, state, day)
);

-- Store × category month targets (phased with the Stores split for the store's state).
create table store_month_targets (
  branch_code text not null,
  category text not null,
  month date not null,
  target numeric(14,2) not null check (target >= 0),
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (branch_code, category, month)
);

-- Remarks: team context that the tool takes into account (suppress, snooze or explain).
create table remarks (
  id bigserial primary key,
  scope text not null check (scope in ('action','store','store_category','product','category','date','general')),
  scope_id text,
  category text,
  kind text not null check (kind in ('context','not_applicable','snooze')),
  until date,
  day date,
  text text not null,
  action_key text,
  active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now()
);
create index remarks_scope on remarks (scope, scope_id);

create table vm_revamps (
  id bigserial primary key,
  branch_code text not null,
  category text not null,
  stage text not null default 'shortlisted',
  status text not null default 'on_track',
  start_date date,
  target_date date,
  live_date date,
  owner text,
  notes jsonb not null default '[]',
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table future_inwards (
  id bigserial primary key,
  category text not null,
  design text not null,
  sku_group text,
  kind text not null check (kind in ('new','repeat')),
  qty integer not null default 0,
  expected_date date,
  warehouse text,
  status text not null default 'planned',
  note text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Product attributes (metafields) entered or uploaded in the tool; merged over Snowflake / seed values.
create table product_meta (
  sku_group text primary key,
  attrs jsonb not null,
  updated_by text not null,
  updated_at timestamptz not null default now()
);

-- All long-tail categories in scope by default.
insert into app_settings(key, value, updated_by) values ('enabledCategories', '["perfumes","shoes","accessories","bags","belts","sunglasses","luggage"]', 'migration')
  on conflict (key) do update set value = excluded.value, updated_by = 'migration', updated_at = now();
`,
  },
  {
    version: 7,
    name: "split_source",
    sql: `
-- where a daily split came from: actual (past months, from sales), recommended (model), manual / upload (people)
alter table day_splits add column source text not null default 'manual';
`,
  },
  {
    version: 8,
    name: "remark_tags",
    sql: `
-- product-level remark tags (e.g. not to be sent to stores, being called back) that change which actions apply
alter table remarks add column tag text;
create index remarks_tag on remarks(tag) where active and tag is not null;
`,
  },
  {
    version: 9,
    name: "access_roles",
    sql: `
-- access roles: admin (no downloads), viewer, store_actions, online_actions, designer; super admin is set by env, not stored
alter table app_users drop constraint if exists app_users_role_check;
alter table app_users add constraint app_users_role_check check (role in ('viewer','admin','store_actions','online_actions','designer'));
`,
  },
];
