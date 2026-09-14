/**
 * A reusable hybrid text/select field: type to search (debounced, so the
 * underlying query — and its cache — only re-runs a beat after the last
 * keystroke), pick from the dropdown, or clear back to nothing. Backed by
 * whatever `useOptions` hook the caller supplies (see queries.ts's
 * `useCompanyOptions` / `useContactOptions` / `useApplicationOptions`) —
 * those already go through TanStack Query, so repeated searches for the same
 * text are served from cache instead of re-hitting the API.
 *
 * Use this anywhere a picker resolves to an existing company/contact/
 * application. A handful of options from a fixed, small enum (event type,
 * application status, contact kind…) should stay a plain `<SelectField>`.
 */
import { useEffect, useId, useState } from 'react'
import { control } from './ui'
import type { AutocompleteOption } from '../lib/types'

export type { AutocompleteOption }

export interface UseOptionsResult {
  data?: AutocompleteOption[]
  isLoading: boolean
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
  return debounced
}

export function Autocomplete({
  value,
  onChange,
  useOptions,
  placeholder,
  emptyText = 'No matches',
  allowClear = true,
  disabled,
  id,
  invalid,
  seedOptions,
}: {
  value: AutocompleteOption | null
  onChange: (option: AutocompleteOption | null) => void
  /** A query hook (e.g. `useCompanyOptions`) — called every render per rules
   *  of hooks; gate what it fetches internally, not by conditionally calling it. */
  useOptions: (query: string) => UseOptionsResult
  placeholder?: string
  emptyText?: string
  allowClear?: boolean
  disabled?: boolean
  id?: string
  invalid?: boolean
  /** Shown before the reviewer types anything, instead of the unfiltered
   *  `useOptions('')` list — e.g. a small set of already-scored/ranked
   *  candidates a caller computed some other way. Typing still searches live
   *  via `useOptions`. */
  seedOptions?: AutocompleteOption[]
}) {
  const autoId = useId()
  const inputId = id ?? autoId
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  // false right after opening (or on a fresh mount) — true once the reviewer
  // has actually typed something this session. Keyed separately from `query`
  // (rather than `query === ''`) so a debounce tick settling back to '' can't
  // by itself flip the seed list back on mid-edit.
  const [touched, setTouched] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const debounced = useDebouncedValue(query, 200)
  const live = useOptions(open ? debounced : '')
  const useSeed = !touched && seedOptions !== undefined
  const options = useSeed ? seedOptions : live.data
  const isLoading = useSeed ? false : live.isLoading

  // keep the displayed text in sync when the selection changes from outside
  // (a different op resolved, a form reset, etc.) while the field is closed
  useEffect(() => {
    if (!open) setQuery(value?.label ?? '')
  }, [value, open])

  useEffect(() => {
    setHighlight(0)
  }, [options])

  function choose(opt: AutocompleteOption) {
    onChange(opt)
    setQuery(opt.label)
    setOpen(false)
    setTouched(false)
  }

  function clear() {
    onChange(null)
    setQuery('')
    setOpen(false)
    setTouched(false)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // e.keyCode is deprecated but kept as a fallback: some input methods
    // (virtual keyboards, certain automation/assistive tooling) report
    // key === 'Unidentified' for Enter even though keyCode is still 13.
    const isEnter = e.key === 'Enter' || e.keyCode === 13
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setHighlight((h) => Math.min(h + 1, (options?.length ?? 1) - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (isEnter) {
      if (open && options?.[highlight]) {
        e.preventDefault()
        choose(options[highlight])
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
      setQuery(value?.label ?? '')
      setTouched(false)
    }
  }

  const showPanel = open && (isLoading || (options && options.length > 0) || query !== '')

  return (
    <div className="relative">
      <div className="relative">
        <input
          id={inputId}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${inputId}-listbox`}
          aria-autocomplete="list"
          aria-invalid={invalid || undefined}
          className={`${control} ${allowClear && value ? 'pr-7' : ''}`}
          value={open ? query : (value?.label ?? '')}
          placeholder={placeholder}
          disabled={disabled}
          onFocus={() => {
            setOpen(true)
            setQuery('')
            setTouched(false)
          }}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            setTouched(true)
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            setOpen(false)
            setQuery(value?.label ?? '')
            setTouched(false)
          }}
        />
        {allowClear && value && (
          <button
            type="button"
            tabIndex={-1}
            aria-label="Clear"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            onMouseDown={(e) => {
              e.preventDefault()
              clear()
            }}
          >
            ×
          </button>
        )}
      </div>

      {showPanel && (
        <ul
          id={`${inputId}-listbox`}
          role="listbox"
          className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-gray-200 bg-white py-1 text-sm shadow-lg dark:border-gray-700 dark:bg-gray-900"
        >
          {isLoading && !options ? (
            <li className="px-3 py-1.5 text-gray-400">Searching…</li>
          ) : options && options.length > 0 ? (
            options.map((opt, i) => (
              <li
                key={opt.id}
                role="option"
                aria-selected={value?.id === opt.id}
                className={`cursor-pointer px-3 py-1.5 ${
                  i === highlight
                    ? 'bg-gray-100 dark:bg-gray-800'
                    : ''
                }`}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  choose(opt)
                }}
              >
                <div className="text-gray-900 dark:text-gray-100">{opt.label}</div>
                {opt.sublabel && <div className="text-xs text-gray-400">{opt.sublabel}</div>}
              </li>
            ))
          ) : (
            <li className="px-3 py-1.5 text-gray-400">{emptyText}</li>
          )}
        </ul>
      )}
    </div>
  )
}
