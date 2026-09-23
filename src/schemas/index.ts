import { z } from 'zod'

/**
 * Shared validation schemas — imported by the React forms (via zodResolver) and
 * by the /api handlers to validate request bodies. No React / Node imports here.
 *
 * Optional fields use `z.preprocess` to fold empty strings / null (what HTML
 * form controls and omitted JSON keys produce) down to `undefined` before the
 * inner check runs. Output types are therefore clean (`string`, `number`,
 * `Date`); the trade-off is that `z.input` of a preprocessed field is `unknown`.
 */

const trimmed = z.string().trim()
const emptyToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v)

/**
 * Single-operator app, so a fixed timezone stands in for "the operator's
 * local time" wherever server-side code (no browser, no per-request
 * timezone) needs one. Used only as a last resort — see dateOnlyToInstant.
 */
export const OPERATOR_TZ = 'America/New_York'

function tzOffsetHours(date: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
  const part = fmt.formatToParts(date).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+0'
  const m = part.match(/GMT([+-]\d+(?:\.\d+)?)/)
  return m ? Number(m[1]) : 0
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * "yyyy-mm-dd" -> ISO instant at OPERATOR_TZ local midnight of that date
 * (DST-aware). A bare date has no time-of-day; parsing it with `new Date()`
 * (or z.coerce.date()) gives UTC midnight, which then renders as the
 * PREVIOUS calendar day for any timezone behind UTC — never do that. The
 * browser client independently sends local midnight in the viewer's OWN
 * timezone when it has one (see dateInputToInstant in src/lib/format.ts,
 * more accurate since it's the real viewer, not a hardcoded stand-in); this
 * is the systemic backstop for anything that reaches a date field as a bare
 * date without going through that — the AI extraction pipeline, a future
 * API caller, etc.
 */
export function dateOnlyToInstant(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const utcMidnight = Date.UTC(y, m - 1, d)
  const offset = tzOffsetHours(new Date(utcMidnight), OPERATOR_TZ)
  return new Date(utcMidnight - offset * 3_600_000).toISOString()
}

/** The inverse direction: a real instant -> OPERATOR_TZ's calendar date, as
 *  "yyyy-mm-dd". For deriving a date-only value (e.g. applied_at) from a
 *  genuine timestamp server-side — never `.toISOString().slice(0, 10)`,
 *  which takes UTC's calendar date and is off by one for part of the day. */
export function instantToLocalDateOnly(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: OPERATOR_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Folds empty strings/null to undefined, AND promotes a bare "yyyy-mm-dd"
 *  string to an OPERATOR_TZ-local-midnight instant before z.coerce.date()
 *  ever sees it — so no caller of a date field can accidentally end up at
 *  UTC midnight just by sending a plain date. */
const dateOnlySafe = (v: unknown) => {
  const folded = emptyToUndefined(v)
  return typeof folded === 'string' && DATE_ONLY.test(folded) ? dateOnlyToInstant(folded) : folded
}

const optionalText = z.preprocess(emptyToUndefined, trimmed.max(10_000).optional())
const optionalUrl = z.preprocess(emptyToUndefined, trimmed.max(2048).url().optional())
const optionalEmail = z.preprocess(emptyToUndefined, trimmed.max(320).email().optional())
const optionalId = z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional())
const optionalDate = z.preprocess(dateOnlySafe, z.coerce.date().optional())

// --- enums ---------------------------------------------------------------
export const CONTACT_KINDS = ['friend', 'recruiter', 'hiring_mgr', 'referral', 'other'] as const
export const WARMTH_LEVELS = ['cold', 'warm', 'strong'] as const
export const APPLICATION_STATUSES = [
  'lead',
  'applied',
  'screen',
  'technical',
  'onsite',
  'offer',
  'rejected',
  'withdrawn',
  'ghosted',
] as const
export const REMOTE_MODES = ['remote', 'hybrid', 'onsite'] as const
export const EVENT_TYPES = [
  'note',
  'email',
  'call',
  'interview',
  'status_change',
  'applied',
  'follow_up',
] as const

/** Types a user can log by hand. `status_change` is written by the system only. */
export const MANUAL_EVENT_TYPES = ['note', 'email', 'call', 'interview', 'applied', 'follow_up'] as const

export const EVENT_STATUSES = ['scheduled', 'logged'] as const

/** Free-form `subtype` suggestions surfaced as a datalist in the composer. */
export const EVENT_SUBTYPE_SUGGESTIONS = [
  'Intro',
  'Recruiter screen',
  'Technical',
  'System design',
  'Coding',
  'Behavioral',
  'Hiring manager',
  'Team match',
  'Panel / onsite',
  'Final / leadership',
  'Offer',
] as const

export const contactKind = z.enum(CONTACT_KINDS)
export const warmth = z.enum(WARMTH_LEVELS)
export const applicationStatus = z.enum(APPLICATION_STATUSES)
export const remoteMode = z.enum(REMOTE_MODES)
export const eventType = z.enum(EVENT_TYPES)
export const manualEventType = z.enum(MANUAL_EVENT_TYPES)
export const eventStatus = z.enum(EVENT_STATUSES)

// --- companies ---------------------------------------------------------
export const companyCreate = z.object({
  name: trimmed.min(1).max(200),
  careers_url: optionalUrl,
  notes: optionalText,
})
export const companyUpdate = companyCreate.partial()

// --- contacts --------------------------------------------------------
export const contactCreate = z.object({
  name: trimmed.min(1).max(200),
  company_id: optionalId,
  role: optionalText,
  kind: contactKind.default('other'),
  email: optionalEmail,
  linkedin_url: optionalUrl,
  warmth: warmth.default('cold'),
  notes: optionalText,
  last_contact_at: optionalDate,
})
export const contactUpdate = contactCreate.partial()

// --- applications ---------------------------------------------------
export const applicationCreate = z.object({
  company_id: z.coerce.number().int().positive(),
  contact_id: optionalId,
  role_title: trimmed.min(1).max(300),
  jd_url: optionalUrl,
  source: optionalText,
  status: applicationStatus.default('lead'),
  location: optionalText,
  remote: z.preprocess(emptyToUndefined, remoteMode.optional()),
  salary_range: optionalText,
  applied_at: optionalDate,
  notes: optionalText,
})
export const applicationUpdate = applicationCreate.partial()

// --- events --------------------------------------------------------
export const eventCreate = z
  .object({
    application_id: optionalId,
    contact_id: optionalId,
    type: manualEventType.default('note'),
    subtype: z.preprocess(emptyToUndefined, trimmed.max(80).optional()),
    body: optionalText,
    // future dates schedule the event; the API derives `status` from this.
    occurred_at: optionalDate,
  })
  .refine((v) => v.application_id != null || v.contact_id != null, {
    message: 'An event must reference an application or a contact',
  })

export const eventUpdate = z.object({
  type: manualEventType.optional(),
  subtype: z.preprocess(emptyToUndefined, trimmed.max(80).optional()),
  body: optionalText,
  occurred_at: optionalDate,
  status: eventStatus.optional(),
})

export type CompanyCreate = z.infer<typeof companyCreate>
export type ContactCreate = z.infer<typeof contactCreate>
export type ApplicationCreate = z.infer<typeof applicationCreate>
export type EventCreate = z.infer<typeof eventCreate>

// --- AI inbound ingestion --------------------------------------------
export * from './inbound.js'
