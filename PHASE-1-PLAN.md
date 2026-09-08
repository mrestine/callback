# callback — Phase 1 Plan

**callback** is a multi-user job-application tracker. (The name is what you want
from every application — and this app's own OAuth route is literally
`/api/auth/callback`.)

Anyone can sign in with GitHub and gets their own fully private workspace; the
operator (you) is just the first account. There is no sharing between users in
Phase 1.

## Goal

A web app for managing a job search: **contacts** (engineer friends,
recruiters, hiring managers), the **companies** they belong to, the
**applications** sent, and a **timeline of events** against each. Every row is
owned by exactly one user and only ever visible to that user. Pure CRUD with
good filtering and a dashboard. No AI in Phase 1.

## Hard requirements

- **$0 hosting** — hobby/free tiers only.
- Built so Phase 2 (local Ollama email ingestion) can write to it without redesign.
- Phase 2 and Phase 3 are out of scope here but the data model reserves room for them.

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React 19 + Vite + TypeScript + Tailwind v4, SPA | Mirrors the `lexpand` repo setup |
| API | Vercel serverless functions under `/api` | Hobby tier |
| DB | Neon Postgres, free tier (0.5 GB) | `@neondatabase/serverless` HTTP driver — no pooling pain in serverless |
| Auth | GitHub OAuth, open signup, per-user data isolation | See "Authentication" |
| Data fetching | TanStack Query | Cache invalidation on mutation is the app's entire state model |
| Forms | react-hook-form + Zod (`zodResolver`) | Zod schemas shared between client and API |
| Validation | Zod on every API request body | Same schema objects as the forms |

### Repo shape

```
/                      Vite app root
  index.html
  src/
    main.tsx
    App.tsx
    lib/
      api.ts           apiFetch wrapper: credentials, throws on !2xx, redirects on 401
      queryClient.ts
    schemas/           Zod schemas (company, contact, application, event) — imported by /api too
    routes/            screen components
    components/
  api/
    _db.ts             Neon client
    _auth.ts           session cookie sign/verify + requireAuth(req) -> { uid, login }
    auth.ts            /api/auth/*  (login, callback, logout, me); upserts the users row
    companies.ts       switch(req.method) — GET list / POST / PATCH / DELETE by ?id=
    contacts.ts
    applications.ts
    events.ts
  schema.sql
  vercel.json
```

Resources are collapsed to one function file each (`switch (req.method)`, id via
query param) to stay well under hobby function limits — ~6 function files total.

## Authentication (GitHub OAuth)

We use GitHub only to prove identity, then run our own signed session cookie. No
GitHub token is stored. Signup is open: any GitHub account that completes the
flow gets a `users` row and its own private data. An optional
`ALLOWED_GITHUB_LOGINS` env var (comma-separated) restricts *new* signups to a
list if you ever need a kill switch; left unset, anyone can sign up.

### One-time setup

1. Create a **GitHub OAuth App** (Settings → Developer settings → OAuth Apps):
   - Homepage URL: `https://callback-<suffix>.vercel.app` (Vercel picks the exact subdomain)
   - Authorization callback URL: `https://callback-<suffix>.vercel.app/api/auth/callback`
   - Add a second callback URL `http://localhost:5173/api/auth/callback` for local dev
     (GitHub OAuth Apps allow multiple callback URLs).
2. Put the client ID/secret in Vercel env (below). No app review, no verification.

### Flow

1. `GET /api/auth/login` → 302 to
   `https://github.com/login/oauth/authorize?client_id=…&redirect_uri=<APP_BASE_URL>/api/auth/callback&scope=read:user&state=<random>`
   The `state` value is also set as a short-lived (`Max-Age=600`) `HttpOnly` cookie.
2. `GET /api/auth/callback?code=…&state=…`
   - Verify `state` matches the cookie; clear the state cookie.
   - `POST https://github.com/login/oauth/access_token` to exchange `code` for a token.
   - `GET https://api.github.com/user` with that token.
   - If `ALLOWED_GITHUB_LOGINS` is set and this `login` isn't in it → 403.
   - **Upsert** `users` by `github_id` (updates `github_login`, `name`,
     `avatar_url`); take the resulting `users.id`.
   - Set the session cookie carrying that `id`, and 302 to `/`.
3. `POST /api/auth/logout` → clears the session cookie.
4. `GET /api/auth/me` → `200 { login, name, avatar_url }` if the session cookie
   is valid, else `401`.

### Session cookie

