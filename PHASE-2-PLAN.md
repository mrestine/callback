# callback — Phase 2 Plan: AI email ingestion

**Goal.** Forward job-search emails to a dedicated Gmail; a local worker (next to
Ollama, on the idle 3070 box) reads them, a small model extracts structured
fields, and the worker submits those to `callback`, which matches them to
existing companies / contacts / applications and queues a proposed change for
the operator to approve. **To start, nothing is applied without approval** —
every actionable submission goes through the review queue.

**`callback` doesn't know about email.** It exposes one generic endpoint
(`/api/inbound`) that takes an extracted structure + an opaque `external_ref`
for idempotency. Everything email-shaped — Gmail, forwards, subjects, message
ids, processing state — lives in the worker and in Gmail labels. `callback`
just sees "a suggested change from the ingestion worker."

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
| Datastore | Neon Postgres | **none** — Gmail labels are the state; one OAuth token file |
| Knows about email | **no** | yes — the only thing that does |
| Talks to models | **never** | the only thing that calls Ollama |
| Role | matching, propose an action, review + approve UI over `inbound_actions` (no unattended writes to start) | poll → clean → extract → submit → (disambiguate) |
| New in P2 | `/api/inbound*`, `/api/tokens`, review UI; `inbound_actions` + `api_tokens` tables + `events.inbound_action_id` | entire repo |

### Service boundary

- **No shared database, and `callback` has no email concepts.** `callback` has
  `DATABASE_URL`; the worker has no database at all (see Deployment). The
  `/api/inbound` payload is an extracted structure + an opaque `external_ref` —
  no `from_email`, `subject`, or `message_id` columns on the `callback` side.
- **HTTP only, one direction.** The worker makes outbound calls to
  `CALLBACK_API_URL`; `callback` never calls the worker. The worker can sit
  behind NAT on any network.
- **One bearer token is the entire trust relationship.** `callback` issues it
  (`/api/tokens`), the worker presents it. Revoking it fully severs the worker.
- **The worker never reads `callback`'s data.** Matching runs server-side inside
  `/api/inbound`; disambiguation candidates come back in that call's *response*,
  not from a query. There are no read endpoints for the worker.
- **Idempotency, not a queue.** The worker `POST`s `/api/inbound`; `callback`
  dedups on `unique(user_id, source, external_ref)` and inserts one
  `inbound_actions` row. A retry (lost response, worker restart) is a safe
  no-op.
- Publishing story: point the worker at any `callback` instance with a URL + a
  token. Nothing to provision for the worker but a Gmail OAuth token.

The worker is thin glue: poll → clean → one model call → `POST /api/inbound` →
relabel the message. Everything that needs the operator's data lives in
`callback`; everything email-shaped lives in the worker + Gmail.

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
  model, HTTPS to `CALLBACK_API_URL` for everything else). Volumes: `./secrets`
  (the Gmail OAuth token), and — for tuning — bind mounts of `./fixtures` and
  `./prompts` so `.eml`s and prompt edits take effect without a rebuild. **No
  database volume** — the worker keeps no state; Gmail labels are the state
  machine (§1, §8).

`docker compose up --build -d` then `docker compose logs -f worker`. Run the
tuning CLIs in the container: `docker exec callback-worker node dist/cli/batch.js fixtures/private`.

The worker never exposes Ollama to the LAN; the operator SSHes into the Windows
host and uses `docker exec`.

---

## Pipeline

### 1. Poll  *(worker, deterministic — Gmail labels are the state machine)*
- Gmail API, OAuth **desktop** credentials (one-time consent), token cached in
  `./secrets`. Scope `gmail.modify` (read + label).
