import type { VercelRequest, VercelResponse } from '@vercel/node'
import { sql } from './_db.js'
import { requireAuth, requireToken } from './_auth.js'
import { getId, methodNotAllowed, parseBody, qparam, withErrors } from './_http.js'
import { inboundSubmit } from '../src/schemas/index.js'
import { matchEntities, needsDisambiguation, proposeOps } from './_inbound.js'

export function reviewUrl(id: number): string {
  const base = (process.env.APP_BASE_URL ?? '').replace(/\/$/, '')
  return `${base}/review/${id}`
}

export default withErrors(async (req: VercelRequest, res: VercelResponse) => {
  switch (req.method) {
    case 'POST':
      return submit(req, res)
    case 'GET':
      return read(req, res)
    default:
      return methodNotAllowed(res, ['GET', 'POST'])
  }
})

// --- POST /api/inbound  (worker, bearer token) --------------------------
async function submit(req: VercelRequest, res: VercelResponse) {
  const auth = await requireToken(req, res)
  if (!auth) return
  const { uid } = auth

  const body = parseBody(inboundSubmit, req, res)
  if (!body) return

  // idempotent receiver: a retry returns the existing row, no new work
  const [existing] = await sql`
    select id, status, proposal from inbound_actions
    where user_id = ${uid} and source = ${body.source} and external_ref = ${body.external_ref}
  `
  if (existing) {
    return void res.status(200).json({
      status: responseStatus(existing.status, existing.proposal),
      proposal: existing.proposal,
      review_url: reviewUrl(Number(existing.id)),
      deduped: true,
    })
  }

  const match = await matchEntities(uid, body.extracted, body.thread_key)
  const proposal = proposeOps(body.extracted, match)
  const storedStatus = proposal.status // 'needs_review' | 'dismissed'

  const payload = {
    external_ref: body.external_ref,
    source: body.source,
    thread_key: body.thread_key,
    summary: body.summary,
    occurred_at: body.occurred_at ? body.occurred_at.toISOString() : null,
    extracted: body.extracted,
  }

  const [row] = await sql`
    insert into inbound_actions
      (user_id, source, external_ref, occurred_at, summary, payload, match, proposal, status)
    values
      (${uid}, ${body.source}, ${body.external_ref}, ${body.occurred_at},
       ${body.summary}, ${JSON.stringify(payload)}::jsonb, ${JSON.stringify(match)}::jsonb,
       ${JSON.stringify(proposal.ops)}::jsonb, ${storedStatus})
    returning id
  `
  const id = Number(row.id)
  res.status(201).json({
    status: storedStatus === 'dismissed' ? 'dismissed' : responseStatus('needs_review', proposal.ops),
    proposal: proposal.ops,
    review_url: reviewUrl(id),
  })
}

/** stored status -> the richer status the worker's digest reply wants */
function responseStatus(stored: string, ops: unknown): string {
  if (stored === 'needs_review' && Array.isArray(ops) && needsDisambiguation(ops as never)) {
    return 'needs_disambiguation'
  }
  return stored
}

// --- GET /api/inbound  (browser session) -------------------------------
async function read(req: VercelRequest, res: VercelResponse) {
  const auth = requireAuth(req, res)
  if (!auth) return
  const { uid } = auth
  const id = getId(req)

  if (id) {
    const [row] = await sql`
      select * from inbound_actions where id = ${id} and user_id = ${uid}
    `
    if (!row) return void res.status(404).json({ error: 'not found' })
    return void res.status(200).json(row)
  }

  const status = qparam(req, 'status') ?? null
  const limit = Math.min(Number(qparam(req, 'limit')) || 100, 500)
  const rows = await sql`
    select id, source, external_ref, occurred_at, summary, status, match, proposal,
           applied, error, created_at, resolved_at,
           payload -> 'extracted' ->> 'email_kind' as email_kind
    from inbound_actions
    where user_id = ${uid}
      and (${status}::text is null or status = ${status})
    order by
      case when status in ('needs_review', 'pending') then 0 else 1 end,
      created_at desc
    limit ${limit}
  `
  res.status(200).json(rows)
}
