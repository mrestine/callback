import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CompanyForm } from '../components/CompanyForm'
import { Badge, Button, EmptyState, ErrorNote, Loading, PageHeader } from '../components/ui'
import { applicationLabel, formatDate, formatDateOnly, titleCase } from '../lib/format'
import { useCompany, useDeleteCompany, useUpdateCompany } from '../lib/queries'

export function CompanyDetail() {
  const { id: idParam } = useParams()
  const id = Number(idParam)
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)

  const detail = useCompany(id)
  const update = useUpdateCompany(id)
  const del = useDeleteCompany()

  if (!Number.isInteger(id) || id <= 0) return <ErrorNote error={new Error('Invalid company id')} />
  if (detail.isPending) return <Loading />
  if (detail.isError) return <ErrorNote error={detail.error} />

  const { company, contacts, applications } = detail.data

  function onDelete() {
    const msg =
      applications.length > 0
        ? `Delete ${company.name}? This also deletes ${applications.length} application(s) and their history. Contacts are kept.`
        : `Delete ${company.name}?`
    if (!window.confirm(msg)) return
    del.mutate(id, { onSuccess: () => navigate('/companies') })
  }

  return (
    <div>
      <Link to="/companies" className="text-sm text-blue-600 hover:underline dark:text-blue-400">
        ← Companies
      </Link>

      <PageHeader title={company.name}>
        {!editing && (
          <>
            <Button variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button variant="danger" onClick={onDelete} disabled={del.isPending}>
              Delete
            </Button>
          </>
        )}
      </PageHeader>

      {del.isError && (
        <div className="mb-4">
          <ErrorNote error={del.error} />
        </div>
      )}

      {editing ? (
        <div className="mb-8 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
          <CompanyForm
            defaultValues={{
              name: company.name,
              careers_url: company.careers_url ?? '',
              notes: company.notes ?? '',
            }}
            submitLabel="Save changes"
            onCancel={() => setEditing(false)}
            onSubmit={(values) => update.mutateAsync(values).then(() => setEditing(false))}
          />
        </div>
      ) : (
        <dl className="mb-8 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[8rem_1fr]">
          <dt className="text-gray-500">Careers URL</dt>
          <dd>
            {company.careers_url ? (
              <a
                href={company.careers_url}
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 hover:underline dark:text-blue-400"
              >
                {company.careers_url}
              </a>
            ) : (
              <span className="text-gray-400">—</span>
            )}
          </dd>
          <dt className="text-gray-500">Notes</dt>
          <dd className="whitespace-pre-wrap">{company.notes || <span className="text-gray-400">—</span>}</dd>
          <dt className="text-gray-500">Added</dt>
          <dd className="text-gray-600 dark:text-gray-400">{formatDate(company.created_at)}</dd>
        </dl>
      )}

      <section className="mb-8">
        <h3 className="mb-2 text-sm font-semibold">Contacts ({contacts.length})</h3>
        {contacts.length === 0 ? (
          <EmptyState>No contacts at this company yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-900 dark:border-gray-800">
            {contacts.map((ct) => (
              <li key={ct.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <Link to={`/contacts/${ct.id}`} className="text-blue-600 hover:underline dark:text-blue-400">
                  {ct.name}
                </Link>
                <span className="flex items-center gap-2 text-gray-500">
                  {ct.role && <span>{ct.role}</span>}
                  <Badge tone={ct.warmth}>{ct.warmth}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Applications ({applications.length})</h3>
        {applications.length === 0 ? (
          <EmptyState>No applications to this company yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-900 dark:border-gray-800">
            {applications.map((a) => (
              <li key={a.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <Link to={`/applications/${a.id}`} className="text-blue-600 hover:underline dark:text-blue-400">
                  {applicationLabel(a.role_title, company.name)}
                </Link>
                <span className="flex items-center gap-3 text-gray-500">
                  <Badge tone={a.status}>{titleCase(a.status)}</Badge>
                  {a.applied_at && <span>{formatDateOnly(a.applied_at)}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
