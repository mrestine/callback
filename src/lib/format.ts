/** ISO timestamp/date -> "Mar 4, 2026", or "" for null/invalid. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** ISO timestamp/date -> "9/16" (no year), or "" for null/invalid. */
export function formatShortDate(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })
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

/** 14 -> "2 weeks"; 10 -> "10 days"; 7 -> "1 week". */
export function formatDuration(days: number): string {
  if (days % 7 === 0) {
    const weeks = days / 7
    return `${weeks} week${weeks === 1 ? '' : 's'}`
  }
  return `${days} day${days === 1 ? '' : 's'}`
}

/** ["A"] -> "A"; ["A","B"] -> "A and B"; ["A","B","C"] -> "A, B, and C". */
export function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
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