- Value: HMAC-SHA256 signed payload `{ uid, login, iat }` using `SESSION_SECRET`
  (a small self-contained JWT-style token; no DB lookup on each request).
- `uid` is the `users.id` every query is scoped by. `login` is carried for
  display/logging only — never trusted for authorization.
- Attributes: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000` (30 days).
  `Lax` (not `Strict`) so the cookie is sent on the top-level redirect back from GitHub.
- GitHub OAuth App user tokens don't expire and we don't keep them, so there is
  nothing to refresh; re-login only when the 30-day cookie lapses.

### Enforcement

- `requireAuth(req)` in `api/_auth.ts` verifies the cookie and returns
  `{ uid, login }` or throws a 401. Every mutating handler and every data `GET`
  calls it. `/api/auth/login` and `/api/auth/callback` are the only open routes.
- **Data isolation:** every `SELECT`, `UPDATE`, and `DELETE` includes
  `where user_id = $uid` (and every `INSERT` sets `user_id = $uid`). A row id
  belonging to another user simply 404s — ids are never trusted on their own.
  Cross-table writes (e.g. attaching a `contact_id` to an application) verify the
  referenced row is also owned by `$uid`.
- Frontend calls `GET /api/auth/me` on load. On 401 it shows a single
  **"Sign in with GitHub"** button that navigates to `/api/auth/login`.
  `apiFetch` redirects to the login screen on any 401.

## Data model

```sql
create table users (
  id           bigint generated always as identity primary key,
  github_id    bigint not null unique,
  github_login text not null,
  name         text,
  avatar_url   text,
  created_at   timestamptz not null default now(),
  last_login_at timestamptz not null default now()
);

