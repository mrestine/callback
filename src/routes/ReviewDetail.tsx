import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Badge,
  Button,
  ErrorNote,
  Field,
  Loading,
  PageHeader,
  SelectField,
  TextArea,
  TextField,
} from '../components/ui'
import { APPLICATION_STATUSES } from '../schemas'
import { formatDate, titleCase } from '../lib/format'
import { useInboundAction, useResolveInbound, type OpOverride } from '../lib/queries'
import type { InboundExtracted, ProposalOp } from '../lib/types'

const CREATE_OF: Record<string, string> = {
  link_company: 'create_company',
  link_application: 'create_application',
  link_contact: 'create_contact',
}
const OP_LABEL: Record<string, string> = {
  link_company: 'Company',
  create_company: 'Company (new)',
  link_application: 'Application',
  create_application: 'Application (new)',
  link_contact: 'Contact',
  create_contact: 'Contact (new)',
  add_event: 'Timeline event',
  set_status: 'Status change',
}

interface OpState {
  decision: 'accept' | 'skip'
  mode: 'link' | 'create'
  chosen: number | null
  args: Record<string, string>
}

function initArgs(op: ProposalOp, ex: InboundExtracted | undefined): Record<string, string> {
  const a: Record<string, string> = {}
  for (const [k, v] of Object.entries(op.args ?? {})) a[k] = v == null ? '' : String(v)
  // defaults for a link op the reviewer might convert to "create new"
  if (op.op === 'link_company' && !a.name) a.name = ex?.hiring_company.name ?? ''
  if (op.op === 'link_application') {
    a.role_title ||= ex?.role.title ?? ''
    a.status ||= ex?.status_signal ?? 'applied'
  }
  if (op.op === 'link_contact') {
    a.name ||= ex?.sender.name ?? ex?.sender.email ?? ''
    a.email ||= ex?.sender.email ?? ''
    a.kind ||= ex?.sender.kind ?? 'other'
  }
  return a
}

export function ReviewDetail() {
  const { id: idParam } = useParams()
  const id = Number(idParam)
  const navigate = useNavigate()
  const detail = useInboundAction(id)
  const resolve = useResolveInbound()
  const [err, setErr] = useState<string | null>(null)

  const ex = detail.data?.payload?.extracted
  const ops = useMemo(() => detail.data?.proposal ?? [], [detail.data])
  const [state, setState] = useState<Record<string, OpState> | null>(null)

  // lazily seed local state once the proposal has loaded
  const opState =
    state ??
    Object.fromEntries(
      ops.map((op) => [
        op.id,
        {
          decision: op.decision,
          mode: op.op.startsWith('create_') ? 'create' : 'link',
          chosen: op.match?.chosen ?? null,
          args: initArgs(op, ex),
        } as OpState,
      ]),
    )

  if (!Number.isInteger(id) || id <= 0) return <ErrorNote error={new Error('Invalid id')} />
  if (detail.isPending) return <Loading />
  if (detail.isError) return <ErrorNote error={detail.error} />

  const row = detail.data
  const readOnly = row.status !== 'needs_review'

  function set(opId: string, patch: Partial<OpState>) {
    setState((prev) => {
      const base = prev ?? opState
      return { ...base, [opId]: { ...base[opId], ...patch } }
    })
  }

  const unresolved = ops.some((op) => {
    const s = opState[op.id]
    return (
      s.decision === 'accept' &&
      s.mode === 'link' &&
      op.op.startsWith('link_') &&
      s.chosen == null
    )
  })

  function buildOverrides(): Record<string, OpOverride> {
    const out: Record<string, OpOverride> = {}
    for (const op of ops) {
      const s = opState[op.id]
      const ov: OpOverride = { decision: s.decision }
      if (op.op.startsWith('link_')) {
        if (s.mode === 'create') {
          ov.op = CREATE_OF[op.op]
          ov.args = pickCreateArgs(CREATE_OF[op.op], s.args)
        } else {
          ov.chosen = s.chosen
        }
      } else if (op.op === 'create_company' || op.op === 'create_application' || op.op === 'create_contact') {
        ov.args = pickCreateArgs(op.op, s.args)
      } else if (op.op === 'add_event') {
        ov.args = { body: s.args.body ?? '' }
      } else if (op.op === 'set_status') {
        ov.args = { status: s.args.status }
      }
      out[op.id] = ov
    }
    return out
  }

  async function approve() {
    setErr(null)
    try {
      await resolve.mutateAsync({ id, body: { action: 'apply', ops: buildOverrides() } })
      navigate('/review')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Apply failed')
    }
  }

  async function reject() {
    setErr(null)
    try {
      await resolve.mutateAsync({ id, body: { action: 'dismiss' } })
      navigate('/review')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Dismiss failed')
    }
  }

  return (
    <div>
      <Link to="/review" className="text-sm text-blue-600 hover:underline dark:text-blue-400">
        ← Review
      </Link>

      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {row.email_kind ? titleCase(row.email_kind) : 'Inbound item'}
            <Badge tone={row.status === 'applied' ? 'offer' : row.status === 'needs_review' ? 'warm' : 'withdrawn'}>
              {titleCase(row.status)}
            </Badge>
          </span>
        }
      />

      <p className="mb-4 text-sm text-gray-700 dark:text-gray-300">{row.summary || '(no summary)'}</p>

      <dl className="mb-6 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs text-gray-500">
        <dt>Occurred</dt>
        <dd>{formatDate(row.occurred_at) || '—'}</dd>
        <dt>Source</dt>
        <dd>
          {row.source} · {row.external_ref}
        </dd>
        {row.payload?.thread_key && (
          <>
            <dt>Thread</dt>
            <dd className="break-all">{row.payload.thread_key}</dd>
          </>
        )}
      </dl>

      {ex && <ExtractedPanel ex={ex} />}

      <h3 className="mb-2 mt-6 text-sm font-semibold">
        {readOnly ? 'Applied' : 'Proposed changes'}
      </h3>

      {readOnly ? (
        <AppliedList row={row} />
      ) : ops.length === 0 ? (
        <p className="text-sm text-gray-500">
          Nothing proposed — this was classified as noise. Dismiss to clear it.
        </p>
      ) : (
        <div className="space-y-3">
          {ops.map((op) => (
            <OpCard key={op.id} op={op} s={opState[op.id]} onChange={(patch) => set(op.id, patch)} />
          ))}
        </div>
      )}

      {err && (
        <div className="mt-4">
          <ErrorNote error={new Error(err)} />
        </div>
      )}

      {!readOnly && (
        <div className="mt-6 flex items-center gap-2">
          <Button onClick={approve} disabled={resolve.isPending || unresolved}>
            {unresolved ? 'Resolve the pickers first' : 'Approve'}
          </Button>
          <Button variant="danger" onClick={reject} disabled={resolve.isPending}>
            Reject
          </Button>
        </div>
      )}
    </div>
  )
}

