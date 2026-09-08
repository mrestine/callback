import { Navigate } from 'react-router-dom'
import { useMe } from '../lib/auth'

export function LoginScreen() {
  const { me, isPending } = useMe()

  if (isPending) return <div className="p-8 text-sm text-gray-500">Loading…</div>
  if (me) return <Navigate to="/" replace />

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">callback</h1>
        <p className="mt-1 text-sm text-gray-500">Job-application tracker</p>
      </div>
      <a
        href="/api/auth/login"
        className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
      >
        Sign in with GitHub
      </a>
    </div>
  )
}
