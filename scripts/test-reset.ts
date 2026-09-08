/**
 * Deletes every row owned by the test user (id 999). Scoped to user_id = 999 and
 * nothing else — never run an unscoped DELETE against this database.
 */
import { config } from 'dotenv'
import { neon } from '@neondatabase/serverless'

config({ path: ['.env', '.env.local'], quiet: true })

const TEST_UID = 999

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL must be set (.env)')
  process.exit(1)
}

const sql = neon(url)

// child tables first
await sql`delete from events where user_id = ${TEST_UID}`
await sql`delete from applications where user_id = ${TEST_UID}`
await sql`delete from contacts where user_id = ${TEST_UID}`
await sql`delete from companies where user_id = ${TEST_UID}`

const counts = await sql`
  select
    (select count(*)::int from companies    where user_id = ${TEST_UID}) as companies,
    (select count(*)::int from contacts      where user_id = ${TEST_UID}) as contacts,
    (select count(*)::int from applications  where user_id = ${TEST_UID}) as applications,
    (select count(*)::int from events        where user_id = ${TEST_UID}) as events
`
console.log(`test data (user_id=${TEST_UID}) cleared:`, counts[0])
