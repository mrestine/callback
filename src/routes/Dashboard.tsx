import { Link } from 'react-router-dom'
import { useDashboard } from '../lib/queries'
import type { ActivityItem, UpcomingEvent } from '../lib/types'
import { Badge, EmptyState, ErrorNote, Loading } from '../components/ui'
import { eventLabel } from '../components/Timeline'
import { daysSince, formatDate, relativeDate, titleCase } from '../lib/format'

export function Dashboard() {
  const { data, isPending, isError, error } = useDashboard()

  if (isPending) return <Loading />
  if (isError) return <ErrorNote error={error} />

  const { activeApplications, activeCompanies, staleThresholdDays, stale, upcoming, recent } = data

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-lg font-semibold tracking-tight">Dashboard</h2>
        <p className="mt-2 text-sm">
          {activeApplications === 0 ? (
            <span className="text-gray-500">
              No active applications yet. <Link to="/applications" className="text-blue-600 hover:underline dark:text-blue-400">Add one →</Link>
            </span>
          ) : (
            <>
              <strong>{activeApplications}</strong> active application{activeApplications === 1 ? '' : 's'} at{' '}
              <strong>{activeCompanies}</strong> compan{activeCompanies === 1 ? 'y' : 'ies'}
              {stale.length > 0 && (
                <>
                  {' · '}
                  <strong>{stale.length}</strong> stale (no activity in {staleThresholdDays}+ days)
                </>
              )}
            </>
          )}
        </p>

        {stale.length > 0 && (
          <ul className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-200 text-sm dark:divide-gray-900 dark:border-gray-800">
            {stale.map((a) => (
              <li key={a.id} className="flex items-center justify-between px-3 py-2">
                <Link to={`/applications/${a.id}`} className="text-blue-600 hover:underline dark:text-blue-400">
                  {a.role_title} <span className="text-gray-500">· {a.company_name}</span>
                </Link>
                <span className="flex items-center gap-3 text-gray-500">
                  <Badge tone={a.status}>{titleCase(a.status)}</Badge>
                  <span>{daysSince(a.last_activity_at)}d quiet</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Upcoming</h3>
        {upcoming.length === 0 ? (
          <EmptyState>Nothing scheduled. Add a future-dated event to an application or contact.</EmptyState>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 text-sm dark:divide-gray-900 dark:border-gray-800">
            {upcoming.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="flex items-center gap-2">
                  <span className="tabular-nums text-gray-500">{formatDate(e.occurred_at)}</span>
                  <span>{eventLabel(e.type, e.subtype)}</span>
                  {e.body && <span className="text-gray-500">— {e.body}</span>}
                </span>
                <UpcomingLink e={e} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Recent activity</h3>
        {recent.length === 0 ? (
          <EmptyState>Nothing yet.</EmptyState>
        ) : (
          <ul className="space-y-1 text-sm">
            {recent.map((item) => (
              <li key={`${item.kind}-${item.id}`} className="flex items-baseline justify-between gap-3">
                <span>
                  <ActivityLabel item={item} />
                </span>
                <span className="whitespace-nowrap text-xs text-gray-400">{relativeDate(item.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function UpcomingLink({ e }: { e: UpcomingEvent }) {
  if (e.application_id) {
    return (
      <Link to={`/applications/${e.application_id}`} className="whitespace-nowrap text-blue-600 hover:underline dark:text-blue-400">
        {e.role_title} {e.company_name && <span className="text-gray-500">· {e.company_name}</span>}
      </Link>
    )
  }
  if (e.contact_id) {
    return (
      <Link to={`/contacts/${e.contact_id}`} className="whitespace-nowrap text-blue-600 hover:underline dark:text-blue-400">
        {e.contact_name}
      </Link>
    )
  }
  return null
}

function ActivityLabel({ item }: { item: ActivityItem }) {
  const cls = 'text-blue-600 hover:underline dark:text-blue-400'
  switch (item.kind) {
    case 'company':
      return (
        <>
          Added company <Link to={`/companies/${item.id}`} className={cls}>{item.label}</Link>
        </>
      )
    case 'contact':
      return (
        <>
          Added contact <Link to={`/contacts/${item.id}`} className={cls}>{item.label}</Link>
        </>
      )
    case 'application':
      return (
        <>
          Created application <Link to={`/applications/${item.id}`} className={cls}>{item.label}</Link>
          {item.sub && <span className="text-gray-500"> · {item.sub}</span>}
        </>
      )
    case 'event': {
      const to = item.application_id
        ? `/applications/${item.application_id}`
        : item.contact_id
          ? `/contacts/${item.contact_id}`
          : null
      return (
        <>
          {eventLabel(item.label, item.subtype)}
          {item.sub && (
            <>
              {' on '}
              {to ? <Link to={to} className={cls}>{item.sub}</Link> : item.sub}
            </>
          )}
        </>
      )
    }
  }
}
