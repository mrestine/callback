import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ContactForm } from '../components/ContactForm'
import { Timeline } from '../components/Timeline'
import { Badge, Button, EmptyState, ErrorNote, Loading, PageHeader } from '../components/ui'
import { formatDate, titleCase, toDateInput } from '../lib/format'
import { useContact, useDeleteContact, useUpdateContact } from '../lib/queries'

export function ContactDetail() {
  const { id: idParam } = useParams()
  const id = Number(idParam)
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)

  const detail = useContact(id)
  const update = useUpdateContact(id)
  const del = useDeleteContact()

  if (!Number.isInteger(id) || id <= 0) return <ErrorNote error={new Error('Invalid contact id')} />
  if (detail.isPending) return <Loading />
  if (detail.isError) return <ErrorNote error={detail.error} />

  const { contact, company, applications, events } = detail.data

  function onDelete() {
    if (!window.confirm(`Delete ${contact.name}?`)) return
    del.mutate(id, { onSuccess: () => navigate('/contacts') })
  }

  return (
    <div>
      <Link to="/contacts" className="text-sm text-blue-600 hover:underline dark:text-blue-400">
        ← Contacts
      </Link>

      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {contact.name}
            <Badge tone={contact.warmth}>{contact.warmth}</Badge>
          </span>
        }
      >
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
          <ContactForm
            defaultValues={{
              name: contact.name,
              company_id: contact.company_id ? String(contact.company_id) : '',
              role: contact.role ?? '',
              kind: contact.kind,
              email: contact.email ?? '',
              linkedin_url: contact.linkedin_url ?? '',
              warmth: contact.warmth,
              notes: contact.notes ?? '',
              last_contact_at: toDateInput(contact.last_contact_at),
            }}
            submitLabel="Save changes"
            onCancel={() => setEditing(false)}
            onSubmit={(values) => update.mutateAsync(values).then(() => setEditing(false))}
          />
        </div>
      ) : (
        <dl className="mb-8 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[8rem_1fr]">
          <dt className="text-gray-500">Company</dt>
          <dd>
            {company ? (
              <Link to={`/companies/${company.id}`} className="text-blue-600 hover:underline dark:text-blue-400">
                {company.name}
              </Link>
            ) : (
              <span className="text-gray-400">—</span>
            )}
          </dd>
          <dt className="text-gray-500">Role</dt>
          <dd>{contact.role || <span className="text-gray-400">—</span>}</dd>
          <dt className="text-gray-500">Kind</dt>
          <dd>{titleCase(contact.kind)}</dd>
          <dt className="text-gray-500">Email</dt>
          <dd>
            {contact.email ? (
              <a href={`mailto:${contact.email}`} className="text-blue-600 hover:underline dark:text-blue-400">
                {contact.email}
              </a>
            ) : (
              <span className="text-gray-400">—</span>
            )}
          </dd>
          <dt className="text-gray-500">LinkedIn</dt>
          <dd>
            {contact.linkedin_url ? (
              <a
                href={contact.linkedin_url}
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 hover:underline dark:text-blue-400"
              >
                {contact.linkedin_url}
              </a>
            ) : (
              <span className="text-gray-400">—</span>
            )}
          </dd>
          <dt className="text-gray-500">Last contact</dt>
          <dd>{formatDate(contact.last_contact_at) || <span className="text-gray-400">—</span>}</dd>
          <dt className="text-gray-500">Notes</dt>
          <dd className="whitespace-pre-wrap">{contact.notes || <span className="text-gray-400">—</span>}</dd>
        </dl>
      )}

      <section className="mb-8">
        <h3 className="mb-2 text-sm font-semibold">Applications ({applications.length})</h3>
        {applications.length === 0 ? (
          <EmptyState>Not linked to any applications.</EmptyState>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-900 dark:border-gray-800">
            {applications.map((a) => (
              <li key={a.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <Link to={`/applications/${a.id}`} className="text-blue-600 hover:underline dark:text-blue-400">
                  {a.role_title}
                </Link>
                <span className="flex items-center gap-3 text-gray-500">
                  <Badge tone={a.status}>{titleCase(a.status)}</Badge>
                  {a.applied_at && <span>{formatDate(a.applied_at)}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Timeline ({events.length})</h3>
        <Timeline events={events} />
      </section>
    </div>
  )
}
