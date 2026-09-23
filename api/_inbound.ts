/**
 * The matching / proposal / apply logic behind /api/inbound.
 *
 * `callback` never models email. Input here is the worker's extracted structure
 * (`Extracted`); output is a `proposal` — an ordered list of typed ops the
 * operator approves in the review UI. Nothing in this file writes domain data
 * until `applyProposal` runs, and that runs as one atomic statement.
 */
import { sql } from './_db.js'
import type {
  Extracted,
  MatchCandidate,
  ProposalOp,
} from '../src/schemas/index.js'
import { APPLICATION_STATUSES, dateOnlyToInstant, instantToLocalDateOnly } from '../src/schemas/index.js'

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

type Status = (typeof APPLICATION_STATUSES)[number]
const INACTIVE: Status[] = ['rejected', 'withdrawn', 'ghosted']

export interface EntityMatch {
  chosen: number | null
  candidates: MatchCandidate[]
}
/** one hiring_company + role pair; index 0 is always the extraction's
 *  top-level fields, index 1+ are `additional_opportunities` (rare: more
 *  than one distinct role/company the operator is pursuing from one email). */
interface Opportunity {
  hiring_company?: Extracted['hiring_company']
  role?: Extracted['role']
}
export interface MatchResult {
  contact: EntityMatch
  /** one per opportunity, same order/length as `opportunitiesOf(ex)` */
  companies: EntityMatch[]
  applications: EntityMatch[]
}

const empty = (): EntityMatch => ({ chosen: null, candidates: [] })
const clean = (s: string | null | undefined) => (s ?? '').trim()

function opportunitiesOf(ex: Extracted): Opportunity[] {
  return [{ hiring_company: ex.hiring_company, role: ex.role }, ...(ex.additional_opportunities ?? [])]
}

// --------------------------------------------------------------------------
// Match  (deterministic + SQL, no model)
// --------------------------------------------------------------------------
export async function matchEntities(
  uid: number,
  ex: Extracted,
  threadKey: string | null,
): Promise<MatchResult> {
  const senderEmail = clean(ex.sender?.email).toLowerCase()
  const senderName = clean(ex.sender?.name)
  const agency = ex.sender?.is_agency_recruiter === true

  const contact = await matchContact(uid, senderEmail, senderName)

  // thread continuity: reuse the application a prior message in this thread
  // resolved to — only meaningful for the first/primary opportunity.
  let threadPriorApp: number | null = null
  let threadPriorCompany: number | null = null
  if (threadKey) {
    const prior = await sql`
      select applied from inbound_actions
      where user_id = ${uid} and thread_key = ${threadKey}
        and status = 'applied' and applied is not null
      order by created_at desc
      limit 5
    `
    for (const row of prior) {
      const apps = (row.applied as { op?: string; result_id?: number }[] | null) ?? []
      const hit = apps.find((a) => a.op?.includes('application') && a.result_id)
      if (hit?.result_id) {
        const [live] = await sql`
          select id, company_id from applications where id = ${hit.result_id} and user_id = ${uid}
        `
        if (live) {
          threadPriorApp = Number(live.id)
          threadPriorCompany = live.company_id ? Number(live.company_id) : null
          break
        }
      }
    }
  }

  const companies: EntityMatch[] = []
  const applications: EntityMatch[] = []
  for (const [i, opp] of opportunitiesOf(ex).entries()) {
    const companyName = clean(opp.hiring_company?.name)
    const withheld = opp.hiring_company?.withheld === true
    const roleTitle = clean(opp.role?.title)

    const company =
      agency || withheld || !companyName ? empty() : await matchCompany(uid, companyName)
    if (i === 0 && company.chosen == null && threadPriorCompany != null) {
      company.chosen = threadPriorCompany
    }
    companies.push(company)

    // a company that's ambiguous or not yet on file has no applications to
    // search among — matching anyway (ignoring company entirely) is how an
    // unrelated role at a different company used to show up as a candidate.
    const priorApp = i === 0 ? threadPriorApp : null
    const application =
      !agency && !withheld && company.chosen != null
        ? await matchApplication(uid, roleTitle, company.chosen, priorApp)
        : empty()
    applications.push(application)
  }

  return { contact, companies, applications }
}

