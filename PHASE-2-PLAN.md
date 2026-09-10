# callback — Phase 2 Plan: AI email ingestion

**Goal.** Forward job-search emails to a dedicated Gmail; a local worker (next to
Ollama, on the idle 3070 box) reads them, a small model extracts structured
fields, and the `callback` API matches them to existing companies / contacts /
applications and either acts or queues the email for human review.

**Constraints.**
- $0: the always-on model is local Ollama. No hosted-API dependency in the
  default path.
- Operator-only: Ollama isn't public, so ingestion runs on the operator's
  machine. The webapp stays multi-user; ingestion is one user's worker with a
  token.
- Publishable: the worker is its own repo, configured entirely by env, pointed
  at any `callback` instance + any Ollama.

**Intake model (confirmed).** The operator's *personal* Gmail is where the job
search actually happens. A separate *dev* Gmail runs the bot. The operator
manually forwards job-search emails from personal → `devacc+callback@gmail.com`.
It is only ever the operator forwarding; the address is never given out as a
point of contact. Consequences:
- Every message the worker sees is a **forward**. Envelope `From` is always the
  operator; envelope `To` is always `devacc+callback@…`. Useless.
- The real sender / recipient / subject / date are **inside the body**, in
  Gmail's `---------- Forwarded message ----------` block. The worker parses
  those out; they are what the model and the API see.
- OAuth is on the dev account only — the personal mailbox is never touched.
- Gmail filter: `deliveredto:devacc+callback@gmail.com` → label `callback/inbox`
  (match `deliveredto:`, not the "To" field, which relays rewrite).
- **Simple and decisive.** The model does narrow extraction/classification only.
  All matching, all decisions, all confidence that drives an action are
  deterministic code in the API.

---

## Two services

| | `callback` (core) | `callback-worker` (ingestion) |
|---|---|---|
| Where | Vercel + Neon (built, Phase 1) | operator's desktop, beside Ollama |
| Public / always-on | yes | no — GPU box, may be asleep |
| Datastore | Neon Postgres (domain data + `ingested_emails`) | **local SQLite** — Gmail cursor + outbox only |
| Talks to models | **never** | the only thing that calls Ollama |
| Role | CRUD, matching, decision rules, review UI | poll → clean → extract → submit → (disambiguate) |
| New in P2 | `/api/ingest*`, `/api/tokens`, review UI, 3 schema additions | entire repo |

### Service boundary

- **No shared database.** Neither service holds the other's DB connection string
  in its env. `callback` has `DATABASE_URL`; the worker has a local SQLite path.
  That's it.
- **HTTP only, one direction.** The worker makes outbound calls to
  `CALLBACK_API_URL`; `callback` never calls the worker. The worker can sit
  behind NAT on any network.
- **One bearer token is the entire trust relationship.** `callback` issues it
  (`/api/tokens`), the worker presents it. Revoking it fully severs the worker.
- **The worker never reads `callback`'s data.** Matching runs server-side inside
  `/api/ingest`; disambiguation candidates come back in that call's *response*,
  not from a query. There are no read endpoints for the worker.
- **The worker never writes a queue row directly.** It `POST`s `/api/ingest`;
  `callback`'s handler inserts `ingested_emails`.
- Publishing story: point the worker at any `callback` instance with a URL + a
  token. No database to provision for the worker beyond a local file.

The worker is thin glue: poll → clean → one model call → `POST /api/ingest` →
act on the response → label the message. Everything that needs to know the
operator's data lives in `callback`.

### Deployment — operator's desktop (Docker Desktop, Windows, RTX 3070)

Two containers, managed **separately**:

- **`ollama`** — the stock `ollama/ollama` image, its own container:
  `docker run -d --name ollama --gpus=all --restart unless-stopped -v ollama:/root/.ollama -p 11434:11434 ollama/ollama`.
  Its entrypoint is `serve`, so there's nothing to remember. `docker exec ollama
  ollama pull <model>`.
- **`callback-worker`** — `callback-worker/docker-compose.yml`, worker service
  only. Reaches Ollama at **`OLLAMA_URL=http://host.docker.internal:11434`**
  (Docker Desktop provides `host.docker.internal`; `network_mode: host` does not
  work there). No published ports — outbound only (`host.docker.internal` for the
  model, HTTPS to `CALLBACK_API_URL` for everything else). Volumes: a named
  `data` volume (SQLite: cursor + outbox), and — for tuning — bind mounts of
  `./fixtures` and `./prompts` so `.eml`s and prompt edits take effect without a
  rebuild.

