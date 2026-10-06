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
async function call(opts: { method: string; query?: Record<string, string | string[]>; headers?: Record<string, string> }) {
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

  type Match = { id: number; label: string; score: number } | null
  type Result = { name: string; exists: boolean; match: Match }
  const resultsOf = (r: { body?: Record<string, unknown> }) => (r.body?.results ?? []) as Result[]
  const ashbyId = Number((await sql`select id from companies where user_id = ${TEST_UID} and name = 'Ashby'`)[0].id)

  const ok = await call({ method: 'GET', query: { match: 'Ashby' }, headers: bearer })
  check('bearer token -> 200', ok.status === 200, ok)
  check('response is { results } only', Object.keys(ok.body ?? {}).join() === 'results', ok.body)
  check('a single name (string) -> one result', resultsOf(ok).length === 1, ok.body)
  const first = resultsOf(ok)[0]
  check('known company -> exists: true, match is that company', first?.exists === true && first.match?.id === ashbyId && first.match.label === 'Ashby', first)
  check('a result carries name, exists, match and nothing else', Object.keys(first ?? {}).sort().join() === 'exists,match,name', first)

  const many = await call({ method: 'GET', query: { match: ['Ashby', 'Zzyzx Holdings', 'Bright'] }, headers: bearer })
  const rs = resultsOf(many)
  check('several names (array) -> one result per name, in order', rs.map((r) => r.name).join('|') === 'Ashby|Zzyzx Holdings|Bright', many.body)
  check('unknown company -> exists: false, match: null', rs[1]?.exists === false && rs[1].match === null, rs[1])
  check('weak match -> exists: false, match: null (near-misses are not exposed)', rs[2]?.exists === false && rs[2].match === null, rs[2])

  // the route must not carry its own idea of "same company": for every name
  // it has to return exactly the company the pipeline would link to
  const names = ['Ashby', 'ASHBY', 'Bright', 'Brightwell Labs', 'Zzyzx Holdings', 'Zephyr']
  const agree = await call({ method: 'GET', query: { match: names }, headers: bearer })
  const chosen = await Promise.all(names.map(async (n) => (await matchCompany(TEST_UID, n)).chosen))
  check('match.id equals matchCompany().chosen for every name', resultsOf(agree).every((r, i) => (r.match?.id ?? null) === chosen[i] && r.exists === (chosen[i] !== null)), { got: resultsOf(agree).map((r) => r.match?.id ?? null), want: chosen })

  const blanks = await call({ method: 'GET', query: { match: ['', '  ', 'Ashby'] }, headers: bearer })
  check('blank names are ignored', resultsOf(blanks).length === 1 && resultsOf(blanks)[0].name === 'Ashby', blanks.body)

  const tooMany = await call({ method: 'GET', query: { match: Array.from({ length: 21 }, (_, i) => `Co ${i}`) }, headers: bearer })
  check('more than 20 names -> 400', tooMany.status === 400, tooMany)

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

async function scenarioPagination() {
  console.log('\n# GET /api/companies  (paged list: 20 per page)')
  await sql`
    insert into companies (user_id, name)
    select ${TEST_UID}, 'Pgtest ' || lpad(n::text, 2, '0') from generate_series(0, 44) n
  `
  await sql`insert into companies (user_id, name) values (${OTHER_UID}, 'Pgtest Someone Else')`
  const session = signSession({ uid: TEST_UID, login: 'test-bot' })
  const headers = { cookie: `cb_session=${encodeURIComponent(session)}` }
  type Body = { items: Record<string, unknown>[]; page: number; pageSize: number; total: number }
  const get = async (page?: string) => {
    const r = await call({ method: 'GET', query: { q: 'Pgtest', ...(page ? { page } : {}) }, headers })
    return { status: r.status, body: r.body as unknown as Body }
  }
  const names = (b: Body) => b.items.map((i) => i.name as string)

  const p1 = await get()
  check('no ?page -> page 1, 20 items, total 45', p1.status === 200 && p1.body.page === 1 && p1.body.items.length === 20 && p1.body.total === 45 && p1.body.pageSize === 20, p1.body)
  const p2 = await get('2')
  const p3 = await get('3')
  check('page 2 has 20, page 3 has the last 5', p2.body.items.length === 20 && p3.body.items.length === 5, [p2.body.items.length, p3.body.items.length])
  const all = [...names(p1.body), ...names(p2.body), ...names(p3.body)]
  check('pages are contiguous and in order, with no overlap or gap', all.length === 45 && new Set(all).size === 45 && all.join() === [...all].sort().join(), all)
  check("another user's companies are not counted or listed", !all.includes('Pgtest Someone Else') && p1.body.total === 45)
  check('the total column is not leaked into the rows', !('total' in p1.body.items[0]), p1.body.items[0])
  check('rows keep their counts', typeof p1.body.items[0].contact_count === 'number', p1.body.items[0])

  const past = await get('9')
  check('a page past the end serves the last page', past.body.page === 3 && past.body.items.length === 5 && past.body.total === 45, past.body)
  const junk = await get('abc')
  check('a junk page number falls back to page 1', junk.body.page === 1 && junk.body.items.length === 20, junk.body)
  const zero = await get('0')
  check('page 0 falls back to page 1', zero.body.page === 1, zero.body)

  const none = await call({ method: 'GET', query: { q: 'no such company zzz', page: '4' }, headers })
  const nb = none.body as unknown as Body
  check('no matches -> empty items, total 0, page 1', nb.items.length === 0 && nb.total === 0 && nb.page === 1, nb)
}

async function main() {
  await setup()
  try {
    await scenarioMatchCompany()
    await scenarioIsolation()
    await scenarioRoute()
    await scenarioPagination()
  } finally {
    await teardown()
  }
  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`)
  process.exit(failures === 0 ? 0 : 1)
}

await main()