- State via labels: `callback/inbox` → `callback/processing` →
  `callback/processed` | `callback/error`. (`callback/inbox` is applied by the
  operator's forwarding filter, §Intake.)
- Poll query: `label:callback/inbox -label:callback/processing
  -label:callback/processed -label:callback/error`. Low volume (a few forwards a
  day), so no `historyId` cursor and **no local store** — the query returns
  exactly what's outstanding.
- **Recovery:** also pick up anything stuck in `callback/processing` (a crash or
  lost response mid-flight) and re-run it. The re-submit is idempotent on
  `callback` via `external_ref` (the Gmail message id), so a double-send is a
  no-op.
- Fetch each message `users.messages.get?format=raw`, label it
  `callback/processing`.

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
`POST /api/inbound`, `Authorization: Bearer <service token>` → resolves to a
`user_id`. The body is deliberately generic — `callback` never learns this is an
email:

```jsonc
{
  "external_ref": "<gmail message id>",   // opaque idempotency key
  "source": "gmail-worker",
  "occurred_at": "<orig_date, ISO>",      // when the underlying thing happened
  "summary": "Recruiter Dana Alvarez wrote about a Backend Engineer role at Stripe",
  "thread_key": "dana@stripe.com|backend engineer at stripe",   // continuity hint (§5)
  "extracted": { ...the §3 JSON verbatim... }   // incl. sender.email for contact matching
}
```

The worker builds `summary` from the model's `notes`; `thread_key` is
`extracted.sender.email` + `extracted.hiring_company.name`/subject, ws-collapsed
and lowercased. No `from_email` / `subject` / `raw_excerpt` as named fields — the
review UI renders `summary` + `extracted`.

### 5. Match  *(API, deterministic + SQL — no model)*
1. **Dedup**: `inbound_actions` unique on `(user_id, source, external_ref)` →
   re-POST returns the existing row, no-op.
2. **Contact**: exact `extracted.sender.email` vs `contacts.email` (strong) →
   else trigram name match scoped to a matched company (weak) → else none.
3. **Hiring company**: only from `extracted.hiring_company` (never `sender.org`,
   never an agency). Trigram `hiring_company.name` vs `companies.name` → else via
   the matched contact's `company_id` (in-house contacts only). If
   `hiring_company.withheld` / null → no company match, expected.
4. **Application**: among the matched company's applications, trigram
   `extracted.role.title`; a single *active* application at that company is a
   strong hint. **Conversation continuity:** if a prior `inbound_actions` row
   with the same `thread_key` resolved to an application, reuse that link — the
   strongest signal, and it's what makes a mis-classified 2nd/3rd email in a
   thread harmless (the contact/app link is already set). Same `thread_key` +
   same `occurred_at` also flags a likely double-send → `duplicate`.
5. Emit `{ contact_id?, company_id?, application_id?, match_confidence:
   high|medium|low, candidates: [...], ambiguities: [...] }`.

### 6. Decide  *(API — builds a suggested action; does NOT apply it)*

**Everything goes through the approval queue to start.** `/api/inbound` never
mutates domain data (`companies` / `contacts` / `applications` / `events`). It
matches (§5), builds a **proposed action**, and stores the row as
`status='needs_review'`. The operator approves (or edits, or rejects) each one
in the Review UI (§7). The one exception: `noise` / `!job_related` →
`status='dismissed'`, nothing proposed. `duplicate` (§5.4) → `status='duplicate'`.

Rationale: the model and the match heuristics need real-world calibration before
anything writes unattended. Auto-apply is a later toggle (see Decisions), and
the proposed-action machinery below is exactly what it will reuse — so it's
built now, just not fired automatically.

**Proposed action** (stored in `inbound_actions.match.proposal`, rendered as the
pre-filled form in the Review UI):

*Contact* — match `sender.email` against `contacts`; exact hit → reuse. No hit →
propose *create contact*: if `is_agency_recruiter`, `company_id = NULL`,
`role = "Recruiter - " + sender.org`, `kind = 'recruiter'`; otherwise
`company_id` = the matched hiring company, `role`/`kind` from the model. Never
propose creating a `companies` row from `sender.org`.

*Company / application* — from `extracted.hiring_company` only (§5.3). If
`withheld` / null → no company, no application; the proposal is just the contact
+ an `email` event on the contact. If `name` present → the matched company (or
"create company" if no match), then the matched application (never "create
application" — that's always a manual choice in review).

*Event / status* — by `email_kind`, on a single confident application match:
| kind | proposed change (all `source='ai'`, `events.inbound_action_id` set) |
|---|---|
| `interview_scheduled` / `interview_invite` w/ a date | `interview` event (subtype, `occurred_at`, body = summary) |
| `rejection` | application `status='rejected'` + status_change event + `email` event |
| `offer` | application `status='offer'` + event |
| `status_update` / `application_confirmation` | `email` event with the summary |
| `recruiter_outreach` | contact + `email` event on the contact |

`match_confidence` and the candidate list ride along so the reviewer sees why
this was proposed and can pick a different target.

**Event `occurred_at`** (applied at approval time) =
`extracted.event.occurred_at ?? inbound_actions.occurred_at`. The model only
supplies a time when the email states a *future* interview / call slot;
otherwise the event is dated to `occurred_at` from the submission (the original
message date, which the worker passes but the model never echoes).

**Known limitation:** `applications.contact_id` is single-valued. If a second
recruiter surfaces for a role that already has a contact, the API logs an
`email` event ("also contacted by …") and leaves the primary contact. A
`application_contacts` join table is a future enhancement.

### 7. Review + approve  *(human → `callback`, session auth)*
Every actionable row lands here — nothing is applied before this step.

- The `inbound_actions` row *is* the review item (`status='needs_review'`). The
  webapp shows a **Review** queue: the `summary`, the `extracted` structure, the
  candidate matches, and the **proposed action** from §6 as a pre-filled form —
  target application (with a picker), the event/status change, whether a contact
  or company will be created.
- Buttons: **Approve** (apply the proposal as shown), **Approve with edits**
  (change the target / fields first), **Reject** (`status='dismissed'`, no
  mutation). Approving calls `POST /api/inbound/resolve?id=` with
  `{action:'apply', overrides?}`; the API then writes the events / status /
  contact / company changes, sets `status='applied'`, and records exactly what
  it did in `.applied`.
- Only on **Approve** does `callback` create a contact, create a company, link
  an application, write an event, or change an application status. Nothing here
  says "email".
- **Disambiguation lives in the worker.** When `/api/inbound` returns
  `needs_disambiguation` + candidates, the worker runs a second model call
  (multiple-choice) and calls `POST /api/inbound/resolve?id=` with the pick to
  narrow the proposal — the row still waits for human **Approve**. If the model
  says "none", it's left as-is. `callback` never calls a model.

### 8. Relabel  *(worker)*
On a 2xx from `/api/inbound`, move the Gmail message from `callback/processing`
to `callback/processed`. On a model failure in stage 3, move it to
`callback/error` (operator can strip the label to retry). On a transport failure
to `callback`, leave it in `callback/processing` — the next poll retries it.

---

## Data model additions

### `inbound_actions` — dedup + audit + review item, one row per submission
Source-agnostic: no email columns. `source` and `external_ref` are opaque
strings the worker chooses (today: `'gmail-worker'` and a Gmail message id);
`callback` never parses them.
```sql
create table inbound_actions (
  id            bigint generated always as identity primary key,
  user_id       bigint not null references users (id) on delete cascade,
  source        text not null,              -- opaque, e.g. 'gmail-worker'
  external_ref  text not null,              -- opaque dedup key from the worker
  occurred_at   timestamptz,                -- when the underlying thing happened
  summary       text,                       -- human-readable, from the worker
  payload       jsonb,                      -- the §3 extraction, verbatim
  match         jsonb,                      -- candidates + scores + proposal from §5/§6
  status        text not null default 'pending'
                check (status in ('pending','needs_review','applied',
                                  'auto_applied','dismissed','duplicate','error')),
                -- to start, actionable rows are always 'needs_review' -> 'applied'
                -- on human approve. 'auto_applied' is reserved for the later
                -- auto-apply toggle (Decisions).
  applied       jsonb,                       -- {event_ids:[], status_change:{...}}
  error         text,
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  thread_key    text generated always as (payload ->> 'thread_key') stored,
  unique (user_id, source, external_ref)
);
create index on inbound_actions (user_id, status, created_at desc);
create index on inbound_actions (user_id, thread_key);
```

### `events.inbound_action_id`
```sql
alter table events
  add column inbound_action_id bigint references inbound_actions (id) on delete set null;
```
Links a timeline entry back to the submission that produced it ("why did the AI
do this?"). `set null` so events outlive a deleted action row.

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

### No schema change for agencies

The agency convention (§3a) needs no new columns. An agency recruiter is just a
`contacts` row with `company_id = NULL` and `role = "Recruiter - <agency>"`,
which Phase 1 already supports. The known-agency list is **config**, not data:
`KNOWN_AGENCY_DOMAINS` / `KNOWN_AGENCY_NAMES` env on the worker and/or API.

---

## New API endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/inbound` | bearer token | worker submits an extracted structure + `external_ref`; runs match + builds a proposal; **applies nothing**; returns `{status: needs_review \| needs_disambiguation \| dismissed \| duplicate, proposal?, candidates?}` |
| POST | `/api/inbound/resolve?id=` | bearer token **or** session | worker posts `{choice}` after `needs_disambiguation` (narrows the proposal, still awaits approval); a human posts `{action:'apply', overrides?}` to approve, or `{action:'dismiss'}` to reject, from the review UI. `apply` is the only path that mutates domain data. |
| GET | `/api/inbound` | session | list inbound actions (`?status=needs_review` = the review queue; else history) |
| GET | `/api/inbound?id=` | session | one row + candidates + extraction |
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
  gmail.ts         auth, poll by label, fetch (format=raw), relabel           (later)
  submit.ts        POST /api/inbound / /api/inbound/resolve; retry/backoff    (later)
  loop.ts          orchestration + error handling + label transitions        (later)
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

**No worker datastore.** Gmail labels *are* the state machine
(`callback/inbox` → `callback/processing` → `callback/processed` |
`callback/error`) and the poll query returns exactly what's outstanding, so
there is no cursor, no seen-id cache, and no outbox. Delivery is still
at-least-once — a message left in `callback/processing` by a crash or a lost
response is re-run on the next poll — and `callback` is the idempotent receiver
via `unique(user_id, source, external_ref)`. The only file the worker persists
is the Gmail OAuth token (in `./secrets`).

Env: `OLLAMA_URL` (`http://host.docker.internal:11434` in the container),
`OLLAMA_MODEL`, `CALLBACK_API_URL`, `CALLBACK_TOKEN`,
`GMAIL_CREDENTIALS_PATH`, `GMAIL_TOKEN_PATH`, `GMAIL_QUERY` (the poll query),
`GMAIL_LABEL_PREFIX` (default `callback/`), `KNOWN_AGENCY_DOMAINS`,
`KNOWN_AGENCY_NAMES`, `POLL_INTERVAL_SECONDS`, `DRY_RUN` (extract + print, don't
submit or relabel). **No Postgres / Neon string, no `WORKER_DB_PATH`.**

Node + TS (ecosystem match). Shares the event/status **enums** with `callback`
via a copied `schemas` snippet or a tiny shared package.

### Build order (worker)

1. **`preprocess` + `extract` CLIs** + `clean.ts` + `model.ts` + the two
   schemas + prompts. No Gmail, no callback, no container required — runs against
   local fixtures and a local Ollama. **This is the model-tuning harness.**
   *(done)*
2. Containerise: `Dockerfile` + `docker-compose.yml` (worker service). *(done)*
3. `gmail.ts` — OAuth desktop consent, poll by label, fetch `format=raw`,
   relabel `callback/inbox` → `callback/processing`.
4. `submit.ts` (`POST /api/inbound`, retry/backoff) + `disambiguator.ts` +
   `loop.ts` (poll → clean → extract → submit → relabel; `callback/error` on a
   model failure). Replaces the `main.ts` heartbeat. Build the `callback` side
   (`inbound_actions`, `/api/inbound`, `/api/tokens`, review UI) alongside.

---

## Handoff map

| # | Stage | Runs | In | Out |
|---|---|---|---|---|
| 1 | Poll | worker | Gmail label query (no local state) | outstanding message ids; relabel → `callback/processing` |
| 2 | Clean | worker | raw MIME (a forward) | unwrapped `{orig_subject, orig_from, orig_to, orig_date, body}` |
| 3 | **Extract** | worker → **model** ×1 | subject/from/to/body | structured JSON + coarse confidences |
| 4 | Submit | worker | extracted JSON + `external_ref` + `occurred_at` + `summary` + `thread_key` | `POST /api/inbound` (retry/backoff; stays in `callback/processing` until 2xx) |
| 5 | Match | `callback` + SQL | `payload` (extracted JSON) | candidate ids + `match_confidence` |
| 6 | Propose | `callback` rules | match + `email_kind` | a proposed action; row saved `needs_review` (or `dismissed` / `duplicate`). **No domain writes.** |
| 7a | Disambiguate | worker → **model** ×1 | candidates from the response | `POST /api/inbound/resolve {choice}` narrows the proposal — or leave for human |
| 7b | Review + approve | human → `callback` (session) | proposal + overrides | `{action:'apply'}` → events / status / contact / company written (`source='ai'`, `inbound_action_id`), row → `applied`; or `{action:'dismiss'}` |
| 8 | Relabel | worker | 2xx from `callback` (or a model failure) | `callback/processed` (or `callback/error`) |

Always-on path: **one model call per email** (stage 3). Stage 7a fires only on
ambiguity. **Nothing mutates `callback`'s domain data before a human approves in
stage 7b** (to start — see Decisions). Neither service holds the other's DB
string; `callback` never learns this is email. The only coupling is the
`POST /api/inbound*` contract + the bearer token.

Note: the worker relabels to `callback/processed` on the `/api/inbound` 2xx —
i.e. once the row is *queued for review*, not once it's approved. Approval
happens later in the webapp on its own schedule; the Gmail message is done being
worked as soon as it's safely recorded.

---

## Model de-risking — done (2026-09-10)

The bake-off ran: `qwen2.5:7b-instruct`, `llama3.1:8b`, `gemma3:4b`, `phi3.5`
against the stage-3 constrained prompt (`temperature 0`, JSON-schema `format`,
`num_predict 512`) over 12 real forwarded emails. **`qwen2.5:7b-instruct` won**
— 12/12 `email_kind`, follows the negative field rules, ~6–13 s/email on the
3070. The small models ignored "never output N/A", produced out-of-range
confidences, and couldn't hold `interview_invite` vs `interview_scheduled`.
Results in `callback-worker/test-results/`. The local path is viable.

---

## Decisions

**Resolved**
- **Architecture** — two services, no shared DB, HTTP + one bearer token, worker
  outbound-only. All model calls (extract *and* disambiguate) in the worker;
  `callback` is model-free.
- **`callback` is source-agnostic** — one generic `inbound_actions` table
  (`unique(user_id, source, external_ref)`) and one `/api/inbound` endpoint
  taking an extracted structure + opaque `source`/`external_ref`. No email
  columns, no `ingested_emails`. Everything email-shaped lives in the worker.
- **Worker is near-stateless** — Gmail labels
  (`callback/inbox` → `callback/processing` → `callback/processed` |
  `callback/error`) are the state machine. No SQLite, no cursor, no outbox; the
  only persisted file is the Gmail OAuth token. At-least-once via re-polling
  `callback/processing`; `callback` is the idempotent receiver.
- **Model** — `qwen2.5:7b-instruct`, chosen by bake-off (see above).
- **Gmail intake** — operator forwards from personal Gmail to a dev-account
  `+callback` address; every message is a forward, the worker unwraps it (§2,
  Intake model).
- **Agencies** — never become `companies`; agency recruiter = contact with
  `company_id=NULL`, `role="Recruiter - <agency>"` (§3a).
- **Worker language** — Node/TS (ecosystem match with `callback`; `mailparser` +
  `zod` cover cleaning and schema).
- **Approval, to start** — **everything actionable goes through the review
  queue**; `/api/inbound` proposes but never writes domain data. Only a human
  **Approve** in the webapp applies a change (§6, §7). Auto-apply is deferred
  until the model + match heuristics have real-world calibration; the proposal
  machinery is built now so enabling it later is a policy toggle, not new code.

**Open**
1. **Auto-apply policy (deferred, not off forever).** Once trusted, allow
   unattended apply for a narrow set — likely interview scheduling + status
   changes, only on a confident single-application match, never auto-creating an
   application. Per-`email_kind` and/or per-confidence toggle in Settings.
   Revisit after ~a few weeks of real traffic in the queue.
2. **Token model.** `api_tokens` table + Settings UI (multi-user correct) vs a
   single `INGEST_TOKEN` env var (solo shortcut). Leaning `api_tokens`.
3. **`role` label template** and the seed `KNOWN_AGENCY_DOMAINS` /
   `KNOWN_AGENCY_NAMES` list — finalise at build time.
