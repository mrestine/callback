import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ApplicationForm } from '../components/ApplicationForm'
import { Autocomplete } from '../components/Autocomplete'
import { Badge, Button, EmptyState, ErrorNote, Field, Loading, PageHeader, SelectField, TextField } from '../components/ui'
import { APPLICATION_STATUSES } from '../schemas'
import { formatDate, titleCase } from '../lib/format'
import { useApplications, useCompanyOptions, useCreateApplication } from '../lib/queries'
import type { AutocompleteOption } from '../lib/types'

export function Applications() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState(searchParams.get('status') ?? '')
  const [company, setCompany] = useState<AutocompleteOption | null>(null)
  const [creating, setCreating] = useState(false)

  const applications = useApplications({
    q: q || undefined,
    status: status || undefined,
    company_id: company?.id,
  })
  const create = useCreateApplication()

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
            <TextField value={q} onChange={(e) => setQ(e.target.value)} placeholder="Role title…" />
          </Field>
        </div>
        <div className="w-40">
          <Field label="Status">
            <SelectField value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              {APPLICATION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {titleCase(s)}
                </option>
              ))}
            </SelectField>
          </Field>
        </div>
        <div className="w-56">
          <Field label="Company">
            <Autocomplete value={company} onChange={setCompany} useOptions={useCompanyOptions} placeholder="All" />
          </Field>
        </div>
      </div>

      {applications.isPending ? (
        <Loading />
      ) : applications.isError ? (
        <ErrorNote error={applications.error} />
      ) : applications.data.length === 0 ? (
        <EmptyState>
          {q || status || company ? 'No applications match those filters.' : 'No applications yet.'}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-gray-900">
              <tr>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Company</th>
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
