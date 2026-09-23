import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApplicationForm } from '../components/ApplicationForm'
import { Timeline } from '../components/Timeline'
import { Badge, Button, ErrorNote, Field, Loading, PageHeader, SelectField } from '../components/ui'
import { APPLICATION_STATUSES } from '../schemas'
import { applicationLabel, formatDateOnly, titleCase, toDateOnlyInput } from '../lib/format'
import { useApplication, useDeleteApplication, useUpdateApplication } from '../lib/queries'

export function ApplicationDetail() {
  const { id: idParam } = useParams()
  const id = Number(idParam)
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)

  const detail = useApplication(id)
  const update = useUpdateApplication(id)
  const del = useDeleteApplication()

  if (!Number.isInteger(id) || id <= 0) return <ErrorNote error={new Error('Invalid application id')} />
  if (detail.isPending) return <Loading />
  if (detail.isError) return <ErrorNote error={detail.error} />

  const { application, company, contact, events } = detail.data

  function onDelete() {
    if (!window.confirm(`Delete the ${applicationLabel(application.role_title, company?.name)} application? Its timeline goes too.`)) return
    del.mutate(id, { onSuccess: () => navigate('/applications') })
  }

  return (
    <div>
      <Link to="/applications" className="text-sm text-blue-600 hover:underline dark:text-blue-400">
        ← Applications
      </Link>

      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {applicationLabel(application.role_title, company?.name)}
            <Badge tone={application.status}>{titleCase(application.status)}</Badge>
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

      {(del.isError || update.isError) && (
        <div className="mb-4">
          <ErrorNote error={del.error ?? update.error} />
        </div>
      )}

      {editing ? (
        <div className="mb-8 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
          <ApplicationForm
            defaultValues={{
              role_title: application.role_title,
              status: application.status,
              jd_url: application.jd_url ?? '',
              source: application.source ?? '',
              location: application.location ?? '',
              remote: application.remote ?? '',
              salary_range: application.salary_range ?? '',
              applied_at: toDateOnlyInput(application.applied_at),
              notes: application.notes ?? '',
            }}
            defaultCompany={company ? { id: company.id, label: company.name } : null}
            defaultContact={contact ? { id: contact.id, label: contact.name } : null}
            submitLabel="Save changes"
            onCancel={() => setEditing(false)}
            onSubmit={(values) => update.mutateAsync(values).then(() => setEditing(false))}
          />
        </div>
      ) : (
        <>
          <div className="mb-6 max-w-xs">
            <Field label="Quick status change" hint="Logs a timeline entry">
              <SelectField
                value={application.status}
                disabled={update.isPending}
                onChange={(e) => update.mutate({ status: e.target.value as typeof application.status })}
              >
                {APPLICATION_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {titleCase(s)}
                  </option>
                ))}
              </SelectField>
            </Field>
          </div>

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
            <dt className="text-gray-500">Contact</dt>
            <dd>
              {contact ? (
                <Link to={`/contacts/${contact.id}`} className="text-blue-600 hover:underline dark:text-blue-400">
                  {contact.name}
                </Link>
              ) : (
                <span className="text-gray-400">—</span>
              )}
            </dd>
            <dt className="text-gray-500">Applied on</dt>
            <dd>{formatDateOnly(application.applied_at) || <span className="text-gray-400">—</span>}</dd>
            <dt className="text-gray-500">Source</dt>
            <dd>{application.source || <span className="text-gray-400">—</span>}</dd>
            <dt className="text-gray-500">Location</dt>
            <dd>
              {application.location || <span className="text-gray-400">—</span>}
              {application.remote && <span className="text-gray-500"> · {titleCase(application.remote)}</span>}
            </dd>
            <dt className="text-gray-500">Salary range</dt>
            <dd>{application.salary_range || <span className="text-gray-400">—</span>}</dd>
            <dt className="text-gray-500">Job posting</dt>
            <dd>
              {application.jd_url ? (
                <a
                  href={application.jd_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 hover:underline dark:text-blue-400"
                >
                  {application.jd_url}
                </a>
              ) : (
                <span className="text-gray-400">—</span>
              )}
            </dd>
            <dt className="text-gray-500">Notes</dt>
            <dd className="whitespace-pre-wrap">
              {application.notes || <span className="text-gray-400">—</span>}
            </dd>
          </dl>
        </>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold">Timeline ({events.length})</h3>
        <Timeline events={events} applicationId={id} />
      </section>
    </div>
  )
}
