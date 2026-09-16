import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useDashboard } from '../lib/queries'
import type { ActivityItem, DashboardData, UpcomingEvent } from '../lib/types'
import { Badge, EmptyState, ErrorNote, Loading } from '../components/ui'
import { eventLabel } from '../components/Timeline'
import { daysSince, formatDate, formatDuration, formatShortDate, joinList, relativeDate, titleCase } from '../lib/format'

export function Dashboard() {
  const { data, isPending, isError, error } = useDashboard()

  if (isPending) return <Loading />
  if (isError) return <ErrorNote error={error} />

  const { stale, upcoming, recent } = data

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-lg font-semibold tracking-tight">Dashboard</h2>
        <p className="mt-2 text-base">
          <ActiveSummary data={data} />
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
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
                <span className="tabular-nums text-gray-500" title={formatDate(e.occurred_at)}>
                  {formatShortDate(e.occurred_at)}
                </span>
                <span className="whitespace-nowrap text-gray-600 dark:text-gray-400">
                  {e.company_name || <span className="text-gray-400">—</span>}
                </span>
                <UpcomingLink e={e} />
                <span className="text-gray-500">
                  {eventLabel(e.type, e.subtype)}
                  {e.body && <> — {e.body}</>}
                </span>
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

/**
 * The headline sentence(s). Each clause is built only when its count is > 0,
 * so any combination (in-process only, waiting only, neither, both) still
 * reads as a complete sentence.
 */
function ActiveSummary({ data }: { data: DashboardData }) {
  const { activeApplications, inProcessCount, inProcessCompanies, appliedCount, leadCount, stale, staleThresholdDays } = data

  if (activeApplications === 0) {
    return (
      <span className="text-gray-500">
        No active applications yet.{' '}
        <Link to="/applications" className="text-blue-600 hover:underline dark:text-blue-400">
          Add one →
        </Link>
      </span>
    )
  }

  const waitingClauses: ReactNode[] = []
  if (appliedCount > 0) {
    waitingClauses.push(
      <>
        <strong>{appliedCount}</strong> confirmed application{appliedCount === 1 ? '' : 's'} in waiting
      </>,
    )
  }
  if (leadCount > 0) {
    waitingClauses.push(
      <>
        <strong>{leadCount}</strong> more on deck
      </>,
    )
  }

  const sentences: ReactNode[] = []
  if (inProcessCount > 0) {
    sentences.push(
      <>
        You&rsquo;ve got <strong>{inProcessCount}</strong> applications in process at {joinList(inProcessCompanies)}.
      </>,
    )
  }
  if (waitingClauses.length > 0) {
    sentences.push(
      <>
        You&rsquo;ve got{' '}
        {waitingClauses.length === 2 ? (
          <>
            {waitingClauses[0]}, and {waitingClauses[1]}
          </>
        ) : (
          waitingClauses[0]
        )}
        .
      </>,
    )
  }
  if (stale.length > 0) {
    sentences.push(
      <span className="text-gray-500">
        <strong>{stale.length}</strong> application{stale.length === 1 ? '' : 's'}{' '}
        {stale.length === 1 ? "hasn't" : "haven't"} seen updates in {formatDuration(staleThresholdDays)}.
      </span>,
    )
  }

  return (
    <>
      {sentences.map((s, i) => (
        <span key={i}>
          {i > 0 && ' '}
          {s}
        </span>
      ))}
    </>
  )
}

function UpcomingLink({ e }: { e: UpcomingEvent }) {
  if (e.application_id) {
    return (
      <Link to={`/applications/${e.application_id}`} className="whitespace-nowrap text-blue-600 hover:underline dark:text-blue-400">
        {e.role_title}
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
