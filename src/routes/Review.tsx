import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, EmptyState, ErrorNote, Loading, PageHeader } from '../components/ui'
import { formatDate, relativeDate, titleCase } from '../lib/format'
import { useInboundHistory, useReviewQueue } from '../lib/queries'
import type { InboundRow } from '../lib/types'

const statusTone: Record<string, string> = {
  needs_review: 'warm',
  applied: 'offer',
  auto_applied: 'offer',
  dismissed: 'withdrawn',
  duplicate: 'withdrawn',
  error: 'rejected',
  pending: 'lead',
}

export function Review() {
  const [tab, setTab] = useState<'queue' | 'history'>('queue')
  const queue = useReviewQueue()
  const history = useInboundHistory()
  const active = tab === 'queue' ? queue : history
  const rows = active.data ?? []

  return (
    <div>
      <PageHeader
        title={
          <>
            Review{' '}
            {queue.data && <span className="font-normal text-gray-400">· {queue.data.length} pending</span>}
          </>
        }
      >
        <div className="flex gap-1 text-sm">
          {(['queue', 'history'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-2 py-1 ${
                tab === t
                  ? 'bg-gray-100 font-medium dark:bg-gray-800'
                  : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-100'
              }`}
            >
              {t === 'queue' ? 'Queue' : 'History'}
            </button>
          ))}
        </div>
      </PageHeader>

      {active.isPending ? (
        <Loading />
      ) : active.isError ? (
        <ErrorNote error={active.error} />
      ) : rows.length === 0 ? (
        <EmptyState>
          {tab === 'queue'
            ? 'Nothing waiting. The worker submits items here as job emails come in.'
            : 'No ingested items yet.'}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-gray-900">
              <tr>
                <th className="px-3 py-2 font-medium">Kind</th>
                <th className="px-3 py-2 font-medium">Summary</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: InboundRow) => (
                <tr key={r.id} className="border-b border-gray-100 last:border-0 dark:border-gray-900">
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-gray-400">
                    {r.email_kind ? titleCase(r.email_kind) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      to={`/review/${r.id}`}
                      className="text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {r.summary || <span className="text-gray-400">(no summary)</span>}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={statusTone[r.status]}>{titleCase(r.status)}</Badge>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500" title={formatDate(r.created_at)}>
                    {relativeDate(r.occurred_at ?? r.created_at)}
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