async function matchContact(
  uid: number,
  email: string,
  name: string,
): Promise<EntityMatch> {
  if (!email && !name) return empty()
  const rows = await sql`
    select id, name, email,
      case when ${email} <> '' and lower(email) = ${email} then 1.0
           else similarity(name, ${name}) end as score
    from contacts
    where user_id = ${uid}
      and ( (${email} <> '' and lower(email) = ${email})
            or (${name} <> '' and similarity(name, ${name}) > 0.35) )
    order by score desc
    limit 5
  `
  const candidates: MatchCandidate[] = rows.map((r) => ({
    id: Number(r.id),
    label: r.email ? `${r.name} <${r.email}>` : String(r.name),
    score: Number(r.score),
  }))
  const exact = rows.find((r) => email && String(r.email ?? '').toLowerCase() === email)
  return { chosen: exact ? Number(exact.id) : null, candidates }
}

async function matchCompany(uid: number, name: string): Promise<EntityMatch> {
  const rows = await sql`
    select id, name, similarity(name, ${name}) as score
    from companies
    where user_id = ${uid}
      and (name ilike ${'%' + name + '%'} or similarity(name, ${name}) > 0.3)
    order by score desc
    limit 5
  `
  const candidates: MatchCandidate[] = rows.map((r) => ({
    id: Number(r.id),
    label: String(r.name),
    score: Number(r.score),
  }))
  const top = rows[0]
  const confident =
    top && (String(top.name).toLowerCase() === name.toLowerCase() || Number(top.score) >= 0.6)
  return { chosen: confident ? Number(top.id) : null, candidates }
}

/** only called once a company is confidently resolved (or thread continuity
 *  overrides it) — never with `companyId: null` scanning every company, which
 *  used to surface unrelated applications as "candidates" for a role that in
 *  fact belongs to a company not yet on file (see matchEntities). */
async function matchApplication(
  uid: number,
  role: string,
  companyId: number,
  threadPriorApp: number | null,
): Promise<EntityMatch> {
  const rows = await sql`
    select a.id, a.role_title, a.status, co.name as company_name,
      similarity(a.role_title, ${role}) as score
    from applications a
    join companies co on co.id = a.company_id
    where a.user_id = ${uid} and a.company_id = ${companyId}
      and a.status <> all(${INACTIVE})
    order by score desc, a.created_at desc
    limit 5
  `
  const candidates: MatchCandidate[] = rows.map((r) => ({
    id: Number(r.id),
    label: `${r.company_name} — ${r.role_title} · ${r.status}`,
    score: Number(r.score),
  }))
  if (threadPriorApp) return { chosen: threadPriorApp, candidates }
  const activeAtCompany = rows.length === 1
  const strong = rows[0] && Number(rows[0].score) >= 0.55
  return { chosen: activeAtCompany || strong ? Number(rows[0].id) : null, candidates }
}

// --------------------------------------------------------------------------
// Propose  (rules over match + email_kind; builds ops, writes nothing)
// --------------------------------------------------------------------------
const NO_REPLY = /(^|[._-])(no-?reply|donotreply|notifications?)@/i

const initialStatus = (kind: string, signal: string | null): Status => {
  if (signal && (APPLICATION_STATUSES as readonly string[]).includes(signal)) return signal as Status
  switch (kind) {
    case 'application_confirmation':
      return 'applied'
    case 'interview_invite':
    case 'interview_scheduled':
      return 'screen'
    case 'assessment_invite':
      return 'technical'
    case 'offer':
      return 'offer'
    case 'rejection':
      return 'rejected'
    default:
      return 'lead'
  }
}

const eventTypeFor = (kind: string): string => {
  if (kind === 'interview_invite' || kind === 'interview_scheduled') return 'interview'
  if (kind === 'application_confirmation') return 'applied'
  return 'email'
}

/** kinds where an untracked application should be offered as a create op */
const WANTS_APPLICATION = new Set([
  'application_confirmation',
  'interview_invite',
  'interview_scheduled',
  'offer',
  'rejection',
  'assessment_invite',
])