`docker compose up --build -d` then `docker compose logs -f worker`. Run the
tuning CLIs in the container: `docker exec callback-worker node dist/cli/batch.js fixtures/private`.

The worker never exposes Ollama to the LAN; the operator SSHes into the Windows
host and uses `docker exec`.

---

## Pipeline

### 1. Poll  *(worker, deterministic)*
- Gmail API, OAuth **desktop** credentials (one-time consent), token cached
  locally. Scope `gmail.modify` (read + label).
- Query: `label:callback/inbox -label:callback/processed`, resumed from the
  `historyId` cursor in local SQLite.
- Skip any message id already in the local `seen` set. `callback`'s
  `unique(user_id, source, source_message_id)` is the authoritative dedup; this
  is just a fast local pre-filter (the worker has no access to `callback`'s DB).
- Fetch full message (`users.messages.get?format=full`).

### 2. Clean / normalise  *(worker, deterministic — no model)*
- Parse MIME. Prefer `text/plain`; fall back to `text/html` → strip tags.
- **Unwrap the forward.** Every message is a forward (see Intake model). Locate
  the `---------- Forwarded message ----------` boundary and parse the reproduced
  header lines (`From:`, `To:`, `Subject:`, `Date:`) that follow it. These give
  the *original* sender name+email, recipient, subject, and date. If no forward
  block is found, fall back to the envelope headers and flag it.
- **Strip quoted replies** *from the forwarded body*: `>` prefixes,
  `On <date>, <name> wrote:`, `-----Original Message-----`, Gmail
  `div.gmail_quote`. Library: `email-reply-parser` (Node) or `talon` (Python).
- Strip signatures (after `-- \n`, trailing contact blocks) — lower priority.
- Emit `{ orig_subject, orig_from:{name,email}, orig_to:{name,email},
  orig_date, forward_message_id, cleaned_body }`.
- Truncate `cleaned_body` to ~4 000 chars.
- **The model only ever sees `orig_subject`, `orig_from`, `orig_to`,
  `cleaned_body`** — the parsed-out originals, not the envelope. `orig_date` and
  `forward_message_id` go to the API for matching / dedup, not the model.

### 3. Extract  *(THE model call — one per email, temp 0, JSON-schema-constrained)*
Input: compact rendering of subject / from / to / body.
Output (constrained; the grammar makes rambling impossible):

```jsonc
{
  "job_related": true,
  "email_kind": "recruiter_outreach",   // enum, see below
  "sender": {
    "name": "Dana Alvarez", "email": "dana@motionrecruitment.com",
    "org": "Motion Recruitment",        // the sender's own employer
    "is_agency_recruiter": true,        // agency vs in-house (see §3a)
    "kind": "recruiter",                // contact kind, best guess
    "confidence": 0.85
  },
  "hiring_company": {
    "name": "Stripe",                   // the ACTUAL employer, or null
    "withheld": false,                  // true = "confidential client" / blind JD
    "confidence": 0.6
  },
  "role":   { "title": "Backend Engineer", "confidence": 0.6 },
  "event":  { "type": "email", "subtype": null,
              "occurred_at": null,      // ISO if a date/time is stated
              "summary": "JD forwarded: Backend Engineer at Stripe, remote, $190-220k" },
  "status_signal": null,                // an ApplicationStatus, or null
  "notes": "one-line plain-English summary of what this email means"
}
```

`email_kind` enum: `rejection | interview_invite | interview_scheduled |
recruiter_outreach | offer | assessment_invite | application_confirmation |
info_request | status_update | referral | networking | noise`.

**Confidence scores caveat.** A 7B's self-reported confidence is poorly
calibrated — treat it as a coarse 3-bucket hint (high / medium / low), never a
probability. The number that drives whether the API acts is the API's own
**match confidence** (§5), computed from how good the record match is.

Model: **`qwen2.5:7b-instruct`** (chosen 2026-09-10 after a bake-off — see
`callback-worker/test-results/`). phi3.5 and gemma3:4b ignored negative
instructions and couldn't hold the invite/scheduled distinction; qwen2.5:7b
gets 12/12 `email_kind` and follows the field rules. ~6–13 s/email on the 3070,
fine at a 60–120 s poll. `num_predict` 512. Temperature 0, JSON-schema `format`.
Known soft spots to revisit with real traffic: `is_agency_recruiter` on novel
recruiter domains, `role.title` under-extraction on vague pitches.

### 3a. Agencies vs employers  *(a hard operator convention)*

The operator keeps **recruitment agencies out of `companies`** — that list is
only employers they will actually apply to. An agency recruiter is a `contacts`
row with `company_id = NULL` and `role` = `"Recruiter - <agency>"` (e.g.
`"Recruiter - Motion Recruitment"`). One agency recruiter sends many unrelated
JDs over time, often for different employers, sometimes with the employer
withheld ("a confidential Series B fintech").

Encoded in three places:

1. **Model prompt.** "Agencies (Motion Recruitment, Robert Half, TEKsystems,
   Insight Global, Cybercoders, …) are never the hiring company. If the sender
   works for an agency, `hiring_company` is the employer they're recruiting
   *for* — or `null` with `withheld: true` if the email doesn't name it. Put the
   agency in `sender.org`, never in `hiring_company`." The model outputs
   `sender.org` raw; it does **not** format the `role` label.
