import type { EventRow } from '../lib/types'
import { formatDate, titleCase } from '../lib/format'
import { Badge, EmptyState } from './ui'

/**
 * Read-only activity feed. Adding events (step 6) will slot a compose box above
 * this list.
 */
export function Timeline({ events }: { events: EventRow[] }) {
  if (events.length === 0) {
    return <EmptyState>No activity yet.</EmptyState>
  }

  return (
    <ul className="space-y-2 text-sm">
      {events.map((e) => (
        <li key={e.id} className="rounded-md border border-gray-200 px-3 py-2 dark:border-gray-800">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span className="flex items-center gap-1.5">
              {titleCase(e.type)}
              {e.source === 'ai' && <Badge>AI</Badge>}
            </span>
            <span>{formatDate(e.occurred_at)}</span>
          </div>
          {e.type === 'status_change' && e.old_status && e.new_status && (
            <p className="mt-1">
              {titleCase(e.old_status)} <span className="text-gray-400">→</span>{' '}
              {titleCase(e.new_status)}
            </p>
          )}
          {e.body && <p className="mt-1 whitespace-pre-wrap">{e.body}</p>}
        </li>
      ))}
    </ul>
  )
}
