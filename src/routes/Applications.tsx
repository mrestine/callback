import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ApplicationForm } from '../components/ApplicationForm'
import { Badge, Button, control, EmptyState, ErrorNote, Field, Loading, PageHeader, Popover, TextField, ToggleBadge } from '../components/ui'
import { APPLICATION_STATUSES } from '../schemas'
import { formatDate, titleCase } from '../lib/format'
import { useApplications, useCreateApplication } from '../lib/queries'

/** Default filter: everything still live — excludes rejected / withdrawn / ghosted. */
const DEFAULT_STATUSES = APPLICATION_STATUSES.filter(
  (s) => s !== 'rejected' && s !== 'withdrawn' && s !== 'ghosted',
)

function sameStatusSet(a: string[], b: readonly string[]): boolean {
  return a.length === b.length && b.every((s) => a.includes(s))
}

export function Applications() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<string[]>(() => {
    const fromUrl = searchParams.get('status')
    return fromUrl ? fromUrl.split(',') : DEFAULT_STATUSES
  })
  const [creating, setCreating] = useState(false)

  const applications = useApplications({ q: q || undefined, status })
  const create = useCreateApplication()

  function toggleStatus(s: string) {
    setStatus((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))
  }

  const filtersActive = !!q || !sameStatusSet(status, DEFAULT_STATUSES)

  const statusChips = (
    <>
      {APPLICATION_STATUSES.map((s) => (
        <ToggleBadge key={s} tone={s} selected={status.includes(s)} onClick={() => toggleStatus(s)}>
          {titleCase(s)}
        </ToggleBadge>
      ))}
    </>
  )

  return (
    <div>
      <PageHeader
        title={
          <>
            Applications{' '}
            {applications.data && (
              <span className="font-normal text-gray-400">· {applications.data.length}</span>
            )}
          </>
        }
      >
        <Button onClick={() => setCreating((v) => !v)} variant={creating ? 'ghost' : 'primary'}>
          {creating ? 'Close' : 'New application'}
        </Button>
      </PageHeader>

      {creating && (
        <div className="mb-6 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
          <ApplicationForm
            submitLabel="Create"
            onCancel={() => setCreating(false)}
            onSubmit={(values) => create.mutateAsync(values).then((row) => navigate(`/applications/${row.id}`))}
          />
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-3">
        <div className="max-w-xs flex-1">
          <Field label="Search">
            <TextField value={q} onChange={(e) => setQ(e.target.value)} placeholder="Role, company, or contact…" />
          </Field>
        </div>
        <div className="w-40">
          <Field label="Status">
            <Popover
              trigger={({ toggle }) => (
                <button
                  type="button"
                  onClick={toggle}
                  className={`${control} flex items-center justify-between text-left`}
                >
                  <span>Status ({status.length})</span>
                  <span className="text-gray-400">▾</span>
                </button>
              )}
            >
              <div className="flex w-60 flex-wrap gap-1.5">{statusChips}</div>
            </Popover>
          </Field>
        </div>
      </div>

      {applications.isPending ? (
        <Loading />
      ) : applications.isError ? (
        <ErrorNote error={applications.error} />
      ) : applications.data.length === 0 ? (
        <EmptyState>
          {filtersActive ? 'No applications match those filters.' : 'No applications yet.'}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-gray-900">
              <tr>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Company</th>
                <th className="px-3 py-2 font-medium">Contact</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Applied</th>
                <th className="px-3 py-2 font-medium">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {applications.data.map((a) => (
                <tr key={a.id} className="border-b border-gray-100 last:border-0 dark:border-gray-900">
                  <td className="px-3 py-2">
                    <Link to={`/applications/${a.id}`} className="font-medium text-blue-600 hover:underline dark:text-blue-400">
                      {a.role_title}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-400">
                    <Link to={`/companies/${a.company_id}`} className="hover:underline">
                      {a.company_name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-400">
                    {a.contact_id ? (
                      <Link to={`/contacts/${a.contact_id}`} className="hover:underline">
                        {a.contact_name}
                      </Link>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={a.status}>{titleCase(a.status)}</Badge>
                  </td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-400">
                    {formatDate(a.applied_at) || <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-400">
                    {formatDate(a.last_event_at) || <span className="text-gray-400">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