2. **Known-agency list** (worker/API config): `KNOWN_AGENCY_DOMAINS` +
   `KNOWN_AGENCY_NAMES`. If `sender.email`'s domain matches, `is_agency_recruiter`
   is forced true regardless of the model. Deterministic for the recruiters the
   operator already deals with; model fallback for the rest.
3. **API decision layer** (§6): never create a `companies` row from
   `sender.org`. The `role` label is assembled by the API as
   `"Recruiter - " + sender.org`, not by the model.

### 4. Submit  *(worker → API)*
`POST /api/ingest`, `Authorization: Bearer <service token>` → resolves to a
`user_id`.

```jsonc
{
  "source_message_id": "<gmail id of the FORWARD>",
  "received_at": "<orig_date parsed from the forward block>",
  "from_email": "dana@stripe.com", "from_name": "Dana Alvarez",  // the ORIGINAL sender
  "to_email": "operator@personal.gmail.com",                     // the ORIGINAL recipient
  "subject": "<orig_subject>",
  "raw_excerpt": "first ~500 chars of cleaned body",   // for the review UI
  "extracted": { ...the §3 JSON verbatim... }
}
```

No `thread_id` — forwards don't share threads (see §5).

### 5. Match  *(API, deterministic + SQL — no model)*
1. **Dedup**: `ingested_emails` unique on `(user_id, source, source_message_id)`
   → re-POST returns the existing row, no-op.
2. **Contact**: exact `sender.email` match (strong) → else trigram name match
   scoped to a matched company (weak) → else none.
3. **Hiring company**: only from `extracted.hiring_company` (never `sender.org`,
   never an agency). `from_email` domain vs `companies.email_domains` (strong,
   only meaningful for in-house senders) → else trigram
   `hiring_company.name` vs `companies.name` → else via the matched contact's
   `company_id` (in-house contacts only; agency contacts have none). If
   `hiring_company.withheld` / null → no company match, and that's expected.
4. **Application**: among the matched company's applications, trigram
   `extracted.role.title`; a single *active* application at that company is a
   strong hint. **Conversation continuity** (forwards don't share a Gmail
   thread, so we synthesise one): the worker computes `thread_key` =
   lowercased `orig_from.email` + `orig_subject` with `re:`/`fwd:` and extra
   whitespace stripped. If a prior `ingested_emails` row has the same
   `thread_key` and was linked to an application, reuse that link — this is the
   strongest available signal. Same `thread_key` + same `orig_date` also flags a
   likely **double-forward** → `duplicate`.
5. Emit `{ contact_id?, company_id?, application_id?, match_confidence:
   high|medium|low, candidates: [...], ambiguities: [...] }`.

### 6. Decide  *(API, rule table on match result + `email_kind`)*

**Contact resolution (always first, low risk):**
- Match `sender.email` against `contacts` → exact hit reuses it.
- No hit → create the contact. If `is_agency_recruiter`: `company_id = NULL`,
  `role = "Recruiter - " + sender.org`, `kind = 'recruiter'`. Otherwise
  `company_id` = the matched hiring company, `role`/`kind` from the model.
- Never create a `companies` row from `sender.org`.

**Then, on `hiring_company`:**
- `withheld: true` or `name: null` → **no company, no application.** Log an
  `email` event on the *contact* with the JD summary. `status='needs_review'`
  only if the kind implies the operator should act now; otherwise
  `auto_applied` (contact + note is safe).
- `name` present → match/needs-review a `companies` row as in §5.

