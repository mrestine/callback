import type {
  APPLICATION_STATUSES,
  CONTACT_KINDS,
  REMOTE_MODES,
  WARMTH_LEVELS,
} from '../schemas'

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
  status: ApplicationStatus
  applied_at: string | null
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

export interface EventRow {
  id: number
  application_id: number | null
  contact_id: number | null
  type: string
  body: string | null
  old_status: string | null
  new_status: string | null
  occurred_at: string
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
