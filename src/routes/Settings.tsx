import { useState } from 'react'
import { Button, EmptyState, ErrorNote, Field, Loading, PageHeader, TextField } from '../components/ui'
import { formatDate } from '../lib/format'
import { useCreateToken, useDeleteToken, useTokens } from '../lib/queries'

export function Settings() {
  const tokens = useTokens()
  const create = useCreateToken()
  const del = useDeleteToken()
  const [name, setName] = useState('')
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null)

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    const t = await create.mutateAsync(name.trim())
    setFresh({ name: t.name, token: t.token })
    setName('')
  }

  return (
    <div>
      <PageHeader title="Settings" />

      <section className="mb-8">
        <h3 className="mb-1 text-sm font-semibold">Worker API tokens</h3>
        <p className="mb-3 text-xs text-gray-500">
          The ingestion worker authenticates with one of these. Paste it into the worker's{' '}
          <code>CALLBACK_TOKEN</code> env. The full value is shown only once, here.
        </p>

        <form onSubmit={onCreate} className="mb-4 flex items-end gap-2">
          <div className="w-64">
            <Field label="New token name">
              <TextField
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. desktop-worker"
              />
            </Field>
          </div>
          <Button type="submit" disabled={create.isPending || !name.trim()}>
            Create
          </Button>
        </form>

        {fresh && (
          <div className="mb-4 rounded-md border border-green-300 bg-green-50 p-3 text-sm dark:border-green-800 dark:bg-green-950">
            <div className="mb-1 font-medium text-green-800 dark:text-green-300">
              Token “{fresh.name}” created — copy it now, it won't be shown again:
            </div>
            <code className="block break-all rounded bg-white px-2 py-1 text-xs dark:bg-gray-900">
              {fresh.token}
            </code>
          </div>
        )}

        {create.isError && <ErrorNote error={create.error} />}

        {tokens.isPending ? (
          <Loading />
        ) : tokens.isError ? (
          <ErrorNote error={tokens.error} />
        ) : tokens.data.length === 0 ? (
          <EmptyState>No tokens yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-gray-900">
                <tr>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                  <th className="px-3 py-2 font-medium">Last used</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {tokens.data.map((t) => (
                  <tr key={t.id} className="border-b border-gray-100 last:border-0 dark:border-gray-900">
                    <td className="px-3 py-2 font-medium">{t.name}</td>
                    <td className="px-3 py-2 text-gray-500">{formatDate(t.created_at)}</td>
                    <td className="px-3 py-2 text-gray-500">
                      {t.last_used_at ? formatDate(t.last_used_at) : <span className="text-gray-400">never</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => {
                          if (window.confirm(`Revoke “${t.name}”? The worker using it will stop working.`)) {
                            del.mutate(t.id)
                          }
                        }}
                        className="text-xs text-red-600 hover:underline dark:text-red-400"
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
