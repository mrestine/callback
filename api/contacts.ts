import type { VercelRequest, VercelResponse } from '@vercel/node'
import { sql } from './_db.js'
import { requireAuth } from './_auth.js'
import { getId, methodNotAllowed, parseBody, qparam, withErrors } from './_http.js'
import { contactCreate, contactUpdate } from '../src/schemas/index.js'

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

/** True unless `companyId` is set and not owned by `uid`. */
async function companyOk(uid: number, companyId: number | null | undefined): Promise<boolean> {
  if (companyId == null) return true
  const rows = await sql`select 1 from companies where id = ${companyId} and user_id = ${uid}`
  return rows.length > 0
}

async function list(req: VercelRequest, res: VercelResponse, uid: number) {
  const q = qparam(req, 'q') ?? null
  const kind = qparam(req, 'kind') ?? null
  const companyId = qparam(req, 'company_id') ?? null
  const rows = await sql`
    select ct.*, co.name as company_name
    from contacts ct
    left join companies co on co.id = ct.company_id
    where ct.user_id = ${uid}
      and (${q}::text is null or ct.name ilike '%' || ${q} || '%')
      and (${kind}::text is null or ct.kind = ${kind})
      and (${companyId}::int is null or ct.company_id = ${companyId}::int)
    order by ct.name asc
  `
  res.status(200).json(rows)
}

async function getOne(res: VercelResponse, uid: number, id: number) {
  const [contact] = await sql`
    select * from contacts where id = ${id} and user_id = ${uid}
  `
  if (!contact) return void res.status(404).json({ error: 'not found' })

  const [company] = contact.company_id
    ? await sql`select * from companies where id = ${contact.company_id} and user_id = ${uid}`
    : [null]
  const applications = await sql`
    select a.id, a.company_id, a.role_title, co.name as company_name, a.status,
      a.applied_at::text as applied_at
    from applications a
    join companies co on co.id = a.company_id
    where a.contact_id = ${id} and a.user_id = ${uid}
    order by coalesce(a.applied_at, a.created_at::date) desc, a.id desc
  `
  const events = await sql`
    select * from events
    where contact_id = ${id} and user_id = ${uid}
    order by occurred_at desc, id desc
    limit 100
  `
  res.status(200).json({ contact, company: company ?? null, applications, events })
}

async function create(req: VercelRequest, res: VercelResponse, uid: number) {
  const data = parseBody(contactCreate, req, res)
  if (!data) return
  if (!(await companyOk(uid, data.company_id))) {
    return void res.status(400).json({ error: 'company not found' })
  }
  const [row] = await sql`
    insert into contacts
      (user_id, company_id, name, role, kind, email, linkedin_url, warmth, notes, last_contact_at)
    values
      (${uid}, ${data.company_id ?? null}, ${data.name}, ${data.role ?? null}, ${data.kind},
       ${data.email ?? null}, ${data.linkedin_url ?? null}, ${data.warmth}, ${data.notes ?? null},
       ${data.last_contact_at ?? null})
    returning *
  `
  res.status(201).json(row)
}

async function update(req: VercelRequest, res: VercelResponse, uid: number, id: number) {
  const data = parseBody(contactUpdate, req, res)
  if (!data) return
  if ('company_id' in data && !(await companyOk(uid, data.company_id))) {
    return void res.status(400).json({ error: 'company not found' })
  }

  const entries = Object.entries(data).filter(([, v]) => v !== undefined)
  if (entries.length === 0) return void res.status(400).json({ error: 'no fields to update' })

  const setSql = entries.map(([k], i) => `${k} = $${i + 1}`).join(', ')
  const params = entries.map(([, v]) => v ?? null)
  const rows = await sql(
    `update contacts set ${setSql}, updated_at = now()
     where id = $${entries.length + 1} and user_id = $${entries.length + 2}
     returning *`,
    [...params, id, uid],
  )
  if (rows.length === 0) return void res.status(404).json({ error: 'not found' })
  res.status(200).json(rows[0])
}

async function remove(res: VercelResponse, uid: number, id: number) {
  const rows = await sql`
    delete from contacts where id = ${id} and user_id = ${uid} returning id
  `
  if (rows.length === 0) return void res.status(404).json({ error: 'not found' })
  res.status(204).end()
}