export interface ProposalResult {
  status: 'needs_review' | 'dismissed'
  ops: ProposalOp[]
}

export function proposeOps(ex: Extracted, match: MatchResult): ProposalResult {
  if (!ex.job_related || ex.email_kind === 'noise') return { status: 'dismissed', ops: [] }

  const kind = ex.email_kind
  const agency = ex.sender?.is_agency_recruiter === true
  const opportunities = opportunitiesOf(ex)
  // >1 opportunity only happens when the operator explicitly named several
  // distinct roles/companies to pursue in one email (see extract.system.md) —
  // an explicit decision, unlike a passive single agency pitch. That earns two
  // deviations from the single-opportunity rule below: an agency-sourced
  // company/application gets created anyway, and each defaults to accepted
  // rather than an optional skip.
  const isMulti = opportunities.length > 1

  const ops: ProposalOp[] = []
  const appRefs: (string | null)[] = []

  // --- company + application, one pair per opportunity ----------------
  for (const [i, opp] of opportunities.entries()) {
    const n = i + 1
    const withheld = opp.hiring_company?.withheld === true
    const companyName = clean(opp.hiring_company?.name)
    const companyKnown = (!agency || isMulti) && !withheld && !!companyName
    const companyMatch = match.companies[i] ?? empty()
    const applicationMatch = match.applications[i] ?? empty()

    let companyRef: string | null = null
    if (companyKnown) {
      companyRef = `$c${n}`
      if (companyMatch.chosen != null || companyMatch.candidates.length > 0) {
        ops.push({
          id: `c${n}`,
          op: 'link_company',
          match: companyMatch,
          decision: 'accept',
          reason: companyMatch.chosen == null ? 'pick the company or switch to create' : undefined,
        })
      } else {
        ops.push({
          id: `c${n}`,
          op: 'create_company',
          args: { name: companyName },
          decision: 'accept',
          reason: 'no company on file with this name',
        })
      }
    }

    let appRef: string | null = null
    if (companyKnown || applicationMatch.chosen != null) {
      appRef = `$a${n}`
      if (applicationMatch.chosen != null || applicationMatch.candidates.length > 0) {
        ops.push({
          id: `a${n}`,
          op: 'link_application',
          refs: companyRef ? { company_id: companyRef } : undefined,
          match: applicationMatch,
          decision: 'accept',
          reason:
            applicationMatch.chosen == null ? 'pick the application or switch to create' : undefined,
        })
      } else if (WANTS_APPLICATION.has(kind) || isMulti) {
        ops.push({
          id: `a${n}`,
          op: 'create_application',
          args: {
            role_title: clean(opp.role?.title) || '(role not stated)',
            status: initialStatus(kind, ex.status_signal),
          },
          refs: companyRef ? { company_id: companyRef } : undefined,
          decision: 'accept',
          reason: 'no matching application — will create one',
        })
      } else {
        // recruiter_outreach / status_update etc. with a named company but no app:
        // offer a create, but skipped by default (event lands on the contact)
        ops.push({
          id: `a${n}`,
          op: 'create_application',
          args: { role_title: clean(opp.role?.title) || '(role not stated)', status: 'lead' },
          refs: companyRef ? { company_id: companyRef } : undefined,
          decision: 'skip',
          reason: 'optional — only if you want to track this as an application',
        })
        appRef = null
      }
    }
    appRefs.push(appRef)
  }

  // --- contact (one, shared across every opportunity) ------------------
  let contactRef: string | null = null
  const senderEmail = clean(ex.sender?.email)
  const senderName = clean(ex.sender?.name)
  if (senderEmail || senderName) {
    contactRef = '$ct1'
    if (match.contact.chosen != null || match.contact.candidates.length > 0) {
      ops.push({
        id: 'ct1',
        op: 'link_contact',
        match: match.contact,
        decision: 'accept',
        reason: match.contact.chosen == null ? 'pick the contact or switch to create' : undefined,
      })
    } else {
      const noReply = NO_REPLY.test(senderEmail)
      const primaryCompanyRef = ops.find((o) => o.id === 'c1')
      ops.push({
        id: 'ct1',
        op: 'create_contact',
        args: {
          name: senderName || senderEmail || 'Unknown sender',
          email: senderEmail || null,
          kind: agency ? 'recruiter' : String(ex.sender?.kind ?? 'other'),
          role: agency ? `Recruiter - ${clean(ex.sender?.org) || 'agency'}` : null,
        },
        refs: primaryCompanyRef && !agency ? { company_id: '$c1' } : undefined,
        decision: noReply ? 'skip' : 'accept',
        reason: noReply ? 'no-reply address — usually not worth a contact' : undefined,
      })
    }
  }

  // --- event — exactly one per submission ------------------------------
  // A forwarded email is one event, no matter how many companies/applications
  // it produced (there's exactly one conversation with the sender). Single
  // opportunity: attach to that application + the contact, as before. Several
  // opportunities: no single one of them "owns" the email, so attach to the
  // contact only; if there's no contact either (rare — no-reply, no name),
  // fall back to whichever application exists so it lands somewhere.
  const eventRefs: Record<string, string> = {}
  if (opportunities.length === 1 && appRefs[0]) eventRefs.application_id = appRefs[0]
  if (contactRef) eventRefs.contact_id = contactRef
  if (Object.keys(eventRefs).length === 0) {
    const anyAppRef = appRefs.find((r): r is string => r != null)
    if (anyAppRef) eventRefs.application_id = anyAppRef
  }
  if (Object.keys(eventRefs).length > 0) {
    ops.push({
      id: 'e1',
      op: 'add_event',
      args: {
        type: eventTypeFor(kind),
        subtype: clean(ex.event?.subtype) || null,
        body: clean(ex.event?.summary) || clean(ex.notes) || null,
        occurred_at: clean(ex.event?.occurred_at) || null,
      },
      refs: eventRefs,
      decision: 'accept',
    })
  }

  // --- status change (only against an existing, linked application) --
  if (['rejection', 'offer', 'interview_invite', 'interview_scheduled', 'assessment_invite'].includes(kind)) {
    for (const [i, appRef] of appRefs.entries()) {
      const linkedApp = ops.find((o) => o.id === `a${i + 1}` && o.op === 'link_application')
      if (!linkedApp || !appRef) continue
      ops.push({
        id: `s${i + 1}`,
        op: 'set_status',
        args: { status: initialStatus(kind, ex.status_signal) },
        refs: { application_id: appRef },
        decision: 'accept',
      })
    }
  }

  return { status: 'needs_review', ops }
}

