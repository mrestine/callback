import type {
  APPLICATION_STATUSES,
  CONTACT_KINDS,
  REMOTE_MODES,
  WARMTH_LEVELS,
} from '../schemas'
import type { MatchCandidate, ProposalOp } from '../schemas'

export type { MatchCandidate, ProposalOp }

export type ContactKind = (typeof CONTACT_KINDS)[number]
export type Warmth = (typeof WARMTH_LEVELS)[number]
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number]
export type RemoteMode = (typeof REMOTE_MODES)[number]

export interface Company {
  id: number
  name: string
  careers_url: string | null
  notes: string | null
  created_at: string
  updated_at: string
  /** present on list responses only */
  contact_count?: number
  application_count?: number
}

export interface Contact {
  id: number
  company_id: number | null
  /** present on list / detail responses (joined) */
  company_name?: string | null
  name: string
  role: string | null
  kind: ContactKind
  email: string | null
  linkedin_url: string | null
  warmth: Warmth
  notes: string | null
  last_contact_at: string | null
  created_at: string
  updated_at: string
}

export interface ApplicationSummary {
  id: number
  company_id: number
  role_title: string
  /** present on list responses (joined) */
  company_name?: string
  status: ApplicationStatus
  applied_at: string | null
}

/** One row in an <Autocomplete>'s dropdown. */
export interface AutocompleteOption {
  id: number
  label: string
  sublabel?: string | null
}

export interface Application {
  id: number
  company_id: number
  contact_id: number | null
  role_title: string
  jd_url: string | null
  source: string | null
  status: ApplicationStatus
  location: string | null
  remote: RemoteMode | null
  salary_range: string | null
  applied_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
  /** present on list responses (joined) */
  company_name?: string
  contact_name?: string | null
  last_event_at?: string | null
}

export type EventStatus = 'scheduled' | 'logged'

export interface EventRow {
  id: number
  application_id: number | null
  contact_id: number | null
  type: string
  subtype: string | null
  body: string | null
  old_status: string | null
  new_status: string | null
  occurred_at: string
  status: EventStatus
  source: 'manual' | 'ai'
  created_at: string
}

export interface CompanyDetail {
  company: Company
  contacts: Contact[]
  applications: ApplicationSummary[]
}

export interface ContactDetail {
  contact: Contact
  company: Company | null
  applications: ApplicationSummary[]
  events: EventRow[]
}

export interface ApplicationDetail {
  application: Application
  company: Company | null
  contact: Contact | null
  events: EventRow[]
}

// --- dashboard ---------------------------------------------------------
export interface StaleApplication {
  id: number
  role_title: string
  status: ApplicationStatus
  company_name: string
  last_activity_at: string
}

export interface UpcomingEvent {
  id: number
  type: string
  subtype: string | null
  body: string | null
  occurred_at: string
  application_id: number | null
  contact_id: number | null
  role_title: string | null
  company_name: string | null
  contact_name: string | null
}

export interface ActivityItem {
  kind: 'company' | 'contact' | 'application' | 'event'
  id: number
  label: string
  sub: string | null
  subtype: string | null
  at: string
  application_id: number | null
  contact_id: number | null
}

export interface DashboardData {
  activeApplications: number
  activeCompanies: number
  staleThresholdDays: number
  stale: StaleApplication[]
  upcoming: UpcomingEvent[]
  recent: ActivityItem[]
}

// --- Phase 2 — AI inbound review ------------------------------------
export type InboundStatus =
  | 'pending'
  | 'needs_review'
  | 'applied'
  | 'auto_applied'
  | 'dismissed'
  | 'duplicate'
  | 'error'

/** the worker's extracted structure — callback treats it as opaque display data */
export interface InboundExtracted {
  job_related: boolean
  email_kind: string
  sender: { name: string | null; email: string | null; org: string | null; is_agency_recruiter: boolean; kind: string }
  hiring_company: { name: string | null; withheld: boolean }
  role: { title: string | null }
  additional_opportunities?: Array<{ hiring_company: { name: string | null; withheld: boolean }; role: { title: string | null } }>
  event: { type: string | null; subtype: string | null; occurred_at: string | null; summary: string | null }
  status_signal: string | null
  notes: string | null
}

/** row from GET /api/inbound (list) */
export interface InboundRow {
  id: number
  source: string
  external_ref: string
  occurred_at: string | null
  summary: string | null
  status: InboundStatus
  email_kind: string | null
  match: unknown
  proposal: ProposalOp[] | null
  applied: { id: string; op: string; result_id: number | null; created: boolean }[] | null
  error: string | null
  created_at: string
  resolved_at: string | null
}

/** row from GET /api/inbound?id= (full) */
export interface InboundDetail extends InboundRow {
  payload: { external_ref: string; source: string; thread_key: string | null; summary: string | null; occurred_at: string | null; extracted: InboundExtracted } | null
}

export interface ApiToken {
  id: number
  name: string
  scopes: string[]
  created_at: string
  last_used_at: string | null
}
export interface NewApiToken extends ApiToken {
  token: string
}