create table companies (
  id           bigint generated always as identity primary key,
  user_id      bigint not null references users(id) on delete cascade,
  name         text not null,
  careers_url  text,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table contacts (
  id              bigint generated always as identity primary key,
  user_id         bigint not null references users(id) on delete cascade,
  company_id      bigint references companies(id) on delete set null,
  name            text not null,
  role            text,
  kind            text not null default 'other'
                  check (kind in ('friend','recruiter','hiring_mgr','referral','other')),
  email           text,
  linkedin_url    text,
  warmth          text not null default 'cold'
                  check (warmth in ('cold','warm','strong')),
  notes           text,
  last_contact_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table applications (
  id           bigint generated always as identity primary key,
  user_id      bigint not null references users(id) on delete cascade,
  company_id   bigint not null references companies(id) on delete cascade,
  contact_id   bigint references contacts(id) on delete set null,
  role_title   text not null,
  jd_url       text,
  source       text,   -- 'referral','linkedin','cold','recruiter',...
  status       text not null default 'lead'
               check (status in ('lead','applied','screen','onsite','offer','rejected','withdrawn','ghosted')),
  location     text,
  remote       text check (remote in ('remote','hybrid','onsite')),
  salary_range text,
  applied_at   date,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table events (
  id             bigint generated always as identity primary key,
  user_id        bigint not null references users(id) on delete cascade,
  application_id bigint references applications(id) on delete cascade,
  contact_id     bigint references contacts(id) on delete cascade,
  type           text not null
                 check (type in ('note','email','call','meeting','status_change','applied','follow_up')),
  body           text,
  old_status     text,
  new_status     text,
  occurred_at    timestamptz not null default now(),
  source         text not null default 'manual' check (source in ('manual','ai')),
  created_at     timestamptz not null default now()
);

create index on contacts (user_id, company_id);
create index on applications (user_id, status);
create index on applications (user_id, company_id);
create index on events (user_id, occurred_at desc);
create index on events (application_id, occurred_at desc);
create index on events (contact_id, occurred_at desc);
```

Notes:
- Every domain table carries `user_id`; the API scopes every statement by it
  (see Authentication → Enforcement). `users` is the only table without one.
- `events` is **append-only** and is the timeline shown on every detail screen.
  Phase 2's AI writes `events` rows with `source='ai'` and may `PATCH` an
  application's `status`; keeping writes funneled here keeps the AI's blast
  radius small and auditable.
- `updated_at` is set by the API on each `PATCH` (no DB trigger needed at this scale).
- A `PATCH /api/applications` that changes `status` also inserts a
  `type='status_change'` event with `old_status`/`new_status`, `source='manual'`.
- **Needs-follow-up** (dashboard): applications whose `status` is active
  (`lead,applied,screen,onsite`) and whose latest `events.occurred_at`
  (or `created_at` if none) is older than 7 days.

## API routes

All under `/api`. Everything except `auth/login` and `auth/callback` requires a
valid session cookie, and every handler scopes its SQL to the caller's `uid`.

```
POST   /api/auth/login          302 -> GitHub
GET    /api/auth/callback       exchanges code, upserts user, sets cookie, 302 -> /
POST   /api/auth/logout         clears cookie
GET    /api/auth/me             { login, name, avatar_url } | 401

GET    /api/companies           ?q=            list
POST   /api/companies                          create
PATCH  /api/companies?id=       partial update
DELETE /api/companies?id=
GET    /api/companies?id=       company + its contacts + its applications

GET    /api/contacts            ?q= &kind= &company_id=
POST   /api/contacts
PATCH  /api/contacts?id=
DELETE /api/contacts?id=
GET    /api/contacts?id=        contact + linked company + linked applications + event timeline

GET    /api/applications        ?q= &status= &company_id=
POST   /api/applications
PATCH  /api/applications?id=    (status change writes an event)
DELETE /api/applications?id=
GET    /api/applications?id=    application + company + contact + event timeline

GET    /api/events             ?application_id= &contact_id= &limit=
POST   /api/events
DELETE /api/events?id=
```

## Screens

| Route | Contents |
|---|---|
| `/login` | "Sign in with GitHub" button only |
| `/` Dashboard | counts by status; needs-follow-up list; recent activity feed from `events` |
| `/applications` | table (company, role, status, applied date, last activity); filter by status; search; row → detail |
| `/applications/:id` | inline-editable fields, status dropdown, linked contact, event timeline, add-event box |
| `/contacts` | table (name, company, kind, warmth, last contact); filter by kind; search |
| `/contacts/:id` | fields, linked company, applications they're attached to, event timeline |
| `/companies` | list with contact/application counts |
| `/companies/:id` | company fields, its contacts, its applications |

Shared `<Timeline>` component is reused on all three detail screens.

Stretch (after the tables work): Kanban board for applications — columns are
statuses, drag a card to `PATCH` its status.

## Environment variables (Vercel project + `.env.local`)

```
DATABASE_URL            Neon connection string (pooled, ?sslmode=require)
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
SESSION_SECRET          long random string, HMAC key for the session cookie
APP_BASE_URL            https://callback-<suffix>.vercel.app  (http://localhost:5173 locally)
ALLOWED_GITHUB_LOGINS   optional; comma-separated. If set, only these logins can
                        create a new account. Unset = open signup.
```

## Build order

1. **Scaffold** — Vite + React + TS + Tailwind v4 + `/api` + `vercel.json`, matching
   the `lexpand` layout. Create the Neon project. Set all env vars in Vercel and
   `.env.local`.
2. **DB** — `schema.sql` (incl. `users`) + `api/_db.ts` (Neon client). Apply schema to Neon.
3. **Auth** — GitHub OAuth App registered; `api/auth.ts` (login/callback/logout/me)
   with the `users` upsert; `api/_auth.ts` (cookie sign/verify + `requireAuth`
   returning `{ uid, login }`); `/login` screen; app gate via `GET /api/auth/me`;
   `apiFetch` 401 handling.
4. **Companies + Contacts** — full slice: API handlers (all SQL scoped by `uid`),
   list screens, detail screens, create/edit forms with shared Zod schemas.
   Proves the ownership pattern on the simplest resources.
5. **Applications** — API + screens + the auto-event-on-status-change logic.
6. **Timeline + Events** — `<Timeline>` component and add-event box, wired into all
   three detail screens.
7. **Dashboard** — status counts, needs-follow-up query, activity feed.
8. **Deploy + smoke test**, then iterate (Kanban, richer filtering, CSV export).

Steps 4–7 are each independently shippable and usable.

## Explicitly out of scope for Phase 1

- Any Ollama / email / AI integration (Phase 2).
- Teams / shared workspaces / any sharing between users. Each account's data is
  fully private; multi-user here just means many isolated single-user workspaces.
- Account management UI (delete account, export). Deleting the `users` row
  cascades, but there's no button for it yet.
- File/resume attachments.
- Notifications and reminders beyond the on-screen needs-follow-up list.
- Full-text search infrastructure (simple `ILIKE` on name/title is enough).

## Phase 2 hooks already in place

- `events.source` column (`manual` | `ai`).
- All mutations funnel through the same authenticated `/api` routes the Phase 2
  desktop worker will call with a service token that resolves to one `user_id`
  (mechanism TBD in Phase 2), so AI writes land in that user's workspace only.
- Append-only `events` timeline so AI-derived changes are visible and reversible.