/** true if any un-skipped link op still needs the reviewer to pick a candidate */
export function needsDisambiguation(ops: ProposalOp[]): boolean {
  return ops.some(
    (o) =>
      o.decision !== 'skip' &&
      o.op.startsWith('link_') &&
      (o.match?.chosen == null) &&
      (o.match?.candidates.length ?? 0) > 0,
  )
}

// --------------------------------------------------------------------------
// Apply  (one atomic statement: WITH <op ctes>, _ia update RETURNING ids)
// --------------------------------------------------------------------------
const statusForDate = (d: Date | null): 'scheduled' | 'logged' =>
  d && d.getTime() > Date.now() ? 'scheduled' : 'logged'

interface ApplyCtx {
  uid: number
  inboundActionId: number
  fallbackOccurredAt: Date | null
}
export interface ApplyPlan {
  text: string
  params: unknown[]
  /** op id -> the `select` column alias that returns its new row id */
  resultAliases: Record<string, string>
}

export function buildApplyPlan(ops: ProposalOp[], ctx: ApplyCtx): ApplyPlan | { error: string } {
  const live = ops.filter((o) => o.decision !== 'skip')
  const params: unknown[] = []
  const p = (v: unknown) => {
    params.push(v)
    return `$${params.length}`
  }

  // resolve each op to a literal id or a CTE alias. A link op's id is stored
  // as the raw value, NOT yet bound as a $N parameter — a proposal where
  // every entity is linked (not created) commonly has one that nothing else
  // ever references (e.g. link_company when only its application and
  // contact end up wired into add_event/set_status). Binding it eagerly
  // here left a $N in `params` with no matching placeholder anywhere in the
  // generated SQL text, which postgres rejects outright ("could not
  // determine data type of parameter $N") rather than just ignoring —
  // so `refExpr` below allocates (and memoizes) the placeholder lazily, only
  // for ids actually referenced by something.
  type Resolved = { kind: 'lit'; value: number } | { kind: 'cte'; alias: string }
  const resolved = new Map<string, Resolved>()
  for (const op of live) {
    if (op.op === 'link_company' || op.op === 'link_application' || op.op === 'link_contact') {
      if (op.match?.chosen == null) return { error: `op ${op.id} (${op.op}) has no chosen row` }
      resolved.set(op.id, { kind: 'lit', value: op.match.chosen })
    } else if (op.op !== 'add_event' && op.op !== 'set_status') {
      resolved.set(op.id, { kind: 'cte', alias: `op_${op.id}` })
    }
  }

  /** a ref value ("$c1") -> SQL expression, or null if it points at a skipped op */
  const litParams = new Map<string, string>()
  const refExpr = (ref: string | undefined): string | null => {
    if (!ref) return null
    const target = ref.replace(/^\$/, '')
    const r = resolved.get(target)
    if (!r) return null
    if (r.kind === 'cte') return `(select id from ${r.alias})`
    let expr = litParams.get(target)
    if (!expr) {
      expr = p(r.value)
      litParams.set(target, expr)
    }
    return expr
  }

  const ctes: string[] = []
  const selects: string[] = []
  const resultAliases: Record<string, string> = {}
  const iaId = p(ctx.inboundActionId)
  const uid = p(ctx.uid)
  const iaRef = `${iaId}` // reused below

  for (const op of live) {
    const A = (a: string) => (op.args?.[a] ?? null) as unknown
    switch (op.op) {
      case 'create_company': {
        const name = clean(A('name') as string)
        if (!name) return { error: 'create_company needs a name' }
        ctes.push(
          `op_${op.id} as (insert into companies (user_id, name, careers_url, notes) ` +
            `values (${uid}, ${p(name)}, ${p(clean(A('careers_url') as string) || null)}, ` +
            `${p(clean(A('notes') as string) || null)}) returning id)`,
        )
        selects.push(`(select id from op_${op.id}) as op_${op.id}`)
        resultAliases[op.id] = `op_${op.id}`
        break
      }
      case 'create_contact': {
        const companyExpr = refExpr(op.refs?.company_id)
        const name = clean(A('name') as string) || 'Unknown sender'
        ctes.push(
          `op_${op.id} as (insert into contacts (user_id, company_id, name, email, kind, role, linkedin_url, warmth, notes) ` +
            `values (${uid}, ${companyExpr ?? 'null'}, ${p(name)}, ${p(A('email'))}, ` +
            `coalesce(${p(A('kind'))}, 'other'), ${p(A('role'))}, ${p(clean(A('linkedin_url') as string) || null)}, ` +
            `coalesce(${p(clean(A('warmth') as string) || null)}, 'cold'), ${p(clean(A('notes') as string) || null)}) returning id)`,
        )
        selects.push(`(select id from op_${op.id}) as op_${op.id}`)
        resultAliases[op.id] = `op_${op.id}`
        break
      }
      case 'create_application': {
        const companyExpr = refExpr(op.refs?.company_id)
        if (!companyExpr) return { error: 'create_application needs a company' }
        const role = clean(A('role_title') as string) || '(role not stated)'
        const st = (A('status') as string) || 'lead'
        // an application created straight into 'applied' (or later) implies
        // the applying already happened — default the date to when the
        // underlying email/event occurred, same fallback add_event uses,
        // rather than leaving it null. An explicit args.applied_at (the
        // reviewer typed one in) always wins.
        const appliedAtInput = clean(A('applied_at') as string)
        const appliedAt =
          appliedAtInput ||
          (st !== 'lead' && ctx.fallbackOccurredAt ? instantToLocalDateOnly(ctx.fallbackOccurredAt) : null)
        ctes.push(
          `op_${op.id} as (insert into applications ` +
            `(user_id, company_id, role_title, status, jd_url, source, location, remote, salary_range, applied_at, notes, inbound_action_id) ` +
            `values (${uid}, ${companyExpr}, ${p(role)}, ${p(st)}, ${p(clean(A('jd_url') as string) || null)}, ` +
            `${p(clean(A('source') as string) || null)}, ${p(clean(A('location') as string) || null)}, ` +
            `${p(clean(A('remote') as string) || null)}, ${p(clean(A('salary_range') as string) || null)}, ` +
            `${p(appliedAt)}::date, ${p(clean(A('notes') as string) || null)}, ${iaRef}) returning id)`,
        )
        selects.push(`(select id from op_${op.id}) as op_${op.id}`)
        resultAliases[op.id] = `op_${op.id}`
        break
      }
      case 'add_event': {
        const appExpr = refExpr(op.refs?.application_id)
        const ctExpr = refExpr(op.refs?.contact_id)
        if (!appExpr && !ctExpr) break // nothing to attach it to
        const rawWhen = clean(A('occurred_at') as string)
        // the model sometimes gives a bare date with no time (e.g. "let's go
        // for it Thursday" with no clock time) — never let that fall through
        // to new Date()'s UTC-midnight parsing, same reasoning as schemas/
        // index.ts's dateOnlyToInstant.
        const when = rawWhen ? new Date(DATE_ONLY.test(rawWhen) ? dateOnlyToInstant(rawWhen) : rawWhen) : ctx.fallbackOccurredAt
        const whenValid = when && !Number.isNaN(when.getTime()) ? when : ctx.fallbackOccurredAt
        ctes.push(
          `op_${op.id} as (insert into events ` +
            `(user_id, application_id, contact_id, type, subtype, body, occurred_at, status, source, inbound_action_id) ` +
            `values (${uid}, ${appExpr ?? 'null'}, ${ctExpr ?? 'null'}, ` +
            `coalesce(${p(A('type'))}, 'email'), ${p(A('subtype'))}, ${p(A('body'))}, ` +
            `coalesce(${p(whenValid)}::timestamptz, now()), ` +
            `${p(whenValid ? statusForDate(whenValid) : 'logged')}, 'ai', ${iaRef}) returning id)`,
        )
        selects.push(`(select id from op_${op.id}) as op_${op.id}`)
        resultAliases[op.id] = `op_${op.id}`
        break
      }
      case 'set_status': {
        const appExpr = refExpr(op.refs?.application_id)
        if (!appExpr) break
        const st = A('status') as string
        if (!st) return { error: 'set_status needs a status' }
        ctes.push(
          `old_${op.id} as (select status from applications where id = ${appExpr} and user_id = ${uid})`,
        )
        ctes.push(
          `op_${op.id} as (update applications set status = ${p(st)}, updated_at = now() ` +
            `where id = ${appExpr} and user_id = ${uid} returning id)`,
        )
        ctes.push(
          `evt_${op.id} as (insert into events ` +
            `(user_id, application_id, type, old_status, new_status, source, inbound_action_id) ` +
            `select ${uid}, ${appExpr}, 'status_change', (select status from old_${op.id}), ${p(st)}, 'ai', ${iaRef} ` +
            `where (select status from old_${op.id}) is distinct from ${p(st)} returning id)`,
        )
        selects.push(`(select id from op_${op.id}) as op_${op.id}`)
        resultAliases[op.id] = `op_${op.id}`
        break
      }
      // link_* ops contribute no SQL — already resolved to a literal id
    }
  }

  ctes.push(
    `_ia as (update inbound_actions set status = 'applied', resolved_at = now() ` +
      `where id = ${iaRef} and user_id = ${uid} and status = 'needs_review' returning id)`,
  )
  selects.push(`(select id from _ia) as ia_id`)

  const text = `with ${ctes.join(',\n')}\nselect ${selects.join(', ')}`
  return { text, params, resultAliases }
}
