import { Navigate, Outlet } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { api } from './lib/api'
import { useMe } from './lib/auth'

/** Gates the authenticated area and renders the app chrome. */
export function RootLayout() {
  const { me, isPending } = useMe()
  const queryClient = useQueryClient()

  if (isPending) {
    return <div className="p-8 text-sm text-gray-500">Loading…</div>
  }
  if (!me) {
    return <Navigate to="/login" replace />
  }

  async function signOut() {
    await api.post('/api/auth/logout')
    queryClient.clear()
    window.location.assign('/login')
  }

  return (
    <div className="min-h-screen bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <header className="flex items-center justify-between border-b border-gray-200 px-6 py-3 dark:border-gray-800">
        <span className="font-semibold tracking-tight">callback</span>
        <div className="flex items-center gap-3 text-sm">
          {me.avatar_url && (
            <img src={me.avatar_url} alt="" className="h-6 w-6 rounded-full" />
          )}
          <span className="text-gray-600 dark:text-gray-400">{me.name ?? me.login}</span>
          <button
            onClick={signOut}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900"
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}
