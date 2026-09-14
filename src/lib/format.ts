/** ISO timestamp/date -> "Mar 4, 2026", or "" for null/invalid. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** A Date -> "yyyy-mm-dd" for <input type="date"> default values. */
export function toDateInput(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

/** An application is always "Company — Role", never the role alone. */
export function applicationLabel(roleTitle: string, companyName: string | null | undefined): string {
  return companyName ? `${companyName} — ${roleTitle}` : roleTitle
}

export function titleCase(s: string): string {
  return s.replace(/(^|[\s_-])(\w)/g, (_, sep, ch) => (sep === '_' || sep === '-' ? ' ' : sep) + ch.toUpperCase())
}

/** "3d ago" / "in 5d" / "just now"; falls back to formatDate() past ~30 days. */
export function relativeDate(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const diffMs = d.getTime() - Date.now()
  const past = diffMs <= 0
  const abs = Math.abs(diffMs)
  const min = 60_000
  const hour = 60 * min
  const day = 24 * hour
  if (abs < min) return 'just now'
  if (abs < hour) return fmt(Math.round(abs / min), 'm', past)
  if (abs < day) return fmt(Math.round(abs / hour), 'h', past)
  const days = Math.round(abs / day)
  if (days < 30) return fmt(days, 'd', past)
  return formatDate(value)
}

function fmt(n: number, unit: string, past: boolean): string {
  return past ? `${n}${unit} ago` : `in ${n}${unit}`
}

/** Whole days between `value` and now (past = positive). */
export function daysSince(value: string | null | undefined): number {
  if (!value) return 0
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return 0
  return Math.floor((Date.now() - d.getTime()) / 86_400_000)
}
