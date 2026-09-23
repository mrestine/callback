import type { VercelRequest, VercelResponse } from '@vercel/node'
import { sql } from './_db.js'
import { requireAuth } from './_auth.js'
import { getId, methodNotAllowed, parseBody, qparam, withErrors } from './_http.js'
import { applicationCreate, applicationUpdate } from '../src/schemas/index.js'

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

/** True unless `refId` is set and not owned by `uid`. Table name is a literal. */
async function refOwned(
  table: 'companies' | 'contacts',
  uid: number,
  refId: number | null | undefined,
): Promise<boolean> {
  if (refId == null) return true
  const rows = await sql(`select 1 from ${table} where id = $1 and user_id = $2`, [refId, uid])
  return rows.length > 0
}

async function list(req: VercelRequest, res: VercelResponse, uid: number) {
  const q = qparam(req, 'q') ?? null
  // comma-separated: ?status=lead,applied,screen — multi-select on the client
  const statusParam = qparam(req, 'status') ?? null
  const statuses = statusParam ? statusParam.split(',').filter(Boolean) : null
  const companyId = qparam(req, 'company_id') ?? null
  const rows = await sql`
    select a.*,
      -- applied_at is a plain date column (no timezone); overriding the a.*
      -- copy with an explicit ::text cast avoids the driver deserializing it
      -- back into a JS Date at some ambiguous midnight and shifting the day
      a.applied_at::text as applied_at,
      co.name as company_name,
      ct.name as contact_name,
      -- "last activity" = when something was last recorded, not when a future
      -- scheduled round is dated
      (select max(created_at) from events e where e.application_id = a.id) as last_event_at
    from applications a
    join companies co on co.id = a.company_id
    left join contacts ct on ct.id = a.contact_id
    where a.user_id = ${uid}
      and (${q}::text is null
           or a.role_title ilike '%' || ${q} || '%'
           or co.name ilike '%' || ${q} || '%'
           or ct.name ilike '%' || ${q} || '%')
      and (${statuses}::text[] is null or a.status = any(${statuses}))
      and (${companyId}::int is null or a.company_id = ${companyId}::int)
    order by
      greatest(a.created_at,
        coalesce((select max(created_at) from events e where e.application_id = a.id), a.created_at)
      ) desc,
      a.id desc
  `
  res.status(200).json(rows)
}

async function getOne(res: VercelResponse, uid: number, id: number) {
  const [application] = await sql`
    select *, applied_at::text as applied_at from applications where id = ${id} and user_id = ${uid}
  `
  if (!application) return void res.status(404).json({ error: 'not found' })

  const [company] = await sql`
    select * from companies where id = ${application.company_id} and user_id = ${uid}
  `
  const [contact] = application.contact_id
    ? await sql`select * from contacts where id = ${application.contact_id} and user_id = ${uid}`
    : [null]
  const events = await sql`
    select * from events
    where application_id = ${id} and user_id = ${uid}
    order by occurred_at desc, id desc
    limit 200
  `
  res.status(200).json({ application, company: company ?? null, contact: contact ?? null, events })
}

async function create(req: VercelRequest, res: VercelResponse, uid: number) {
  const data = parseBody(applicationCreate, req, res)
  if (!data) return
  if (!(await refOwned('companies', uid, data.company_id))) {
    return void res.status(400).json({ error: 'company not found' })
  }
  if (!(await refOwned('contacts', uid, data.contact_id))) {
    return void res.status(400).json({ error: 'contact not found' })
  }
  const [row] = await sql`
    insert into applications
      (user_id, company_id, contact_id, role_title, jd_url, source, status,
       location, remote, salary_range, applied_at, notes)
    values
      (${uid}, ${data.company_id}, ${data.contact_id ?? null}, ${data.role_title},
       ${data.jd_url ?? null}, ${data.source ?? null}, ${data.status},
       ${data.location ?? null}, ${data.remote ?? null}, ${data.salary_range ?? null},
       ${data.applied_at ?? null}, ${data.notes ?? null})
    returning *, applied_at::text as applied_at
  `
  res.status(201).json(row)
}

async function update(req: VercelRequest, res: VercelResponse, uid: number, id: number) {
  const data = parseBody(applicationUpdate, req, res)
  if (!data) return
  if ('company_id' in data && !(await refOwned('companies', uid, data.company_id))) {
    return void res.status(400).json({ error: 'company not found' })
  }
  if ('contact_id' in data && !(await refOwned('contacts', uid, data.contact_id))) {
    return void res.status(400).json({ error: 'contact not found' })
  }

  const entries = Object.entries(data).filter(([, v]) => v !== undefined)
  if (entries.length === 0) return void res.status(400).json({ error: 'no fields to update' })

  const [current] = await sql`
    select status from applications where id = ${id} and user_id = ${uid}
  `
  if (!current) return void res.status(404).json({ error: 'not found' })

  const setSql = entries.map(([k], i) => `${k} = $${i + 1}`).join(', ')
  const params = entries.map(([, v]) => v ?? null)
  const mkUpdate = () =>
    sql(
      `update applications set ${setSql}, updated_at = now()
       where id = $${entries.length + 1} and user_id = $${entries.length + 2}
       returning *, applied_at::text as applied_at`,
      [...params, id, uid],
    )

  const statusChanged = data.status !== undefined && data.status !== current.status
  if (statusChanged) {
    // Update + timeline event as one transaction.
    const [updatedRows] = (await sql.transaction([
      mkUpdate(),
      sql`
        insert into events (user_id, application_id, type, old_status, new_status, source)
        values (${uid}, ${id}, 'status_change', ${current.status}, ${data.status}, 'manual')
      `,
    ])) as Record<string, unknown>[][]
    return void res.status(200).json(updatedRows[0])
  }

  const rows = await mkUpdate()
  res.status(200).json(rows[0])
}

async function remove(res: VercelResponse, uid: number, id: number) {
  // FK cascade removes this application's events.
  const rows = await sql`
    delete from applications where id = ${id} and user_id = ${uid} returning id
  `
  if (rows.length === 0) return void res.status(404).json({ error: 'not found' })
  res.status(204).end()
}
