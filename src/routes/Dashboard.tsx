import { Link } from 'react-router-dom'
import { useApplications, useCompanies, useContacts } from '../lib/queries'
import { Badge } from '../components/ui'
import { titleCase } from '../lib/format'
import { APPLICATION_STATUSES } from '../schemas'

const ACTIVE_STATUSES = ['lead', 'applied', 'screen', 'onsite'] as const

/**
 * Interim dashboard. The real one (needs-follow-up list, activity feed) is
 * build step 7.
 */
export function Dashboard() {
  const applications = useApplications({})
  const companies = useCompanies()
  const contacts = useContacts({})

  const apps = applications.data ?? []
  const activeCount = apps.filter((a) => (ACTIVE_STATUSES as readonly string[]).includes(a.status)).length
  const byStatus = APPLICATION_STATUSES.map((s) => ({
    status: s,
    count: apps.filter((a) => a.status === s).length,
  })).filter((x) => x.count > 0)

  return (
    <div>
      <h2 className="text-lg font-semibold tracking-tight">Dashboard</h2>
      <p className="mt-2 text-sm text-gray-500">Needs-follow-up and an activity feed come in step 7.</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Card to="/applications" value={apps.length} label="Applications" sub={`${activeCount} active`} />
        <Card to="/companies" value={companies.data?.length} label="Companies" />
        <Card to="/contacts" value={contacts.data?.length} label="Contacts" />
      </div>

      {byStatus.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-semibold">By status</h3>
          <div className="flex flex-wrap gap-2">
            {byStatus.map(({ status, count }) => (
              <Link key={status} to={`/applications?status=${status}`} className="hover:opacity-80">
                <Badge tone={status}>
                  {titleCase(status)} · {count}
                </Badge>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Card({
  to,
  value,
  label,
  sub,
}: {
  to: string
  value: number | undefined
  label: string
  sub?: string
}) {
  return (
    <Link
      to={to}
      className="rounded-lg border border-gray-200 p-4 hover:border-gray-300 dark:border-gray-800 dark:hover:border-gray-700"
    >
      <div className="text-2xl font-semibold tabular-nums">{value ?? '—'}</div>
      <div className="text-sm text-gray-500">{label}</div>
      {sub && <div className="mt-0.5 text-xs text-gray-400">{sub}</div>}
    </Link>
  )
}
