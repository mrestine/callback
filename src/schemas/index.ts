import { z } from 'zod'

/**
 * Shared validation schemas — imported by the React forms (via zodResolver) and
 * by the /api handlers to validate request bodies. Keep this file free of any
 * React or Node imports so both sides can use it.
 */

const trimmed = z.string().trim()
const optionalText = trimmed.max(10_000).optional().or(z.literal('').transform(() => undefined))
const optionalUrl = trimmed
  .max(2048)
  .url()
  .optional()
  .or(z.literal('').transform(() => undefined))

// --- enums ---------------------------------------------------------------
export const CONTACT_KINDS = ['friend', 'recruiter', 'hiring_mgr', 'referral', 'other'] as const
export const WARMTH_LEVELS = ['cold', 'warm', 'strong'] as const
export const APPLICATION_STATUSES = [
  'lead',
  'applied',
  'screen',
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
  'meeting',
  'status_change',
  'applied',
  'follow_up',
] as const

export const contactKind = z.enum(CONTACT_KINDS)
export const warmth = z.enum(WARMTH_LEVELS)
export const applicationStatus = z.enum(APPLICATION_STATUSES)
export const remoteMode = z.enum(REMOTE_MODES)
export const eventType = z.enum(EVENT_TYPES)

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
  company_id: z.coerce.number().int().positive().optional(),
  role: optionalText,
  kind: contactKind.default('other'),
  email: trimmed.max(320).email().optional().or(z.literal('').transform(() => undefined)),
  linkedin_url: optionalUrl,
  warmth: warmth.default('cold'),
  notes: optionalText,
  last_contact_at: z.coerce.date().optional(),
})
export const contactUpdate = contactCreate.partial()

// --- applications ---------------------------------------------------
export const applicationCreate = z.object({
  company_id: z.coerce.number().int().positive(),
  contact_id: z.coerce.number().int().positive().optional(),
  role_title: trimmed.min(1).max(300),
  jd_url: optionalUrl,
  source: optionalText,
  status: applicationStatus.default('lead'),
  location: optionalText,
  remote: remoteMode.optional(),
  salary_range: optionalText,
  applied_at: z.coerce.date().optional(),
  notes: optionalText,
})
export const applicationUpdate = applicationCreate.partial()

// --- events --------------------------------------------------------
export const eventCreate = z
  .object({
    application_id: z.coerce.number().int().positive().optional(),
    contact_id: z.coerce.number().int().positive().optional(),
    type: eventType.default('note'),
    body: optionalText,
    occurred_at: z.coerce.date().optional(),
  })
  .refine((v) => v.application_id != null || v.contact_id != null, {
    message: 'An event must reference an application or a contact',
  })

export type CompanyCreate = z.infer<typeof companyCreate>
export type ContactCreate = z.infer<typeof contactCreate>
export type ApplicationCreate = z.infer<typeof applicationCreate>
export type EventCreate = z.infer<typeof eventCreate>
