import type { VercelRequest, VercelResponse } from '@vercel/node'
import { sql } from './_db.js'
import { requireAuth } from './_auth.js'
import { methodNotAllowed, withErrors } from './_http.js'

const ACTIVE = ['lead', 'applied', 'screen', 'onsite', 'offer']
// "in process" for the dashboard summary sentence: past the initial application, still live
const IN_PROCESS = ['screen', 'onsite', 'offer']
const STALE_DAYS = 14

export default withErrors(async (req: VercelRequest, res: VercelResponse) => {
  const auth = requireAuth(req, res)
  if (!auth) return
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
  const { uid } = auth

  const [summaryRows, inProcessCompanyRows, stale, upcoming, recent] = await Promise.all([
    sql`
      select count(*)::int as active_applications,
             count(distinct company_id)::int as active_companies,
             count(*) filter (where status = any(${IN_PROCESS}))::int as in_process_count,
             count(*) filter (where status = 'applied')::int as applied_count,
             count(*) filter (where status = 'lead')::int as lead_count
      from applications
      where user_id = ${uid} and status = any(${ACTIVE})
    `,
    sql`
      select distinct co.name
      from applications a
      join companies co on co.id = a.company_id
      where a.user_id = ${uid} and a.status = any(${IN_PROCESS})
      order by co.name
    `,
    sql`
      with act as (
        select a.id, a.role_title, a.status, a.company_id, a.created_at,
          -- activity = when a row was recorded (scheduling a future round today
          -- counts as activity today), not the round's date
          (select max(created_at) from events e where e.application_id = a.id) as last_event_at
        from applications a
        where a.user_id = ${uid} and a.status = any(${ACTIVE})
      )
      select act.id, act.role_title, act.status, co.name as company_name,
             greatest(act.created_at, coalesce(act.last_event_at, act.created_at)) as last_activity_at
      from act
      join companies co on co.id = act.company_id
      where greatest(act.created_at, coalesce(act.last_event_at, act.created_at))
            < now() - make_interval(days => ${STALE_DAYS})
      order by last_activity_at asc
      limit 25
    `,
    sql`
      select e.id, e.type, e.subtype, e.body, e.occurred_at, e.application_id, e.contact_id,
             a.role_title, aco.name as company_name, ct.name as contact_name
      from events e
      left join applications a on a.id = e.application_id
      left join companies aco on aco.id = a.company_id
      left join contacts ct on ct.id = e.contact_id
      where e.user_id = ${uid} and e.status = 'scheduled' and e.occurred_at >= now()
      order by e.occurred_at asc
      limit 25
    `,
    sql`
      (select 'company' as kind, id, name as label, null::text as sub, null::text as subtype,
              created_at as at, null::bigint as application_id, null::bigint as contact_id
         from companies where user_id = ${uid})
      union all
      (select 'contact', id, name, null, null, created_at, null, null
         from contacts where user_id = ${uid})
      union all
      (select 'application', a.id, a.role_title, co.name, null, a.created_at, a.id, null
         from applications a join companies co on co.id = a.company_id
         where a.user_id = ${uid})
      union all
      (select 'event', e.id, e.type, coalesce(a.role_title, ct.name), e.subtype, e.created_at,
              e.application_id, e.contact_id
         from events e
         left join applications a on a.id = e.application_id
         left join contacts ct on ct.id = e.contact_id
         where e.user_id = ${uid} and e.status = 'logged')
      order by at desc
      limit 5
    `,
  ])

  res.status(200).json({
    activeApplications: summaryRows[0].active_applications,
    activeCompanies: summaryRows[0].active_companies,
    inProcessCount: summaryRows[0].in_process_count,
    inProcessCompanies: inProcessCompanyRows.map((r) => r.name as string),
    appliedCount: summaryRows[0].applied_count,
    leadCount: summaryRows[0].lead_count,
    staleThresholdDays: STALE_DAYS,
    stale,
    upcoming,
    recent,
  })
})
