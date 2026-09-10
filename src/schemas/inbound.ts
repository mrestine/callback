import { z } from 'zod'
import { APPLICATION_STATUSES, CONTACT_KINDS } from './index.js'

/**
 * Phase 2 — the /api/inbound contract. Shared by the API handlers and the
 * review UI. No React / Node imports (see index.ts).
 *
 * `callback` is source-agnostic: this is "a suggested change from the ingestion
 * worker", never "an email". The worker owns the extraction shape; callback
 * validates it leniently (the worker already grammar-constrains its model) and
 * treats unknown fields as harmless.
 */

// --- the model extraction (mirror of callback-worker/src/schemas.ts) -------
export const EMAIL_KINDS = [
  'rejection',
  'interview_invite',
  'interview_scheduled',
  'recruiter_outreach',
  'offer',
  'assessment_invite',
  'application_confirmation',
  'info_request',
  'status_update',
  'referral',
  'networking',
  'noise',
] as const
export type EmailKind = (typeof EMAIL_KINDS)[number]

const nullableStr = z.string().trim().max(2000).nullish().transform((v) => v ?? null)
const confidence = z.number().min(0).max(1).nullish().transform((v) => v ?? null)

export const extractedSchema = z
  .object({
    job_related: z.boolean().default(true),
    // unknown/other kinds degrade to 'status_update' rather than rejecting
    email_kind: z
      .string()
      .transform((v) => (EMAIL_KINDS.includes(v as EmailKind) ? (v as EmailKind) : 'status_update')),
    sender: z
      .object({
        name: nullableStr,
        email: nullableStr,
        org: nullableStr,
        is_agency_recruiter: z.boolean().nullish().transform((v) => v ?? false),
        kind: z
          .string()
          .nullish()
          .transform((v) => (CONTACT_KINDS.includes(v as never) ? (v as string) : 'other')),
        confidence,
      })
      .partial()
      .passthrough(),
    hiring_company: z
      .object({
        name: nullableStr,
        withheld: z.boolean().nullish().transform((v) => v ?? false),
        confidence,
      })
      .partial()
      .passthrough(),
    role: z
      .object({ title: nullableStr, confidence })
      .partial()
      .passthrough(),
    event: z
      .object({
        type: nullableStr,
        subtype: nullableStr,
        occurred_at: nullableStr,
        summary: nullableStr,
      })
      .partial()
      .passthrough(),
    status_signal: z
      .string()
      .nullish()
      .transform((v) => (APPLICATION_STATUSES.includes(v as never) ? (v as string) : null)),
    notes: nullableStr,
  })
  .passthrough()

export type Extracted = z.infer<typeof extractedSchema>

// --- POST /api/inbound (worker submits) ----------------------------------
export const inboundSubmit = z.object({
  external_ref: z.string().trim().min(1).max(400),
  source: z.string().trim().min(1).max(100),
  occurred_at: z.coerce.date().nullish().transform((v) => v ?? null),
  summary: z.string().trim().max(4000).nullish().transform((v) => v ?? null),
  thread_key: z.string().trim().max(500).nullish().transform((v) => v ?? null),
  extracted: extractedSchema,
})
export type InboundSubmit = z.infer<typeof inboundSubmit>

// --- the proposal op list (built by the API, edited by the UI) ----------
export const OP_TYPES = [
  'link_company',
  'create_company',
  'link_application',
  'create_application',
  'link_contact',
  'create_contact',
  'add_event',
  'set_status',
] as const
export type OpType = (typeof OP_TYPES)[number]

export interface MatchCandidate {
  id: number
  label: string
  score: number
}

export interface ProposalOp {
  id: string
  op: OpType
  args?: Record<string, unknown>
  refs?: Record<string, string>
  match?: { candidates: MatchCandidate[]; chosen: number | null }
  decision: 'accept' | 'skip'
  reason?: string
}

// --- POST /api/inbound/resolve -----------------------------------------
/** Per-op override the reviewer (or the worker's disambiguation call) sends. */
const opOverride = z.object({
  decision: z.enum(['accept', 'skip']).optional(),
  chosen: z.number().int().positive().nullish(),
  args: z.record(z.unknown()).optional(),
  // let the reviewer convert a link op into a create op (or vice versa)
  op: z.enum(OP_TYPES).optional(),
})

export const inboundResolve = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('apply'),
    ops: z.record(opOverride).default({}),
  }),
  z.object({ action: z.literal('dismiss') }),
  // worker disambiguation: fill op `chosen`s, row stays needs_review
  z.object({
    action: z.literal('choose'),
    choice: z.record(z.number().int().positive()),
  }),
])
export type InboundResolve = z.infer<typeof inboundResolve>

// --- POST /api/tokens -------------------------------------------------
export const tokenCreate = z.object({
  name: z.string().trim().min(1).max(120),
})
