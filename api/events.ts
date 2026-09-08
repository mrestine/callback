import type { VercelRequest, VercelResponse } from '@vercel/node'
import { sql } from './_db.js'
import { requireAuth } from './_auth.js'
import { getId, methodNotAllowed, parseBody, qparam, withErrors } from './_http.js'
import { eventCreate } from '../src/schemas/index.js'

export default withErrors(async (req: VercelRequest, res: VercelResponse) => {
  const auth = requireAuth(req, res)
  if (!auth) return
  const { uid } = auth
  const id = getId(req)

  switch (req.method) {
    case 'GET':
      return list(req, res, uid)
    case 'POST':
      return create(req, res, uid)
    case 'DELETE':
      if (!id) return void res.status(400).json({ error: 'id required' })
      return remove(res, uid, id)
    default:
      return methodNotAllowed(res, ['GET', 'POST', 'DELETE'])
  }
})

async function refOwned(
  table: 'applications' | 'contacts',
  uid: number,
  refId: number | null | undefined,
): Promise<boolean> {
  if (refId == null) return true
  const rows = await sql(`select 1 from ${table} where id = $1 and user_id = $2`, [refId, uid])
  return rows.length > 0
}

async function list(req: VercelRequest, res: VercelResponse, uid: number) {
  const applicationId = qparam(req, 'application_id') ?? null
  const contactId = qparam(req, 'contact_id') ?? null
  const limit = Math.min(Number(qparam(req, 'limit')) || 100, 500)
  const rows = await sql`
    select * from events
    where user_id = ${uid}
      and (${applicationId}::int is null or application_id = ${applicationId}::int)
      and (${contactId}::int is null or contact_id = ${contactId}::int)
    order by occurred_at desc, id desc
    limit ${limit}
  `
  res.status(200).json(rows)
}

async function create(req: VercelRequest, res: VercelResponse, uid: number) {
  const data = parseBody(eventCreate, req, res)
  if (!data) return
  if (data.type === 'status_change') {
    return void res.status(400).json({ error: 'status_change events are written by the system' })
  }
  if (!(await refOwned('applications', uid, data.application_id))) {
    return void res.status(400).json({ error: 'application not found' })
  }
  if (!(await refOwned('contacts', uid, data.contact_id))) {
    return void res.status(400).json({ error: 'contact not found' })
  }
  const [row] = await sql`
    insert into events (user_id, application_id, contact_id, type, body, occurred_at, source)
    values (${uid}, ${data.application_id ?? null}, ${data.contact_id ?? null},
            ${data.type}, ${data.body ?? null}, ${data.occurred_at ?? new Date()}, 'manual')
    returning *
  `
  res.status(201).json(row)
}

async function remove(res: VercelResponse, uid: number, id: number) {
  // status_change events are a system audit trail — not user-deletable. Every
  // other type is (including AI-sourced ones the user wants to correct).
  const rows = await sql`
    delete from events
    where id = ${id} and user_id = ${uid} and type <> 'status_change'
    returning id
  `
  if (rows.length === 0) return void res.status(404).json({ error: 'not found' })
  res.status(204).end()
}
