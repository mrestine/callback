/**
 * Direct tests for company matching (matchCompany) and the token-accepting
 * lookup route (GET /api/companies?match=<name>), against the real DB, scoped
 * to test users 999 (and -998 for the cross-user isolation checks).
 *
 *   npm run test:companies
 *
 * The inbound pipeline scenarios in test-inbound.ts exercise matchCompany only
 * indirectly, through matchEntities; the cases here pin its own behavior and
 * the route's auth rules. Teardown is built in. Safe to re-run.
 */
import 'dotenv/config'
import { neon } from '@neondatabase/serverless'
import handler, { matchCompany } from '../api/companies.ts'
import { hashToken, signSession } from '../api/_auth.ts'

const TEST_UID = 999
const OTHER_UID = 998
const OTHER_GITHUB_ID = -998 // negative so it can't collide with a real GitHub id
const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL not set (.env)')
  process.exit(1)
}
const sql = neon(url)

let failures = 0
function check(label: string, cond: boolean, detail?: unknown) {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}`)
  if (!cond) {
    failures++
    if (detail !== undefined) console.log('       ', JSON.stringify(detail))
  }
}

async function teardown() {
  await sql`delete from api_tokens where user_id = ${TEST_UID}`
  await sql`delete from companies where user_id in (${TEST_UID}, ${OTHER_UID})`
  await sql`delete from users where id = ${OTHER_UID}`
}

async function setup() {
  await sql`
    insert into users (id, github_id, github_login, name) overriding system value
    values (${TEST_UID}, 0, 'test-bot', 'Test Bot') on conflict (id) do nothing
  `
  await teardown()
  await sql`
    insert into users (id, github_id, github_login, name) overriding system value
    values (${OTHER_UID}, ${OTHER_GITHUB_ID}, 'test-bot-2', 'Other Test Bot')
  `
}

async function addCompany(uid: number, name: string): Promise<number> {
  const [row] = await sql`insert into companies (user_id, name) values (${uid}, ${name}) returning id`
  return Number(row.id)
}

/** Invoke the route handler directly with a minimal req/res. */
async function call(opts: { method: string; query?: Record<string, string>; headers?: Record<string, string> }) {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(b: unknown) {
      this.body = b
      return this
    },
    setHeader() {
      return this
    },
    end() {
      return this
    },
  }
  const req = { method: opts.method, query: opts.query ?? {}, headers: opts.headers ?? {}, body: undefined }
  await handler(req as never, res as never)
  return { status: res.statusCode, body: res.body as Record<string, unknown> | undefined }
}

async function scenarioMatchCompany() {
  console.log('\n# matchCompany: exact, case, partial, unrelated, limit')
  const ashby = await addCompany(TEST_UID, 'Ashby')
  const brightwell = await addCompany(TEST_UID, 'Brightwell')
  const labs = await addCompany(TEST_UID, 'Brightwell Labs')
  for (const n of ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven']) await addCompany(TEST_UID, `Zephyr ${n}`)

  const exact = await matchCompany(TEST_UID, 'Ashby')
  check('exact name -> chosen', exact.chosen === ashby, exact)
  check('exact name -> top candidate has score 1', exact.candidates[0]?.id === ashby && exact.candidates[0].score === 1, exact)

  const upper = await matchCompany(TEST_UID, 'ASHBY')
  check('case-insensitive exact name -> chosen', upper.chosen === ashby, upper)

  const exactLabs = await matchCompany(TEST_UID, 'Brightwell Labs')
  check('exact name wins over a shorter name it contains', exactLabs.chosen === labs, exactLabs)

  const partial = await matchCompany(TEST_UID, 'Bright')
  const partialIds = partial.candidates.map((c) => c.id)
  check('partial name -> both Brightwell companies are candidates', partialIds.includes(brightwell) && partialIds.includes(labs), partial)

  const none = await matchCompany(TEST_UID, 'Zzyzx Holdings')
  check('unrelated name -> no candidates, nothing chosen', none.candidates.length === 0 && none.chosen === null, none)

  const many = await matchCompany(TEST_UID, 'Zephyr')
  check('more than 5 matches -> capped at 5', many.candidates.length === 5, many.candidates.length)
  const scores = many.candidates.map((c) => c.score)
  check('candidates are ordered best score first', scores.every((s, i) => i === 0 || scores[i - 1] >= s), scores)
}

async function scenarioIsolation() {
  console.log('\n# matchCompany never returns another user\'s companies')
  const mine = (await sql`select id from companies where user_id = ${TEST_UID} and name = 'Ashby'`)[0].id
  const theirs = await addCompany(OTHER_UID, 'Ashby')

  const asMe = await matchCompany(TEST_UID, 'Ashby')
  check('user 999 sees only their own Ashby', asMe.candidates.every((c) => c.id === Number(mine)), asMe)
  const asThem = await matchCompany(OTHER_UID, 'Ashby')
  check('the other user sees only theirs', asThem.candidates.length === 1 && asThem.candidates[0].id === theirs, asThem)
}

async function scenarioRoute() {
  console.log('\n# GET /api/companies?match=  (token or session; nothing else opens up to a token)')
  const raw = `cbk_test_${Math.random().toString(36).slice(2)}`
  await sql`insert into api_tokens (user_id, name, token_hash) values (${TEST_UID}, 'test-companies', ${hashToken(raw)})`
  const bearer = { authorization: `Bearer ${raw}` }

  const ok = await call({ method: 'GET', query: { match: 'Ashby' }, headers: bearer })
  const cands = (ok.body?.candidates ?? []) as { label: string }[]
  check('bearer token -> 200', ok.status === 200, ok)
  check('returns candidates', cands.length > 0 && cands[0].label === 'Ashby', ok.body)
  check('returns ONLY candidates (no verdict for the caller to lean on)', Object.keys(ok.body ?? {}).join() === 'candidates', ok.body)

  const anon = await call({ method: 'GET', query: { match: 'Ashby' } })
  check('no credentials -> 401', anon.status === 401, anon)

  const bad = await call({ method: 'GET', query: { match: 'Ashby' }, headers: { authorization: 'Bearer cbk_not_a_real_token' } })
  check('unknown token -> 401', bad.status === 401, bad)

  const list = await call({ method: 'GET', headers: bearer })
  check('token cannot list companies (no ?match)', list.status === 401, list)

  const anyId = Number((await sql`select id from companies where user_id = ${TEST_UID} limit 1`)[0].id)
  const del = await call({ method: 'DELETE', query: { id: String(anyId), match: 'x' }, headers: bearer })
  const stillThere = (await sql`select 1 from companies where id = ${anyId}`).length === 1
  check('token cannot delete a company', del.status === 401 && stillThere, { del, stillThere })

  const session = signSession({ uid: TEST_UID, login: 'test-bot' })
  const viaSession = await call({ method: 'GET', query: { match: 'Ashby' }, headers: { cookie: `cb_session=${encodeURIComponent(session)}` } })
  check('browser session also works', viaSession.status === 200, viaSession)
}

async function main() {
  await setup()
  try {
    await scenarioMatchCompany()
    await scenarioIsolation()
    await scenarioRoute()
  } finally {
    await teardown()
  }
  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`)
  process.exit(failures === 0 ? 0 : 1)
}

await main()
