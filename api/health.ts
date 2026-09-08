import type { VercelRequest, VercelResponse } from '@vercel/node'
import { sql } from './_db.js'

/** Liveness + DB connectivity check. No auth. */
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const rows = await sql`select now() as now`
    res.status(200).json({ ok: true, db: true, now: rows[0].now })
  } catch (err) {
    res.status(500).json({ ok: false, db: false, error: (err as Error).message })
  }
}
