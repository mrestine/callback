/**
 * Ensures the dedicated test user exists and prints a signed session cookie for
 * it. ALL local API smoke tests run as this user (id 999) so real accounts are
 * never written or deleted by test traffic.
 *
 *   COOKIE=$(npm run -s test:session)
 *   curl -H "Cookie: $COOKIE" http://localhost:5173/api/companies
 *
 * Teardown: `npm run test:reset` (only ever deletes WHERE user_id = 999).
 */
import { config } from 'dotenv'
import { neon } from '@neondatabase/serverless'
import { createHmac } from 'node:crypto'

config({ path: ['.env', '.env.local'], quiet: true })

export const TEST_UID = 999

const url = process.env.DATABASE_URL
const secret = process.env.SESSION_SECRET
if (!url || !secret) {
  console.error('DATABASE_URL and SESSION_SECRET must be set (.env)')
  process.exit(1)
}

const sql = neon(url)

await sql`
  insert into users (id, github_id, github_login, name)
  overriding system value
  values (${TEST_UID}, 0, 'test-bot', 'Test Bot')
  on conflict (id) do nothing
`

const payload = Buffer.from(
  JSON.stringify({ uid: TEST_UID, login: 'test-bot', iat: Math.floor(Date.now() / 1000) }),
).toString('base64url')
const mac = createHmac('sha256', secret).update(payload).digest('base64url')
process.stdout.write(`cb_session=${payload}.${mac}`)
