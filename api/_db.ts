import { neon } from '@neondatabase/serverless'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL is not set')
}

/**
 * HTTP-based Neon client. `sql` is a tagged-template function for parameterised
 * queries (`sql\`select * from users where id = ${id}\``) and also exposes
 * `sql.query(text, params)` for dynamic statements. One round-trip per call,
 * no connection pool to manage — ideal for serverless.
 */
export const sql = neon(connectionString)
