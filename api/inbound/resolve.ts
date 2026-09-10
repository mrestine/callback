import type { VercelRequest, VercelResponse } from '@vercel/node'
import { sql } from '../_db.js'
import { requireTokenOrAuth } from '../_auth.js'
import { getId, methodNotAllowed, parseBody, withErrors } from '../_http.js'
import { inboundResolve } from '../../src/schemas/index.js'
import type { ProposalOp } from '../../src/schemas/index.js'
import { buildApplyPlan, needsDisambiguation } from '../_inbound.js'

export default withErrors(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])

  const auth = await requireTokenOrAuth(req, res)
  if (!auth) return
  const { uid } = auth

  const id = getId(req)
  if (!id) return void res.status(400).json({ error: 'id required' })

  const body = parseBody(inboundResolve, req, res)
  if (!body) return

  const [row] = await sql`
    select id, status, proposal, occurred_at from inbound_actions
    where id = ${id} and user_id = ${uid}
  `
  if (!row) return void res.status(404).json({ error: 'not found' })
  const ops = (row.proposal as ProposalOp[] | null) ?? []

  // --- worker disambiguation: fill chosen ids, stay in the queue ------
  if (body.action === 'choose') {
    const next = ops.map((op) => {
      const pick = body.choice[op.id]
      if (pick == null || !op.match) return op
      if (!op.match.candidates.some((c) => c.id === pick)) return op
      return { ...op, match: { ...op.match, chosen: pick } }
    })
    await sql`
      update inbound_actions set proposal = ${JSON.stringify(next)}::jsonb where id = ${id}
    `
    return void res.status(200).json({
      status: needsDisambiguation(next) ? 'needs_disambiguation' : 'needs_review',
      proposal: next,
    })
  }

  // --- human reject --------------------------------------------------
  if (body.action === 'dismiss') {
    if (!['needs_review', 'pending'].includes(row.status)) {
      return void res.status(409).json({ error: `cannot dismiss a ${row.status} row` })
    }
    await sql`
      update inbound_actions set status = 'dismissed', resolved_at = now() where id = ${id}
    `
    return void res.status(200).json({ status: 'dismissed' })
  }

  // --- human approve: walk the ops in one atomic statement ----------
  if (row.status !== 'needs_review') {
    return void res.status(409).json({ error: `cannot apply a ${row.status} row` })
  }

  const merged = mergeOverrides(ops, body.ops)
  if (needsDisambiguation(merged)) {
    return void res.status(400).json({ error: 'some ops still need a match chosen', proposal: merged })
  }

  const fallback = row.occurred_at ? new Date(row.occurred_at as string) : null
  const plan = buildApplyPlan(merged, { uid, inboundActionId: id, fallbackOccurredAt: fallback })
  if ('error' in plan) return void res.status(400).json({ error: plan.error })

  const [result] = (await sql(plan.text, plan.params)) as Record<string, unknown>[]
  if (!result || result.ia_id == null) {
    return void res.status(409).json({ error: 'row was already resolved' })
  }

  const applied = merged
    .filter((o) => o.decision !== 'skip' && plan.resultAliases[o.id])
    .map((o) => ({
      id: o.id,
      op: o.op,
      result_id: Number(result[plan.resultAliases[o.id]]) || null,
      created: o.op.startsWith('create_') || o.op === 'add_event' || o.op === 'set_status',
    }))

  // status is already 'applied' (atomic above); this is the audit detail
  await sql`
    update inbound_actions set applied = ${JSON.stringify(applied)}::jsonb where id = ${id}
  `
  res.status(200).json({ status: 'applied', applied })
})

/** apply per-op overrides from the review UI onto the stored proposal */
function mergeOverrides(
  ops: ProposalOp[],
  overrides: Record<string, { decision?: 'accept' | 'skip'; chosen?: number | null; args?: Record<string, unknown>; op?: ProposalOp['op'] }>,
): ProposalOp[] {
  return ops.map((op) => {
    const ov = overrides[op.id]
    if (!ov) return op
    const next: ProposalOp = { ...op }
    if (ov.decision) next.decision = ov.decision
    if (ov.op) next.op = ov.op
    if (ov.args) next.args = { ...op.args, ...ov.args }
    if (ov.chosen !== undefined) {
      next.match = { candidates: op.match?.candidates ?? [], chosen: ov.chosen ?? null }
    }
    return next
  })
}
