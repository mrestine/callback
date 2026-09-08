import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ContactForm } from '../components/ContactForm'
import { Badge, Button, EmptyState, ErrorNote, Field, Loading, PageHeader, SelectField, TextField } from '../components/ui'
import { CONTACT_KINDS } from '../schemas'
import { formatDate, titleCase } from '../lib/format'
import { useContacts, useCreateContact } from '../lib/queries'

export function Contacts() {
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('')
  const [creating, setCreating] = useState(false)

  const contacts = useContacts({ q: q || undefined, kind: kind || undefined })
  const create = useCreateContact()

  return (
    <div>
      <PageHeader title="Contacts">
        <Button onClick={() => setCreating((v) => !v)} variant={creating ? 'ghost' : 'primary'}>
          {creating ? 'Close' : 'New contact'}
        </Button>
      </PageHeader>

      {creating && (
        <div className="mb-6 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
          <ContactForm
            submitLabel="Create"
            onCancel={() => setCreating(false)}
            onSubmit={(values) => create.mutateAsync(values).then(() => setCreating(false))}
          />
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-3">
        <div className="max-w-xs flex-1">
          <Field label="Search">
            <TextField value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name…" />
          </Field>
        </div>
        <div className="w-40">
          <Field label="Kind">
            <SelectField value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">All</option>
              {CONTACT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {titleCase(k)}
                </option>
              ))}
            </SelectField>
          </Field>
        </div>
      </div>

      {contacts.isPending ? (
        <Loading />
      ) : contacts.isError ? (
        <ErrorNote error={contacts.error} />
      ) : contacts.data.length === 0 ? (
        <EmptyState>{q || kind ? 'No contacts match those filters.' : 'No contacts yet.'}</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-gray-900">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Company</th>
                <th className="px-3 py-2 font-medium">Kind</th>
                <th className="px-3 py-2 font-medium">Warmth</th>
                <th className="px-3 py-2 font-medium">Last contact</th>
              </tr>
            </thead>
            <tbody>
              {contacts.data.map((ct) => (
                <tr key={ct.id} className="border-b border-gray-100 last:border-0 dark:border-gray-900">
                  <td className="px-3 py-2">
                    <Link to={`/contacts/${ct.id}`} className="font-medium text-blue-600 hover:underline dark:text-blue-400">
                      {ct.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-400">
                    {ct.company_id ? (
                      <Link to={`/companies/${ct.company_id}`} className="hover:underline">
                        {ct.company_name}
                      </Link>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{titleCase(ct.kind)}</td>
                  <td className="px-3 py-2">
                    <Badge tone={ct.warmth}>{ct.warmth}</Badge>
                  </td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-400">
                    {formatDate(ct.last_contact_at) || <span className="text-gray-400">—</span>}
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
