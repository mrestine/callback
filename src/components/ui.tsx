import { forwardRef, useEffect, useRef, useState } from 'react'
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'

export const control =
  'w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm outline-none ' +
  'focus:border-gray-500 dark:border-gray-700 dark:bg-gray-900'

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string
  error?: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-gray-400">{hint}</span>
      ) : null}
    </label>
  )
}

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextField(props, ref) {
    return <input ref={ref} className={control} {...props} />
  },
)

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TextArea(props, ref) {
    return <textarea ref={ref} rows={3} className={control} {...props} />
  },
)

export const SelectField = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }
>(function SelectField(props, ref) {
  return <select ref={ref} className={control} {...props} />
})

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const styles = {
    primary:
      'bg-gray-900 text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200',
    ghost: 'border border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900',
    danger:
      'border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950',
  }[variant]
  return (
    <button
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${styles} ${className}`}
      {...props}
    />
  )
}

export function Loading() {
  return <div className="p-6 text-sm text-gray-500">Loading…</div>
}

export function ErrorNote({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : 'Something went wrong'
  return (
    <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
      {msg}
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700">
      {children}
    </div>
  )
}

export function PageHeader({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex items-center justify-between gap-4">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {children ? <div className="flex items-center gap-2">{children}</div> : null}
    </div>
  )
}

const neutral = 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
const green = 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'
const amber = 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
const blue = 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
const violet = 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300'
const indigo = 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300'
const red = 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'

/** Tone keys map to warmth levels and application statuses. */
const toneColor: Record<string, string> = {
  // warmth
  cold: neutral,
  warm: amber,
  strong: green,
  // application status
  lead: neutral,
  applied: blue,
  screen: blue,
  technical: indigo,
  onsite: violet,
  offer: green,
  rejected: red,
  withdrawn: neutral,
  ghosted: amber,
}

export function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  const cls = (tone && toneColor[tone]) || neutral
  return <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>{children}</span>
}

/** A clickable `Badge` — full tone color when selected, muted outline otherwise. Used for multi-select filters. */
export function ToggleBadge({
  children,
  tone,
  selected,
  onClick,
}: {
  children: ReactNode
  tone?: string
  selected: boolean
  onClick: () => void
}) {
  const cls = (tone && toneColor[tone]) || neutral
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium transition-colors ${
        selected
          ? cls
          : 'text-gray-400 ring-1 ring-inset ring-gray-300 hover:text-gray-600 dark:text-gray-500 dark:ring-gray-700 dark:hover:text-gray-300'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * A trigger that opens a floating panel — closes on outside click, Escape, or
 * triggering again. Stays open across clicks inside it (for multi-select
 * panels); nothing auto-closes it for you.
 */
export function Popover({
  trigger,
  children,
  align = 'left',
}: {
  trigger: (state: { open: boolean; toggle: () => void }) => ReactNode
  children: ReactNode
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

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
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div
          className={`absolute top-full z-20 mt-1 rounded-md border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-800 dark:bg-gray-900 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {children}
        </div>
      )}
    </div>
  )
}
