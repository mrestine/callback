import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { api } from './lib/api'
import { useMe } from './lib/auth'
import { useReviewQueue } from './lib/queries'
import type { Me } from './lib/auth'

const NAV = [
  { to: '/applications', label: 'Applications' },
  { to: '/companies', label: 'Companies' },
  { to: '/contacts', label: 'Contacts' },
  { to: '/review', label: 'Review' },
]

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-5 w-5">
      {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 6h16M4 12h16M4 18h16" />}
    </svg>
  )
}

function ChevronDownIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return `flex items-center rounded-md px-2 py-1.5 sm:py-1 ${
    isActive
      ? 'bg-gray-100 font-medium text-gray-900 dark:bg-gray-800 dark:text-gray-100'
      : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
  }`
}

function ReviewBadge({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-semibold leading-none text-white dark:bg-blue-500">
      {count > 99 ? '99+' : count}
    </span>
  )
}

function NavLinks({ reviewCount, onNavigate }: { reviewCount: number; onNavigate?: () => void }) {
  return (
    <>
      {NAV.map((item) => (
        <NavLink key={item.to} to={item.to} onClick={onNavigate} className={navLinkClass}>
          {item.label}
          {item.to === '/review' && <ReviewBadge count={reviewCount} />}
        </NavLink>
      ))}
    </>
  )
}

function ProfileMenu({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const location = useLocation()

  useEffect(() => setOpen(false), [location.pathname])

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-md py-1 pl-1 pr-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-900"
      >
        {me.avatar_url && <img src={me.avatar_url} alt="" className="h-6 w-6 rounded-full" />}
        <span className="hidden text-gray-600 sm:inline dark:text-gray-400">{me.name ?? me.login}</span>
        <ChevronDownIcon
          className={`h-3.5 w-3.5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-md border border-gray-200 bg-white py-1 text-sm shadow-lg dark:border-gray-800 dark:bg-gray-900"
        >
          <div className="border-b border-gray-100 px-3 py-2 text-xs text-gray-500 sm:hidden dark:border-gray-800">
            {me.name ?? me.login}
          </div>
          <Link
            role="menuitem"
            to="/settings"
            className="block px-3 py-1.5 text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Settings
          </Link>
          <button
            role="menuitem"
            onClick={onSignOut}
            className="block w-full px-3 py-1.5 text-left text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

/** Gates the authenticated area and renders the app chrome. */
export function RootLayout() {
  const { me, isPending } = useMe()
  const queryClient = useQueryClient()
  const location = useLocation()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  // shared with the app: also drives the Review nav badge
  const reviewCount = useReviewQueue(!!me).data?.length ?? 0

  useEffect(() => setMobileNavOpen(false), [location.pathname])

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
      <header className="border-b border-gray-200 px-4 dark:border-gray-800 sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between py-3">
          <div className="flex items-center gap-1 sm:gap-6">
            <Link to="/" className="font-semibold tracking-tight">
              callback
            </Link>
            <button
              onClick={() => setMobileNavOpen((v) => !v)}
              aria-label="Toggle navigation"
              aria-expanded={mobileNavOpen}
              className="rounded-md p-1.5 text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-900 sm:hidden"
            >
              <MenuIcon open={mobileNavOpen} />
            </button>
            <nav className="hidden items-center gap-1 text-sm sm:flex">
              <NavLinks reviewCount={reviewCount} />
            </nav>
          </div>
          <ProfileMenu me={me} onSignOut={signOut} />
        </div>
        {mobileNavOpen && (
          <nav className="mx-auto flex max-w-5xl flex-col gap-0.5 pb-3 text-sm sm:hidden">
            <NavLinks reviewCount={reviewCount} onNavigate={() => setMobileNavOpen(false)} />
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  )
}
