# callback

Multi-user job-application tracker — contacts, companies, applications, and a
per-application event timeline. React + Vite SPA, Vercel serverless functions, Neon Postgres.

This works just fine on its own, but it's enhanced by the [callback-worker](https://github.com/mrestine/callback-worker), which can generate change proposals from emails. For more details, see that repo or check out the full [Development Outline](./development-outline.md).

## Local development

```sh
npm install
cp .env.example .env           # then fill in the values (see Environment below)
npm run db:apply               # create tables in the DB from schema.sql
vercel dev --listen 5173       # runs the SPA + /api functions together on :5173
```

`npm run dev` runs only the Vite frontend (no `/api`). Use `vercel dev` when you
need the API routes. Pass `--listen 5173` so the origin matches `APP_BASE_URL`
and the GitHub OAuth callback URL (its default port is 3000).

## Environment

Local dev reads `.env` (not `.env.local` — `vercel dev`'s function runtime only
loads `.env`). All values are server-side; no `VITE_` vars. The same keys must be
set in the Vercel project for deployed environments, with `APP_BASE_URL` pointing
at the production URL. See `.env.example` for the full list and where each comes
from.

## Layout

```
src/            React SPA
  routes/       screen components
  lib/          api client, query client, auth hook
  schemas/      Zod schemas shared with the API
api/            Vercel serverless functions
  _db.ts        Neon client
  _auth.ts      session cookie + requireAuth
  auth/[action].ts   GitHub OAuth: login / callback / logout / me
  health.ts     DB connectivity check
schema.sql      database schema (idempotent)
scripts/        one-off scripts (db:apply)
```

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Vite dev server only |
| `npm run build` | typecheck + production build to `dist/` |
| `npm run typecheck` | `tsc -b --noEmit` |
| `npm run db:apply` | apply `schema.sql` to `DATABASE_URL` |
