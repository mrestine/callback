-- callback — database schema (Postgres / Neon)
-- Apply with:  npm run db:apply
-- Idempotent: safe to re-run.

create table if not exists users (
  id            bigint generated always as identity primary key,
  github_id     bigint not null unique,
  github_login  text not null,
  name          text,
  avatar_url    text,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz not null default now()
);

create table if not exists companies (
  id          bigint generated always as identity primary key,
  user_id     bigint not null references users (id) on delete cascade,
  name        text not null,
  careers_url text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists contacts (
  id              bigint generated always as identity primary key,
  user_id         bigint not null references users (id) on delete cascade,
  company_id      bigint references companies (id) on delete set null,
  name            text not null,
  role            text,
  kind            text not null default 'other'
                  check (kind in ('friend', 'recruiter', 'hiring_mgr', 'referral', 'other')),
  email           text,
  linkedin_url    text,
  warmth          text not null default 'cold'
                  check (warmth in ('cold', 'warm', 'strong')),
  notes           text,
  last_contact_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists applications (
  id           bigint generated always as identity primary key,
  user_id      bigint not null references users (id) on delete cascade,
  company_id   bigint not null references companies (id) on delete cascade,
  contact_id   bigint references contacts (id) on delete set null,
  role_title   text not null,
  jd_url       text,
  source       text,
  status       text not null default 'lead'
               check (status in ('lead', 'applied', 'screen', 'onsite', 'offer',
                                 'rejected', 'withdrawn', 'ghosted')),
  location     text,
  remote       text check (remote in ('remote', 'hybrid', 'onsite')),
  salary_range text,
  applied_at   date,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists events (
  id             bigint generated always as identity primary key,
  user_id        bigint not null references users (id) on delete cascade,
  application_id bigint references applications (id) on delete cascade,
  contact_id     bigint references contacts (id) on delete cascade,
  type           text not null
                 check (type in ('note', 'email', 'call', 'interview',
                                 'status_change', 'applied', 'follow_up')),
  -- free-form round detail: "Technical", "Behavioral", "Hiring manager", "Intro", …
  subtype        text,
  body           text,
  old_status     text,
  new_status     text,
  occurred_at    timestamptz not null default now(),
  -- 'scheduled' = a future round the user has booked; 'logged' = it happened.
  status         text not null default 'logged' check (status in ('scheduled', 'logged')),
  source         text not null default 'manual' check (source in ('manual', 'ai')),
  created_at     timestamptz not null default now()
);

-- migrations for databases created before these columns / values existed
alter table events add column if not exists status text not null default 'logged';
alter table events add column if not exists subtype text;
alter table events drop constraint if exists events_type_check;
update events set type = 'interview' where type = 'meeting';
alter table events add constraint events_type_check
  check (type in ('note', 'email', 'call', 'interview', 'status_change', 'applied', 'follow_up'));

create index if not exists contacts_user_company_idx on contacts (user_id, company_id);
create index if not exists applications_user_status_idx on applications (user_id, status);
create index if not exists applications_user_company_idx on applications (user_id, company_id);
create index if not exists events_user_occurred_idx on events (user_id, occurred_at desc);
create index if not exists events_application_idx on events (application_id, occurred_at desc);
create index if not exists events_contact_idx on events (contact_id, occurred_at desc);
create index if not exists events_upcoming_idx on events (user_id, occurred_at) where status = 'scheduled';

-- ============================================================================
-- Phase 2 — AI email ingestion (see PHASE-2-PLAN.md)
--
-- `callback` stays source-agnostic: it never models email. The ingestion worker
-- POSTs an extracted structure to /api/inbound; callback matches it, compiles a
-- proposed set of ops, and parks it for human review. Nothing here says "email".
-- ============================================================================

-- fuzzy company / role name matching in /api/inbound (similarity(), % operator)
create extension if not exists pg_trgm;

-- worker -> API bearer auth. Raw token `cbk_<base64url>`; only the hash is stored.
create table if not exists api_tokens (
  id           bigint generated always as identity primary key,
  user_id      bigint not null references users (id) on delete cascade,
  name         text not null,
  token_hash   text not null unique,          -- sha256(raw) hex
  scopes       text[] not null default '{inbound}',
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists api_tokens_user_idx on api_tokens (user_id);

-- one row per worker submission: dedup key + audit trail + review item.
create table if not exists inbound_actions (
  id            bigint generated always as identity primary key,
  user_id       bigint not null references users (id) on delete cascade,
  source        text not null,                -- opaque, e.g. 'gmail-worker'
  external_ref  text not null,                -- opaque dedup key from the worker
  occurred_at   timestamptz,                  -- when the underlying thing happened
  summary       text,                         -- human-readable, from the worker
  payload       jsonb,                        -- full submit body (extracted + thread_key), verbatim
  match         jsonb,                        -- per-entity candidates + scores (§5)
  proposal      jsonb,                        -- ordered op list the reviewer edits (§6)
  status        text not null default 'pending'
                check (status in ('pending', 'needs_review', 'applied',
                                  'auto_applied', 'dismissed', 'duplicate', 'error')),
  applied       jsonb,                        -- per-op results: [{id, op, result_id, created}]
  error         text,
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  thread_key    text generated always as (payload ->> 'thread_key') stored,
  unique (user_id, source, external_ref)
);
create index if not exists inbound_actions_user_status_idx
  on inbound_actions (user_id, status, created_at desc);
create index if not exists inbound_actions_user_thread_idx
  on inbound_actions (user_id, thread_key);

-- provenance: which submission produced this row. `set null` so the domain row
-- outlives a deleted inbound_actions row.
alter table events add column if not exists inbound_action_id
  bigint references inbound_actions (id) on delete set null;
alter table applications add column if not exists inbound_action_id
  bigint references inbound_actions (id) on delete set null;