**Then the rest:**
- high match + single application + actionable kind → auto-apply (table below).
- medium/low, or >1 candidate, or a consequential change → `needs_review`.
- no application match + `job_related` → `needs_review`.
- `noise` / `!job_related` → mark processed, do nothing (still logged).
- **Never auto-create an application.** Always review.

Auto-apply mapping (only on a confident single-application match):
| kind | action (all `source='ai'`, linked to the email) |
|---|---|
| `interview_scheduled` / `interview_invite` w/ a date | `scheduled` event (type `interview`, subtype, `occurred_at`, body = summary) |
| `rejection` | application `status='rejected'` (auto status_change event) + `email` event |
| `offer` | `status='offer'` + event |
| `status_update` / `application_confirmation` | `email` event with the summary |
| `recruiter_outreach`, no application | contact resolved above + `email` event on the contact; `needs_review` if a named hiring company has no application yet |

**Event `occurred_at`** = `extracted.event.occurred_at ?? ingested_emails.received_at`.
The model only supplies a time when the email body states a *future* interview /
call slot; for a rejection, confirmation, or note the API dates the event to the
email itself (`received_at` = the original message date). The model is never
asked to echo the email's own date.

**Known limitation:** `applications.contact_id` is single-valued. If a second
recruiter surfaces for a role that already has a contact, the API logs an
`email` event ("also contacted by …") and leaves the primary contact. A
`application_contacts` join table is a future enhancement.

### 7. Act / review
- **7a auto** — API writes the events / status changes, sets
  `ingested_emails.status='auto_applied'`, records what it did in `.applied`.
- **7b review** — the `ingested_emails` row *is* the review item
  (`status='needs_review'`). The webapp shows a **Review** queue: email excerpt,
  the model extraction, candidate matches, and buttons — *Link to <application>*,
  *Create application*, *Create contact*, *Dismiss*. Resolving calls
  `POST /api/ingest/:id/resolve` which applies the action.
- **Disambiguation lives in the worker.** When `/api/ingest` returns
  `needs_disambiguation` + candidates, the worker runs a second model call
  (multiple-choice — a 7B does this well) and calls
  `POST /api/ingest/resolve` with the pick, or leaves it for human review if the
  model also says "none". `callback` never calls a model.

### 8. Mark processed  *(worker)*
Label the Gmail message `callback/processed`; advance the `historyId` cursor.

---

## Data model additions

### `ingested_emails` — dedup + audit + review item, one row per email
```sql
create table ingested_emails (
  id                bigint generated always as identity primary key,
  user_id           bigint not null references users (id) on delete cascade,
  source            text not null default 'gmail',
  source_message_id text not null,          -- gmail id of the forward
  thread_key        text,                   -- synthesised: orig_from + normalised subject
  received_at       timestamptz,            -- orig_date, parsed from the forward block
  from_email        text,                   -- ORIGINAL sender
  from_name         text,
  subject           text,                   -- ORIGINAL subject
  raw_excerpt       text,
  extracted         jsonb,                 -- model output, verbatim
  email_kind        text,
  status            text not null default 'pending'
                    check (status in ('pending','auto_applied','needs_review',
                                      'dismissed','duplicate','error')),
  match             jsonb,                 -- candidates + scores from §5
  applied           jsonb,                 -- {event_ids:[], status_change:{...}}
  error             text,
  created_at        timestamptz not null default now(),
  resolved_at       timestamptz,
  unique (user_id, source, source_message_id)
);
create index on ingested_emails (user_id, status, created_at desc);
create index on ingested_emails (user_id, thread_key);
```

