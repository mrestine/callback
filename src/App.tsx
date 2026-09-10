import { Link, NavLink, Navigate, Outlet } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { api } from './lib/api'
import { useMe } from './lib/auth'

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/applications', label: 'Applications', end: false },
  { to: '/companies', label: 'Companies', end: false },
  { to: '/contacts', label: 'Contacts', end: false },
  { to: '/review', label: 'Review', end: false },
]

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
      <header className="border-b border-gray-200 px-6 dark:border-gray-800">
        <div className="mx-auto flex max-w-5xl items-center justify-between py-3">
          <div className="flex items-center gap-6">
            <span className="font-semibold tracking-tight">callback</span>
            <nav className="flex items-center gap-1 text-sm">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `rounded-md px-2 py-1 ${
                      isActive
                        ? 'bg-gray-100 font-medium text-gray-900 dark:bg-gray-800 dark:text-gray-100'
                        : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Link
              to="/settings"
              className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
            >
              Settings
            </Link>
            {me.avatar_url && <img src={me.avatar_url} alt="" className="h-6 w-6 rounded-full" />}
            <span className="text-gray-600 dark:text-gray-400">{me.name ?? me.login}</span>
            <button
              onClick={signOut}
              className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}
