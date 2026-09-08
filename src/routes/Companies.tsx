import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CompanyForm } from '../components/CompanyForm'
import { Button, EmptyState, ErrorNote, Field, Loading, PageHeader, TextField } from '../components/ui'
import { useCompanies, useCreateCompany } from '../lib/queries'

export function Companies() {
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const companies = useCompanies(q)
  const create = useCreateCompany()

  return (
    <div>
      <PageHeader
        title={
          <>
            Companies{' '}
            {companies.data && (
              <span className="font-normal text-gray-400">· {companies.data.length}</span>
            )}
          </>
        }
      >
        <Button onClick={() => setCreating((v) => !v)} variant={creating ? 'ghost' : 'primary'}>
          {creating ? 'Close' : 'New company'}
        </Button>
      </PageHeader>

      {creating && (
        <div className="mb-6 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
          <CompanyForm
            submitLabel="Create"
            onCancel={() => setCreating(false)}
            onSubmit={(values) => create.mutateAsync(values).then(() => setCreating(false))}
          />
        </div>
      )}

      <div className="mb-3 max-w-xs">
        <Field label="Search">
          <TextField
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Company name…"
          />
        </Field>
      </div>

      {companies.isPending ? (
        <Loading />
      ) : companies.isError ? (
        <ErrorNote error={companies.error} />
      ) : companies.data.length === 0 ? (
        <EmptyState>{q ? 'No companies match that search.' : 'No companies yet.'}</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-gray-900">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Contacts</th>
                <th className="px-3 py-2 font-medium">Applications</th>
                <th className="px-3 py-2 font-medium">Careers</th>
              </tr>
            </thead>
            <tbody>
              {companies.data.map((c) => (
                <tr key={c.id} className="border-b border-gray-100 last:border-0 dark:border-gray-900">
                  <td className="px-3 py-2">
                    <Link to={`/companies/${c.id}`} className="font-medium text-blue-600 hover:underline dark:text-blue-400">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-gray-600 dark:text-gray-400">{c.contact_count ?? 0}</td>
                  <td className="px-3 py-2 tabular-nums text-gray-600 dark:text-gray-400">{c.application_count ?? 0}</td>
                  <td className="px-3 py-2">
                    {c.careers_url ? (
                      <a
                        href={c.careers_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:underline dark:text-blue-400"
                      >
                        link ↗
                      </a>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
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