### `events.source_email_id`
```sql
alter table events
  add column source_email_id bigint references ingested_emails (id) on delete set null;
```
Links a timeline entry back to the email that produced it ("why did the AI do
this?"). `set null` so events outlive a deleted email.

### `api_tokens` — worker → API auth
```sql
create table api_tokens (
  id           bigint generated always as identity primary key,
  user_id      bigint not null references users (id) on delete cascade,
  name         text not null,
  token_hash   text not null unique,       -- sha256(raw); raw shown once
  scopes       text[] not null default '{ingest}',
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
```
Raw token `cbk_<32 random bytes base64url>`. Generated in the webapp's Settings,
pasted into the worker env. API middleware hashes the bearer, looks it up, gets
`user_id`, bumps `last_used_at`.
*Solo shortcut alternative:* a single `INGEST_TOKEN` env var mapping to one
`user_id` — no table, no UI, but every self-hoster edits env. `api_tokens` is
the multi-user-correct choice.

### `companies.email_domains text[]`  *(recommended, optional)*
```sql
alter table companies add column email_domains text[] not null default '{}';
```
`{stripe.com}` makes `from_email` → company matching exact and strong. Populated
when resolving a review item, or by hand. Cheap, big matching-quality win.
Only meaningful for in-house senders — agency recruiters' domains are never
company domains.

### No schema change for agencies

The agency convention (§3a) needs no new columns. An agency recruiter is just a
`contacts` row with `company_id = NULL` and `role = "Recruiter - <agency>"`,
which Phase 1 already supports. The known-agency list is **config**, not data:
`KNOWN_AGENCY_DOMAINS` / `KNOWN_AGENCY_NAMES` env on the worker and/or API.

---

## New API endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/ingest` | bearer token | worker submits an extracted email; runs match + decide; returns `{status: auto_applied \| needs_review \| needs_disambiguation \| duplicate, applied? , candidates?}` |
| POST | `/api/ingest/resolve?id=` | bearer token **or** session | resolve a pending row: the worker posts `{choice}` after a `needs_disambiguation`; a human posts `{action:'link'\|'create_application'\|'create_contact'\|'dismiss', ...}` from the review UI |
| GET | `/api/ingest` | session | list ingested emails (`?status=needs_review` = the review queue; else history) |
| GET | `/api/ingest?id=` | session | one row + candidates + extraction |
| POST | `/api/tokens` | session | create a token (raw returned once) |
| GET | `/api/tokens` | session | list (no raw) |
| DELETE | `/api/tokens?id=` | session | revoke |

`api/_auth.ts` gains `requireToken(req, res)` (hash bearer → `api_tokens` →
`{uid, scopes}`) alongside the existing cookie `requireAuth`.

---

## The worker repo — `callback-worker`

```
src/
  cli/
    preprocess.ts  .eml / {raw} JSON -> normalized JSON        (built first)
    extract.ts     normalized JSON -> extraction JSON          (built first — model tuning loop)
  clean.ts         mailparser, unwrap forward, reply + signature strip
  model.ts         Ollama client: chat, format=schema, temperature 0, num_predict cap
  extractor.ts     render prompt + call model + validate -> extraction JSON
  disambiguator.ts render prompt + call model -> chosen candidate
  gmail.ts         auth, poll (historyId cursor), fetch (format=raw), label   (later)
  store.ts         local SQLite: cursor, seen-id cache, outbox                (later)
  submit.ts        drain outbox -> POST /api/ingest / /api/ingest/resolve; backoff   (later)
  loop.ts          orchestration + error handling                            (later)
prompts/
  extract.system.md        the extraction instructions (incl. §3a agency rules, prose form)
  extract.fewshot/*.md     labelled examples
  disambiguate.system.md
schemas/
  normalized.json          contract: preprocess output  (also a Zod schema in src/)
  extraction.json          constrained-decoding schema for the model output
fixtures/
  sample/                  sanitised, committed
  private/                 real emails, gitignored
Dockerfile
docker-compose.yml         worker service; bind-mounts fixtures/ + prompts/ for tuning (see "Deployment")
.env.example
README.md
```

> Built so far (`mrestine/callback-worker`): Stage 1 (`preprocess`/`extract`/
> `pipe`/`batch` CLIs, `clean.ts`, `model.ts`, `extractor.ts`, `schemas.ts`,
> `prompts/extract.system.md` with inline few-shot) and Stage 2 (`Dockerfile`,
> `docker-compose.yml`, `src/main.ts` = an Ollama-connectivity heartbeat until
> the loop lands). Schemas are Zod in `src/schemas.ts` (no static `schemas/*.json`
> — the model schema is generated via `zod-to-json-schema`).

Prompts, few-shot examples, and JSON schemas that shape model behaviour **all
live here** — `callback` holds none. The prose form of the agency convention
(§3a) is in `prompts/extract.system.md`; the *enforcement* is code in
`callback` (§6). Two expressions, by design.

**Local SQLite** (`WORKER_DB_PATH`) holds only the worker's own operational
state — never domain data:
- `cursor` — last Gmail `historyId` processed
- `seen` — message ids already handled (fast local dedup; `callback`'s
  `unique(user_id, source, source_message_id)` is the authoritative check)
- `outbox` — `{message_id, payload, attempts, last_error}`; extraction result is
  written here first, then drained to `callback`. If `callback` is down nothing
  is lost. **At-least-once**; the receiver is idempotent.

Env: `OLLAMA_URL` (`http://host.docker.internal:11434` in the container), `OLLAMA_MODEL`,
`CALLBACK_API_URL`, `CALLBACK_TOKEN`, `WORKER_DB_PATH`,
`GMAIL_CREDENTIALS_PATH`, `GMAIL_TOKEN_PATH`, `GMAIL_QUERY`,
`KNOWN_AGENCY_DOMAINS`, `KNOWN_AGENCY_NAMES`, `POLL_INTERVAL_SECONDS`,
`DRY_RUN` (extract + print, don't submit). **No Postgres / Neon string.**

Node + TS (ecosystem match). Shares the event/status **enums** with `callback`
via a copied `schemas` snippet or a tiny shared package.

### Build order (worker)

1. **`preprocess` + `extract` CLIs** + `clean.ts` + `model.ts` + the two
   schemas + prompts. No Gmail, no callback, no container required — runs against
   local fixtures and a local Ollama. **This is the model-tuning harness.**
2. Containerise: `Dockerfile` + `docker-compose.yml` (ollama + worker).
3. `gmail.ts` (OAuth, poll, fetch `format=raw`, label) + `store.ts` (SQLite).
4. `submit.ts` (outbox → `/api/ingest`) + `disambiguator.ts` + `loop.ts`.

---

## Handoff map

| # | Stage | Runs | In | Out |
|---|---|---|---|---|
| 1 | Poll | worker | local cursor + `seen` | new message ids |
| 2 | Clean | worker | raw MIME (a forward) | unwrapped `{orig_subject, orig_from, orig_to, orig_date, body}` |
| 3 | **Extract** | worker → **model** ×1 | subject/from/to/body | structured JSON + coarse confidences |
| 4 | Enqueue + submit | worker | extracted JSON + email meta | write to local outbox → `POST /api/ingest` (retry/backoff) |
| 5 | Match | `callback` + SQL | extracted JSON | candidate ids + `match_confidence` |
| 6 | Decide | `callback` rules | match + `email_kind` | `auto_applied` \| `needs_review` \| `needs_disambiguation` |
| 7a | Auto-act | `callback` | plan | events / status changes (`source='ai'`, `source_email_id`) |
| 7b | Disambiguate | worker → **model** ×1 | candidates from the response | `POST /api/ingest/resolve {choice}` — or leave for human |
| 8 | Human resolve | human → `callback` (session) | choice | action applied |
| 9 | Mark done | worker | 2xx from `callback` | Gmail label + advance local cursor / `seen` |

Always-on path: **one model call per email** (stage 3). Stage 7b fires only on
ambiguity. Neither service holds the other's DB string; the only coupling is the
`POST /api/ingest*` contract + the bearer token.

---

## Before building — de-risk the model (do this first)

Forward ~10 real job emails. Run `qwen2.5:7b`, `llama3.1:8b`, `gemma3:4b`,
and `phi3.5` against the stage-3 constrained prompt at `temperature 0`,
`num_predict 200`, JSON-schema `format`. Judge: correct `email_kind`, correct
company/role/contact extraction, no waffling, valid JSON every time. Commit to
the crispest one. This single test decides whether the local path is viable and
which model the rest of Phase 2 assumes.

---

## Decisions

**Resolved**
- **Architecture** — two services, no shared DB, HTTP + one bearer token, worker
  outbound-only. All model calls (extract *and* disambiguate) in the worker;
  `callback` is model-free. Matching + decision rules + review queue in
  `callback` (co-located with the data; the review UI needs the always-on
  service). Worker keeps a local SQLite for cursor + at-least-once outbox only.
- **Gmail intake** — operator forwards from personal Gmail to a dev-account
  `+callback` address; every message is a forward, the worker unwraps it (§2,
  Intake model).
- **Agencies** — never become `companies`; agency recruiter = contact with
  `company_id=NULL`, `role="Recruiter - <agency>"` (§3a).

**Open**
1. **Auto-apply policy.** Default: auto-apply only interview scheduling + status
   changes, only on a confident single-application match; never auto-create an
   application; everything else → review. Tighten / loosen?
2. **Token model.** `api_tokens` table + Settings UI (multi-user correct) vs a
   single `INGEST_TOKEN` env var (solo shortcut).
3. **`companies.email_domains`** — add it? (recommended.)
4. **Worker language** — Node/TS (ecosystem match) vs Python (`talon` for reply
   stripping is very good).
5. **`role` label template** and the seed `KNOWN_AGENCY_DOMAINS` /
   `KNOWN_AGENCY_NAMES` list — finalise at build time.
