/**
 * Applies schema.sql to the database in DATABASE_URL.
 * Usage: npm run db:apply
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { config } from 'dotenv'
import { neon } from '@neondatabase/serverless'

config({ path: '.env.local' })

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set (looked in .env.local)')
  process.exit(1)
}

const here = dirname(fileURLToPath(import.meta.url))
const schemaPath = resolve(here, '..', 'schema.sql')
const raw = readFileSync(schemaPath, 'utf8')

// Strip line comments, then split on statement terminators. The schema is plain
// DDL with no semicolons inside string literals, so a naive split is safe.
const statements = raw
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean)

const sql = neon(url)

console.log(`Applying ${statements.length} statements from schema.sql ...`)
for (const [i, stmt] of statements.entries()) {
  const label = stmt.split('\n')[0].slice(0, 70)
  try {
    await sql(stmt)
    console.log(`  [${i + 1}/${statements.length}] ok   ${label}`)
  } catch (err) {
    console.error(`  [${i + 1}/${statements.length}] FAIL ${label}`)
    console.error(`       ${(err as Error).message}`)
    process.exit(1)
  }
}
console.log('Done.')
