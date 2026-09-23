/**
 * One-time backfill: events.occurred_at and contacts.last_contact_at picked
 * via the old date-only UI (before the timezone fix) were stored as UTC
 * midnight of the intended date instead of local midnight. Displayed with
 * toLocaleDateString() (timezone-aware), UTC midnight renders as the
 * PREVIOUS calendar day for any US timezone.
 *
 * Corrects affected rows by reinterpreting their (correct) calendar date as
 * America/New_York local midnight instead of UTC midnight, via Intl's
 * per-date DST-aware offset. Covers both source='manual' events (the
 * date-only UI bug) and source='ai' events (the extraction pipeline hit the
 * same bug when the model gave a bare date with no time — now fixed in
 * api/_inbound.ts's add_event, see dateOnlyToInstant in src/schemas/index.ts),
 * plus all affected contacts.last_contact_at (always manual).
 *
 * Naturally idempotent: once corrected, occurred_at's time-of-day is no
 * longer exactly 00:00:00, so the WHERE clause won't match it again.
 *
 * Usage:
 *   npx tsx scripts/backfill-utc-midnight-dates.mjs           # dry run (default)
 *   npx tsx scripts/backfill-utc-midnight-dates.mjs --apply   # actually write
 */
import 'dotenv/config'
import { neon } from '@neondatabase/serverless'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set (.env)')
  process.exit(1)
}
const sql = neon(url)
const TZ = 'America/New_York'
const apply = process.argv.includes('--apply')

function tzOffsetHours(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
  const part = fmt.formatToParts(date).find((p) => p.type === 'timeZoneName').value
  const m = part.match(/GMT([+-]\d+(?:\.\d+)?)/)
  return m ? Number(m[1]) : 0
}

function correctedInstant(utcMidnightDate) {
  const y = utcMidnightDate.getUTCFullYear()
  const m = utcMidnightDate.getUTCMonth()
  const d = utcMidnightDate.getUTCDate()
  const offset = tzOffsetHours(utcMidnightDate, TZ) // e.g. -4 for EDT
  return new Date(Date.UTC(y, m, d) - offset * 3600000)
}

console.log(apply ? 'APPLYING changes...' : 'DRY RUN (pass --apply to write)')

const events = await sql`
  select id, occurred_at from events where occurred_at::time = '00:00:00' and source in ('manual', 'ai')
`
console.log(`\n--- events (${events.length}) ---`)
for (const e of events) {
  const corrected = correctedInstant(e.occurred_at)
  console.log(e.id, e.occurred_at.toISOString(), '->', corrected.toISOString())
  if (apply) await sql`update events set occurred_at = ${corrected} where id = ${e.id}`
}

const contacts = await sql`
  select id, last_contact_at from contacts where last_contact_at::time = '00:00:00'
`
console.log(`\n--- contacts (${contacts.length}) ---`)
for (const c of contacts) {
  const corrected = correctedInstant(c.last_contact_at)
  console.log(c.id, c.last_contact_at.toISOString(), '->', corrected.toISOString())
  if (apply) await sql`update contacts set last_contact_at = ${corrected} where id = ${c.id}`
}

console.log(apply ? '\nDone.' : '\nDry run only — re-run with --apply to write these changes.')
