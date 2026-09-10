import type { VercelRequest, VercelResponse } from '@vercel/node'
import { sql } from './_db.js'
import { hashToken, newRawToken, requireAuth } from './_auth.js'
import { getId, methodNotAllowed, parseBody, withErrors } from './_http.js'
import { tokenCreate } from '../src/schemas/index.js'

/**
 * Worker bearer tokens. Session-auth only — the operator manages these in the
 * webapp. The raw token is shown exactly once, on create.
 */
export default withErrors(async (req: VercelRequest, res: VercelResponse) => {
  const auth = requireAuth(req, res)
  if (!auth) return
  const { uid } = auth

  switch (req.method) {
    case 'GET':
      return void res.status(200).json(
        await sql`
          select id, name, scopes, created_at, last_used_at
          from api_tokens where user_id = ${uid}
          order by created_at desc
        `,
      )
    case 'POST': {
      const data = parseBody(tokenCreate, req, res)
      if (!data) return
      const raw = newRawToken()
      const [row] = await sql`
        insert into api_tokens (user_id, name, token_hash)
        values (${uid}, ${data.name}, ${hashToken(raw)})
        returning id, name, scopes, created_at, last_used_at
      `
      return void res.status(201).json({ ...row, token: raw })
    }
    case 'DELETE': {
      const id = getId(req)
      if (!id) return void res.status(400).json({ error: 'id required' })
      const rows = await sql`
        delete from api_tokens where id = ${id} and user_id = ${uid} returning id
      `
      if (rows.length === 0) return void res.status(404).json({ error: 'not found' })
      return void res.status(204).end()
    }
    default:
      return methodNotAllowed(res, ['GET', 'POST', 'DELETE'])
  }
})
