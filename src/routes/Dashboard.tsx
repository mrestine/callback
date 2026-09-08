import { Link } from 'react-router-dom'
import { useCompanies, useContacts } from '../lib/queries'

/**
 * Placeholder dashboard. Real content (status counts, needs-follow-up,
 * activity feed) lands in build step 7.
 */
export function Dashboard() {
  const companies = useCompanies()
  const contacts = useContacts({})

  return (
    <div>
      <h2 className="text-lg font-semibold tracking-tight">Dashboard</h2>
      <p className="mt-2 text-sm text-gray-500">
        Applications, the timeline, and the real dashboard come next.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Link
          to="/companies"
          className="rounded-lg border border-gray-200 p-4 hover:border-gray-300 dark:border-gray-800 dark:hover:border-gray-700"
        >
          <div className="text-2xl font-semibold tabular-nums">{companies.data?.length ?? '—'}</div>
          <div className="text-sm text-gray-500">Companies</div>
        </Link>
        <Link
          to="/contacts"
          className="rounded-lg border border-gray-200 p-4 hover:border-gray-300 dark:border-gray-800 dark:hover:border-gray-700"
        >
          <div className="text-2xl font-semibold tabular-nums">{contacts.data?.length ?? '—'}</div>
          <div className="text-sm text-gray-500">Contacts</div>
        </Link>
      </div>
    </div>
  )
}