// --------------------------------------------------------------------------
function ExtractedPanel({ ex }: { ex: InboundExtracted }) {
  const rows: [string, string | null][] = [
    ['Sender', ex.sender.name || ex.sender.email],
    ['Sender email', ex.sender.email],
    ['Sender org', ex.sender.org],
    ['Agency recruiter', ex.sender.is_agency_recruiter ? 'yes' : 'no'],
    ['Hiring company', ex.hiring_company.withheld ? '(withheld)' : ex.hiring_company.name],
    ['Role', ex.role.title],
    ['Status signal', ex.status_signal],
    ['Notes', ex.notes],
  ]
  const extra = ex.additional_opportunities ?? []
  return (
    <div className="rounded-lg border border-gray-200 p-3 text-xs dark:border-gray-800">
      <div className="mb-1 font-medium text-gray-500">What the model read</div>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-gray-400">{k}</dt>
              <dd className="text-gray-700 dark:text-gray-300">{v}</dd>
            </div>
          ))}
      </dl>
      {extra.length > 0 && (
        <>
          <div className="mb-1 mt-2 font-medium text-gray-500">
            + {extra.length} more {extra.length === 1 ? 'opportunity' : 'opportunities'} in this email
          </div>
          <ul className="list-disc space-y-0.5 pl-4 text-gray-700 dark:text-gray-300">
            {extra.map((o, i) => (
              <li key={i}>
                {o.role.title || '(role not stated)'}
                {o.hiring_company.withheld ? ' @ (withheld)' : o.hiring_company.name ? ` @ ${o.hiring_company.name}` : ''}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function AppliedList({ row }: { row: { applied: InboundRowApplied[] | null; status: string; error: string | null } }) {
  if (row.status === 'dismissed') return <p className="text-sm text-gray-500">Dismissed — no changes made.</p>
  if (row.error) return <ErrorNote error={new Error(row.error)} />
  if (!row.applied || row.applied.length === 0)
    return <p className="text-sm text-gray-500">No op results recorded.</p>
  return (
    <ul className="space-y-1 text-sm">
      {row.applied.map((a) => (
        <li key={a.id} className="text-gray-700 dark:text-gray-300">
          <span className="text-gray-400">{OP_LABEL[a.op] ?? a.op}</span>{' '}
          {a.created ? 'created' : 'linked'} <span className="text-gray-400">#{a.result_id}</span>
        </li>
      ))}
    </ul>
  )
}
type InboundRowApplied = { id: string; op: string; result_id: number | null; created: boolean }

function OpCard({
  op,
  s,
  onChange,
}: {
  op: ProposalOp
  s: OpState
  onChange: (patch: Partial<OpState>) => void
}) {
  const isLink = op.op.startsWith('link_')
  const showCreateFields = (isLink && s.mode === 'create') || op.op.startsWith('create_')
  const createOp = op.op.startsWith('create_') ? op.op : CREATE_OF[op.op]

  return (
    <div
      className={`rounded-lg border p-3 ${
        s.decision === 'skip'
          ? 'border-gray-200 opacity-60 dark:border-gray-800'
          : 'border-gray-300 dark:border-gray-700'
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">{OP_LABEL[op.op] ?? op.op}</span>
        <label className="flex items-center gap-1.5 text-xs text-gray-500">
          <input
            type="checkbox"
            checked={s.decision === 'accept'}
            onChange={(e) => onChange({ decision: e.target.checked ? 'accept' : 'skip' })}
          />
          Apply
        </label>
      </div>

      {op.reason && <p className="mb-2 text-xs text-gray-400">{op.reason}</p>}

      {isLink && (
        <Field label="Match">
          <SelectField
            value={s.mode === 'create' ? '__create__' : (s.chosen ?? '')}
            onChange={(e) => {
              const v = e.target.value
              if (v === '__create__') onChange({ mode: 'create' })
              else onChange({ mode: 'link', chosen: v ? Number(v) : null })
            }}
          >
            <option value="">— pick one —</option>
            {op.match?.candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} ({c.score.toFixed(2)})
              </option>
            ))}
            <option value="__create__">➕ Create new instead</option>
          </SelectField>
        </Field>
      )}

      {showCreateFields && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {createOp === 'create_company' && (
            <Field label="Company name">
              <TextField value={s.args.name ?? ''} onChange={(e) => onChange({ args: { ...s.args, name: e.target.value } })} />
            </Field>
          )}
          {createOp === 'create_application' && (
            <>
              <Field label="Role title">
                <TextField
                  value={s.args.role_title ?? ''}
                  onChange={(e) => onChange({ args: { ...s.args, role_title: e.target.value } })}
                />
              </Field>
              <Field label="Status">
                <SelectField
                  value={s.args.status ?? 'applied'}
                  onChange={(e) => onChange({ args: { ...s.args, status: e.target.value } })}
                >
                  {APPLICATION_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {titleCase(st)}
                    </option>
                  ))}
                </SelectField>
              </Field>
            </>
          )}
          {createOp === 'create_contact' && (
            <>
              <Field label="Name">
                <TextField value={s.args.name ?? ''} onChange={(e) => onChange({ args: { ...s.args, name: e.target.value } })} />
              </Field>
              <Field label="Email">
                <TextField value={s.args.email ?? ''} onChange={(e) => onChange({ args: { ...s.args, email: e.target.value } })} />
              </Field>
              <Field label="Role">
                <TextField value={s.args.role ?? ''} onChange={(e) => onChange({ args: { ...s.args, role: e.target.value } })} />
              </Field>
            </>
          )}
        </div>
      )}

      {op.op === 'add_event' && (
        <div className="mt-1">
          <p className="mb-1 text-xs text-gray-400">
            {titleCase(String(op.args?.type ?? 'email'))}
            {op.args?.occurred_at ? ` · ${formatDate(String(op.args.occurred_at))}` : ''}
          </p>
          <Field label="Body">
            <TextArea value={s.args.body ?? ''} onChange={(e) => onChange({ args: { ...s.args, body: e.target.value } })} />
          </Field>
        </div>
      )}

      {op.op === 'set_status' && (
        <Field label="New status">
          <SelectField
            value={s.args.status ?? ''}
            onChange={(e) => onChange({ args: { ...s.args, status: e.target.value } })}
          >
            {APPLICATION_STATUSES.map((st) => (
              <option key={st} value={st}>
                {titleCase(st)}
              </option>
            ))}
          </SelectField>
        </Field>
      )}
    </div>
  )
}

function pickCreateArgs(op: string, args: Record<string, string>): Record<string, unknown> {
  if (op === 'create_company') return { name: args.name?.trim() }
  if (op === 'create_application')
    return { role_title: args.role_title?.trim() || '(role not stated)', status: args.status || 'applied' }
  if (op === 'create_contact')
    return {
      name: args.name?.trim() || args.email?.trim() || 'Unknown',
      email: args.email?.trim() || null,
      kind: args.kind || 'other',
      role: args.role?.trim() || null,
    }
  return {}
}
