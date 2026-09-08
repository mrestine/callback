import type { VercelRequest, VercelResponse } from '@vercel/node'
import { sql } from './_db.js'
import { requireAuth } from './_auth.js'
import { getId, methodNotAllowed, parseBody, qparam, withErrors } from './_http.js'
import { companyCreate, companyUpdate } from '../src/schemas/index.js'

export default withErrors(async (req: VercelRequest, res: VercelResponse) => {
  const auth = requireAuth(req, res)
  if (!auth) return
  const { uid } = auth
  const id = getId(req)

  switch (req.method) {
    case 'GET':
      return id ? getOne(res, uid, id) : list(req, res, uid)
    case 'POST':
      return create(req, res, uid)
    case 'PATCH':
      if (!id) return void res.status(400).json({ error: 'id required' })
      return update(req, res, uid, id)
    case 'DELETE':
      if (!id) return void res.status(400).json({ error: 'id required' })
      return remove(res, uid, id)
    default:
      return methodNotAllowed(res, ['GET', 'POST', 'PATCH', 'DELETE'])
  }
})

async function list(req: VercelRequest, res: VercelResponse, uid: number) {
  const q = qparam(req, 'q') ?? null
  const rows = await sql`
    select c.*,
      (select count(*)::int from contacts ct
        where ct.company_id = c.id and ct.user_id = ${uid}) as contact_count,
      (select count(*)::int from applications a
        where a.company_id = c.id and a.user_id = ${uid}) as application_count
    from companies c
    where c.user_id = ${uid}
      and (${q}::text is null or c.name ilike '%' || ${q} || '%')
    order by c.name asc
  `
  res.status(200).json(rows)
}

async function getOne(res: VercelResponse, uid: number, id: number) {
  const [company] = await sql`
    select * from companies where id = ${id} and user_id = ${uid}
  `
  if (!company) return void res.status(404).json({ error: 'not found' })

  const contacts = await sql`
    select * from contacts
    where company_id = ${id} and user_id = ${uid}
    order by name asc
  `
  const applications = await sql`
    select id, company_id, role_title, status, applied_at
    from applications
    where company_id = ${id} and user_id = ${uid}
    order by coalesce(applied_at, created_at::date) desc, id desc
  `
  res.status(200).json({ company, contacts, applications })
}

async function create(req: VercelRequest, res: VercelResponse, uid: number) {
  const data = parseBody(companyCreate, req, res)
  if (!data) return
  const [row] = await sql`
    insert into companies (user_id, name, careers_url, notes)
    values (${uid}, ${data.name}, ${data.careers_url ?? null}, ${data.notes ?? null})
    returning *
  `
  res.status(201).json(row)
}

async function update(req: VercelRequest, res: VercelResponse, uid: number, id: number) {
  const data = parseBody(companyUpdate, req, res)
  if (!data) return

  // Keys come from the Zod schema (unknown keys are stripped by .parse), so
  // interpolating them into the SET clause is safe. Values stay parameterised.
  const entries = Object.entries(data).filter(([, v]) => v !== undefined)
  if (entries.length === 0) return void res.status(400).json({ error: 'no fields to update' })

  const setSql = entries.map(([k], i) => `${k} = $${i + 1}`).join(', ')
  const params = entries.map(([, v]) => v ?? null)
  const rows = await sql(
    `update companies set ${setSql}, updated_at = now()
     where id = $${entries.length + 1} and user_id = $${entries.length + 2}
     returning *`,
    [...params, id, uid],
  )
  if (rows.length === 0) return void res.status(404).json({ error: 'not found' })
  res.status(200).json(rows[0])
}

async function remove(res: VercelResponse, uid: number, id: number) {
  // FK cascade: applications (and their events) go too; contacts are detached.
  const rows = await sql`
    delete from companies where id = ${id} and user_id = ${uid} returning id
  `
  if (rows.length === 0) return void res.status(404).json({ error: 'not found' })
  res.status(204).end()
}
