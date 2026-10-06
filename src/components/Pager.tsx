import { useSearchParams } from 'react-router-dom'
import type { Page } from '../lib/types'

/** The list page's number, kept in the URL (`?page=2`) so refresh and back work. */
export function usePageParam(): [number, (page: number) => void] {
  const [params, setParams] = useSearchParams()
  const n = Number(params.get('page'))
  const page = Number.isInteger(n) && n > 0 ? n : 1
  function setPage(next: number) {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        if (next <= 1) p.delete('page')
        else p.set('page', String(next))
        return p
      },
      { replace: true },
    )
  }
  return [page, setPage]
}

/** "21-40 of 47" with previous / next, for a paginated list. Hidden when everything fits on one page. */
export function Pager({ data, onPage }: { data: Page<unknown>; onPage: (page: number) => void }) {
  const lastPage = Math.max(1, Math.ceil(data.total / data.pageSize))
  if (lastPage === 1) return null
  const from = (data.page - 1) * data.pageSize + 1
  const to = Math.min(data.page * data.pageSize, data.total)
  const btn =
    'rounded-md border border-gray-300 px-3 py-1 text-sm disabled:opacity-40 dark:border-gray-700 enabled:hover:bg-gray-50 dark:enabled:hover:bg-gray-800'
  return (
    <div className="mt-3 flex items-center justify-between text-sm text-gray-500">
      <span className="tabular-nums">
        {from}-{to} of {data.total}
      </span>
      <div className="flex gap-2">
        <button type="button" className={btn} disabled={data.page <= 1} onClick={() => onPage(data.page - 1)}>
          Previous
        </button>
        <button type="button" className={btn} disabled={data.page >= lastPage} onClick={() => onPage(data.page + 1)}>
          Next
        </button>
      </div>
    </div>
  )
}
