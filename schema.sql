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
                 check (type in ('note', 'email', 'call', 'meeting',
                                 'status_change', 'applied', 'follow_up')),
  body           text,
  old_status     text,
  new_status     text,
  occurred_at    timestamptz not null default now(),
  source         text not null default 'manual' check (source in ('manual', 'ai')),
  created_at     timestamptz not null default now()
);

create index if not exists contacts_user_company_idx on contacts (user_id, company_id);
create index if not exists applications_user_status_idx on applications (user_id, status);
create index if not exists applications_user_company_idx on applications (user_id, company_id);
create index if not exists events_user_occurred_idx on events (user_id, occurred_at desc);
create index if not exists events_application_idx on events (application_id, occurred_at desc);
create index if not exists events_contact_idx on events (contact_id, occurred_at desc);
