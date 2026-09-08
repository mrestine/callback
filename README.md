# callback

Multi-user job-application tracker — contacts, companies, applications, and a
per-application event timeline. React + Vite SPA, Vercel serverless functions,
Neon Postgres. See [PHASE-1-PLAN.md](./PHASE-1-PLAN.md) for the full design.

## Local development

```sh
npm install
cp .env.example .env.local     # then fill in the values
npm run db:apply               # create tables in the DB from schema.sql
vercel dev                     # runs the SPA + /api functions together on :5173
```

`npm run dev` runs only the Vite frontend (no `/api`). Use `vercel dev` when you
need the API routes.

## Environment

See `.env.example`. All values are server-side (no `VITE_` vars); the same keys
must be set in the Vercel project for deployed environments, with `APP_BASE_URL`
pointing at the production URL.

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
