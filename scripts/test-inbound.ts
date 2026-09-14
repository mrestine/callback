/**
 * End-to-end exercise of the Phase 2 /api/inbound pipeline (match -> propose ->
 * apply) against the real DB, scoped entirely to test user 999.
 *
 *   npm run test:inbound
 *
 * Teardown is built in (deletes only WHERE user_id = 999). Safe to re-run.
 */
import 'dotenv/config'
import { neon } from '@neondatabase/serverless'
import { matchEntities, proposeOps, buildApplyPlan } from '../api/_inbound.ts'
import type { Extracted } from '../src/schemas/index.ts'

const TEST_UID = 999
const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL not set (.env)')
  process.exit(1)
}
const sql = neon(url)

let failures = 0
function check(label: string, cond: boolean, detail?: unknown) {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}`)
  if (!cond) {
    failures++
    if (detail !== undefined) console.log('       ', JSON.stringify(detail))
  }
}

async function reset() {
  await sql`
    insert into users (id, github_id, github_login, name) overriding system value
    values (${TEST_UID}, 0, 'test-bot', 'Test Bot') on conflict (id) do nothing
  `
  // children first (FKs)
  await sql`delete from events where user_id = ${TEST_UID}`
  await sql`delete from applications where user_id = ${TEST_UID}`
  await sql`delete from contacts where user_id = ${TEST_UID}`
  await sql`delete from companies where user_id = ${TEST_UID}`
  await sql`delete from inbound_actions where user_id = ${TEST_UID}`
}

async function seedInbound(ex: Extracted, threadKey: string | null, occurredAt: string | null) {
  const [row] = await sql`
    insert into inbound_actions (user_id, source, external_ref, occurred_at, payload, status)
    values (${TEST_UID}, 'test', ${'ext-' + Math.random().toString(36).slice(2)},
            ${occurredAt}, ${JSON.stringify({ thread_key: threadKey, extracted: ex })}::jsonb,
            'needs_review')
    returning id
  `
  return Number(row.id)
}

async function runApply(iaId: number, ops: ReturnType<typeof proposeOps>['ops'], fallback: string | null) {
  const plan = buildApplyPlan(ops, {
    uid: TEST_UID,
    inboundActionId: iaId,
    fallbackOccurredAt: fallback ? new Date(fallback) : null,
  })
  if ('error' in plan) throw new Error(`buildApplyPlan: ${plan.error}`)
  const [result] = (await sql(plan.text, plan.params)) as Record<string, unknown>[]
  // mirror what api/inbound/resolve.ts does after the atomic apply
  const applied = ops
    .filter((o) => o.decision !== 'skip' && plan.resultAliases[o.id])
    .map((o) => ({
      id: o.id,
      op: o.op,
      result_id: Number(result[plan.resultAliases[o.id]]) || null,
      created: o.op.startsWith('create_') || o.op === 'add_event' || o.op === 'set_status',
    }))
  await sql`update inbound_actions set applied = ${JSON.stringify(applied)}::jsonb where id = ${iaId}`
  return { plan, result }
}

// --------------------------------------------------------------------------
async function scenarioNewCompanyConfirmation() {
  console.log('\n# application_confirmation, company not on file -> 4-op create chain')
  const ex: Extracted = {
    job_related: true,
    email_kind: 'application_confirmation',
    sender: { name: 'The Encamp Team', email: 'no-reply@us.greenhouse-mail.io', org: 'Encamp', is_agency_recruiter: false, kind: 'other', confidence: 0.9 },
    hiring_company: { name: 'Encamp', withheld: false, confidence: 0.9 },
    role: { title: 'Senior Software Engineer', confidence: 0.85 },
    event: { type: 'email', subtype: null, occurred_at: null, summary: 'Encamp confirmed receipt of the application.' },
    status_signal: null,
    notes: 'Application received.',
  } as Extracted

  const match = await matchEntities(TEST_UID, ex, null)
  const { ops, status } = proposeOps(ex, match)
  check('status is needs_review', status === 'needs_review')
  check('has create_company', ops.some((o) => o.op === 'create_company'))
  check('has create_application', ops.some((o) => o.op === 'create_application'))
  check('has create_contact (default skip: no-reply)', ops.some((o) => o.op === 'create_contact' && o.decision === 'skip'))
  check('has add_event', ops.some((o) => o.op === 'add_event'))

  const iaId = await seedInbound(ex, null, '2026-09-08T14:02:00Z')
  const { result } = await runApply(iaId, ops, '2026-09-08T14:02:00Z')
  check('inbound_actions row marked applied (ia_id returned)', result.ia_id != null, result)

  const [co] = await sql`select * from companies where user_id = ${TEST_UID} and name = 'Encamp'`
  check('company Encamp created', !!co)
  const [app] = await sql`select * from applications where user_id = ${TEST_UID} and company_id = ${co?.id}`
  check('application created, linked to company', !!app && app.role_title === 'Senior Software Engineer', app)
  check('application.status = applied', app?.status === 'applied', app)
  check(
    'application.applied_at backfilled from the submission date (status != lead, none given)',
    app?.applied_at && new Date(app.applied_at).toISOString().slice(0, 10) === '2026-09-08',
    app?.applied_at,
  )
  // provenance is inbound_action_id, not the free-text source column — that's
  // user-fillable ("referral", "LinkedIn"...) same as a manually-created app,
  // and stays null unless the reviewer fills it in before approving
  check('application.source is null (not hardcoded, nothing was filled in)', app?.source === null, app?.source)
  check('application.inbound_action_id set', Number(app?.inbound_action_id) === iaId)
  const evs = await sql`select * from events where user_id = ${TEST_UID} and application_id = ${app?.id}`
  check('one applied/email event on the application', evs.length === 1, evs)
  check('event.source = ai, inbound_action_id set', evs[0]?.source === 'ai' && Number(evs[0]?.inbound_action_id) === iaId)
  const cts = await sql`select * from contacts where user_id = ${TEST_UID}`
  check('contact was NOT created (op skipped)', cts.length === 0, cts)
  const [ia] = await sql`select status, applied from inbound_actions where id = ${iaId}`
  check('inbound_actions.status = applied', ia?.status === 'applied')
  check('inbound_actions.applied has op rows', Array.isArray(ia?.applied) && (ia.applied as unknown[]).length >= 3, ia?.applied)
}

async function scenarioKnownCompanyRejection() {
  console.log('\n# rejection, known company + matched application -> link + set_status')
  const [co] = await sql`insert into companies (user_id, name) values (${TEST_UID}, 'Flex') returning *`
  const [app] = await sql`
    insert into applications (user_id, company_id, role_title, status)
    values (${TEST_UID}, ${co.id}, 'Senior Software Engineer, Fullstack', 'screen') returning *
  `
  const ex: Extracted = {
    job_related: true,
    email_kind: 'rejection',
    sender: { name: 'Alexandra Weber', email: 'alexandra.weber@getflex.com', org: 'Flex', is_agency_recruiter: false, kind: 'recruiter', confidence: 0.9 },
    hiring_company: { name: 'Flex', withheld: false, confidence: 0.9 },
    role: { title: 'Senior Software Engineer, Fullstack', confidence: 0.9 },
    event: { type: 'email', subtype: null, occurred_at: null, summary: 'Flex passed on the application.' },
    status_signal: 'rejected',
    notes: 'Rejected.',
  } as Extracted

  const match = await matchEntities(TEST_UID, ex, null)
  check('company matched (chosen)', match.companies[0].chosen === Number(co.id), match.companies[0])
  check('application matched (chosen)', match.applications[0].chosen === Number(app.id), match.applications[0])

  const { ops } = proposeOps(ex, match)
  check('has link_application', ops.some((o) => o.op === 'link_application' && o.match?.chosen === Number(app.id)))
  check('has set_status -> rejected', ops.some((o) => o.op === 'set_status' && o.args?.status === 'rejected'))
  check('has create_contact for the recruiter', ops.some((o) => o.op === 'create_contact'))

  const iaId = await seedInbound(ex, null, '2026-09-09T10:00:00Z')
  const { result } = await runApply(iaId, ops, '2026-09-09T10:00:00Z')
  check('applied (ia_id returned)', result.ia_id != null, result)

  const [after] = await sql`select status from applications where id = ${app.id}`
  check('application.status flipped to rejected', after?.status === 'rejected', after)
  const scEvents = await sql`select * from events where application_id = ${app.id} and type = 'status_change'`
  check('status_change event written', scEvents.length === 1 && scEvents[0].new_status === 'rejected', scEvents)
  const emailEvents = await sql`select * from events where application_id = ${app.id} and type = 'email'`
  check('email event written', emailEvents.length === 1, emailEvents)
  const [ct] = await sql`select * from contacts where user_id = ${TEST_UID} and email = 'alexandra.weber@getflex.com'`
  check('recruiter contact created + linked to company', !!ct && Number(ct.company_id) === Number(co.id), ct)
}

async function scenarioThreadContinuity() {
  console.log('\n# 2nd email in a thread reuses the application from the 1st')
  const tk = 'alexandra.weber@getflex.com|senior software engineer, fullstack'
  const [app] = await sql`select id from applications where user_id = ${TEST_UID} and role_title ilike 'Senior Software%' limit 1`
  // fake a prior applied inbound_actions row on this thread_key
  await sql`
    insert into inbound_actions (user_id, source, external_ref, payload, status, applied, resolved_at)
    values (${TEST_UID}, 'test', ${'prior-' + Math.random().toString(36).slice(2)},
            ${JSON.stringify({ thread_key: tk })}::jsonb, 'applied',
            ${JSON.stringify([{ id: 'a1', op: 'link_application', result_id: Number(app.id), created: false }])}::jsonb,
            now())
  `
  const ex: Extracted = {
    job_related: true,
    email_kind: 'status_update',
    sender: { name: 'Alexandra Weber', email: 'alexandra.weber@getflex.com', org: 'Flex', is_agency_recruiter: false, kind: 'recruiter', confidence: 0.9 },
    hiring_company: { name: 'Flex', withheld: false, confidence: 0.9 },
    role: { title: null, confidence: 0.2 },
    event: { type: 'email', subtype: null, occurred_at: null, summary: 'Still reviewing.' },
    status_signal: null,
    notes: 'Waiting.',
  } as Extracted
  const match = await matchEntities(TEST_UID, ex, tk)
  check('thread continuity picked the prior application', match.applications[0].chosen === Number(app.id), match.applications[0])
}

async function scenarioMultiOpportunity() {
  console.log('\n# agency recruiter, 3 distinct opportunities named -> 3x create_company + create_application')
  const ex: Extracted = {
    job_related: true,
    email_kind: 'recruiter_outreach',
    sender: { name: 'Scott Bennett', email: 'scott.bennett@motionrecruitment.com', org: 'Motion Recruitment', is_agency_recruiter: true, kind: 'recruiter', confidence: 0.85 },
    hiring_company: { name: 'Encamp', withheld: false, confidence: 0.8 },
    role: { title: 'Senior Platform Engineer', confidence: 0.8 },
    additional_opportunities: [
      { hiring_company: { name: 'Northstar', withheld: false, confidence: 0.8 }, role: { title: 'Staff Backend Engineer', confidence: 0.8 } },
      { hiring_company: { name: 'Flex', withheld: false, confidence: 0.8 }, role: { title: 'Platform Engineer', confidence: 0.8 } },
    ],
    event: { type: 'email', subtype: null, occurred_at: null, summary: 'Matt decided to move forward on 3 of the 4 roles sent over.' },
    status_signal: null,
    notes: 'Pursuing 3 of the 4 roles.',
  } as Extracted

  const match = await matchEntities(TEST_UID, ex, null)
  check('3 company matches computed', match.companies.length === 3, match.companies)
  check('3 application matches computed', match.applications.length === 3, match.applications)

  const { ops, status } = proposeOps(ex, match)
  check('status is needs_review', status === 'needs_review')
  const companyNames = ['Encamp', 'Northstar', 'Flex']
  for (const name of companyNames) {
    check(`has create_company "${name}"`, ops.some((o) => o.op === 'create_company' && o.args?.name === name))
  }
  const createApps = ops.filter((o) => o.op === 'create_application')
  check('3 create_application ops, all accepted, all lead', createApps.length === 3 && createApps.every((o) => o.decision === 'accept' && o.args?.status === 'lead'), createApps)
  check('has create_contact for Scott (accepted, no company link — agency)', ops.some((o) => o.op === 'create_contact' && o.decision === 'accept' && o.refs?.company_id === undefined))
  const events = ops.filter((o) => o.op === 'add_event')
  check('exactly ONE event for the whole email, on the contact (not any one application)', events.length === 1 && events[0].refs?.contact_id === '$ct1' && events[0].refs?.application_id === undefined, events)

  const iaId = await seedInbound(ex, null, '2026-09-14T09:10:00Z')
  const { result } = await runApply(iaId, ops, '2026-09-14T09:10:00Z')
  check('applied (ia_id returned)', result.ia_id != null, result)

  const apps = await sql`select * from applications where user_id = ${TEST_UID} and inbound_action_id = ${iaId}`
  check('all 3 applications created, status lead', apps.length === 3 && apps.every((a) => a.status === 'lead'), apps)
  const cos = await sql`select * from companies where user_id = ${TEST_UID} and id = any(${apps.map((a) => a.company_id)})`
  check('all 3 companies created, right names', cos.length === 3 && companyNames.every((n) => cos.some((c) => c.name === n)), cos)
  const cts = await sql`select * from contacts where user_id = ${TEST_UID} and email = 'scott.bennett@motionrecruitment.com'`
  check('recruiter contact created with company_id NULL (agency convention)', cts.length === 1 && cts[0].company_id === null, cts)
  const evs = await sql`select * from events where user_id = ${TEST_UID} and inbound_action_id = ${iaId}`
  check('exactly one events row written to the DB (not 3)', evs.length === 1 && evs[0].contact_id === cts[0].id && evs[0].application_id === null, evs)
}

async function main() {
  await reset()
  try {
    await scenarioNewCompanyConfirmation()
    await scenarioKnownCompanyRejection()
    await scenarioThreadContinuity()
    await scenarioMultiOpportunity()
  } finally {
    await reset()
  }
  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`)
  process.exit(failures === 0 ? 0 : 1)
}

await main()
