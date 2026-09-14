import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import type {
  ApiToken,
  Application,
  ApplicationDetail,
  ApplicationStatus,
  AutocompleteOption,
  Company,
  CompanyDetail,
  Contact,
  ContactDetail,
  ContactKind,
  DashboardData,
  EventRow,
  EventStatus,
  InboundDetail,
  InboundRow,
  NewApiToken,
  RemoteMode,
  Warmth,
} from './types'

/**
 * Request bodies are form-shaped: strings straight from the inputs. The server's
 * shared Zod schemas coerce and normalise (empty string -> null, "3" -> 3,
 * date strings -> Date), so the client doesn't duplicate that.
 */
export interface CompanyInput {
  name: string
  careers_url?: string
  notes?: string
}

export interface ContactInput {
  name: string
  company_id?: string
  role?: string
  kind?: ContactKind
  email?: string
  linkedin_url?: string
  warmth?: Warmth
  notes?: string
  last_contact_at?: string
}

export interface ContactFilters {
  q?: string
  kind?: string
  company_id?: number
}

export interface ApplicationInput {
  company_id: string
  contact_id?: string
  role_title: string
  jd_url?: string
  source?: string
  status?: ApplicationStatus
  location?: string
  remote?: RemoteMode | ''
  salary_range?: string
  applied_at?: string
  notes?: string
}

export interface ApplicationFilters {
  q?: string
  status?: string
  company_id?: number
}

/** Build a `?a=b&c=d` string, dropping empty / undefined values. */
function qs(params: Record<string, string | number | undefined>): string {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') s.set(k, String(v))
  }
  const str = s.toString()
  return str ? `?${str}` : ''
}

// --- companies -----------------------------------------------------------
export function useCompanies(q = '') {
  return useQuery({
    queryKey: ['companies', { q }],
    queryFn: () => api.get<Company[]>(`/api/companies${qs({ q })}`),
  })
}

export function useCompany(id: number) {
  return useQuery({
    queryKey: ['company', id],
    queryFn: () => api.get<CompanyDetail>(`/api/companies${qs({ id })}`),
  })
}

export function useCreateCompany() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CompanyInput) => api.post<Company>('/api/companies', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['companies'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useUpdateCompany(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CompanyInput) => api.patch<Company>(`/api/companies${qs({ id })}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['companies'] })
      qc.invalidateQueries({ queryKey: ['company', id] })
    },
  })
}

export function useDeleteCompany() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.del<void>(`/api/companies${qs({ id })}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['companies'] }),
  })
}

/** <Autocomplete> source for picking an existing company. */
export function useCompanyOptions(q: string): { data?: AutocompleteOption[]; isLoading: boolean } {
  const companies = useCompanies(q)
  return { data: companies.data?.map((c) => ({ id: c.id, label: c.name })), isLoading: companies.isLoading }
}

// --- contacts ------------------------------------------------------------
export function useContacts(filters: ContactFilters) {
  return useQuery({
    queryKey: ['contacts', filters],
    queryFn: () => api.get<Contact[]>(`/api/contacts${qs({ ...filters })}`),
  })
}

export function useContact(id: number) {
  return useQuery({
    queryKey: ['contact', id],
    queryFn: () => api.get<ContactDetail>(`/api/contacts${qs({ id })}`),
  })
}

export function useCreateContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ContactInput) => api.post<Contact>('/api/contacts', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useUpdateContact(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ContactInput) => api.patch<Contact>(`/api/contacts${qs({ id })}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] })
      qc.invalidateQueries({ queryKey: ['contact', id] })
    },
  })
}

export function useDeleteContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.del<void>(`/api/contacts${qs({ id })}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts'] }),
  })
}

/** <Autocomplete> source for picking an existing contact. */
export function useContactOptions(q: string): { data?: AutocompleteOption[]; isLoading: boolean } {
  const contacts = useContacts({ q: q || undefined })
  return {
    data: contacts.data?.map((c) => ({ id: c.id, label: c.name, sublabel: c.company_name })),
    isLoading: contacts.isLoading,
  }
}

// --- applications ------------------------------------------------------
/** An application mutation can change lists embedded in company / contact detail. */
function invalidateApplicationViews(qc: ReturnType<typeof useQueryClient>, id?: number) {
  qc.invalidateQueries({ queryKey: ['applications'] })
  if (id !== undefined) qc.invalidateQueries({ queryKey: ['application', id] })
  qc.invalidateQueries({ queryKey: ['company'] })
  qc.invalidateQueries({ queryKey: ['contact'] })
  qc.invalidateQueries({ queryKey: ['dashboard'] })
}

/** <Autocomplete> source for picking an existing application — always shown
 *  as "Company — Role", never role alone. */
export function useApplicationOptions(q: string): { data?: AutocompleteOption[]; isLoading: boolean } {
  const applications = useApplications({ q: q || undefined })
  return {
    data: applications.data?.map((a) => ({
      id: a.id,
      label: `${a.company_name ?? '?'} — ${a.role_title}`,
      sublabel: a.status,
    })),
    isLoading: applications.isLoading,
  }
}

export function useApplications(filters: ApplicationFilters) {
  return useQuery({
    queryKey: ['applications', filters],
    queryFn: () => api.get<Application[]>(`/api/applications${qs({ ...filters })}`),
  })
}

export function useApplication(id: number) {
  return useQuery({
    queryKey: ['application', id],
    queryFn: () => api.get<ApplicationDetail>(`/api/applications${qs({ id })}`),
  })
}

export function useCreateApplication() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ApplicationInput) => api.post<Application>('/api/applications', body),
    onSuccess: () => invalidateApplicationViews(qc),
  })
}

export function useUpdateApplication(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<ApplicationInput>) =>
      api.patch<Application>(`/api/applications${qs({ id })}`, body),
    onSuccess: () => invalidateApplicationViews(qc, id),
  })
}

export function useDeleteApplication() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.del<void>(`/api/applications${qs({ id })}`),
    onSuccess: () => invalidateApplicationViews(qc),
  })
}

// --- events ----------------------------------------------------------
export interface EventInput {
  application_id?: number
  contact_id?: number
  type?: string
  subtype?: string
  body?: string
  occurred_at?: string
}

interface EventScope {
  applicationId?: number
  contactId?: number
}

export interface EventPatch {
  type?: string
  subtype?: string
  body?: string
  occurred_at?: string
  status?: EventStatus
}

function invalidateEventViews(qc: ReturnType<typeof useQueryClient>, scope: EventScope) {
  if (scope.applicationId !== undefined) {
    qc.invalidateQueries({ queryKey: ['application', scope.applicationId] })
    qc.invalidateQueries({ queryKey: ['applications'] })
  }
  if (scope.contactId !== undefined) {
    qc.invalidateQueries({ queryKey: ['contact', scope.contactId] })
    qc.invalidateQueries({ queryKey: ['contacts'] })
  }
  qc.invalidateQueries({ queryKey: ['dashboard'] })
}

export function useCreateEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: EventInput) => api.post<EventRow>('/api/events', body),
    onSuccess: (_row, body) =>
      invalidateEventViews(qc, { applicationId: body.application_id, contactId: body.contact_id }),
  })
}

export function useUpdateEvent(scope: EventScope) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: number } & EventPatch) =>
      api.patch<EventRow>(`/api/events${qs({ id })}`, patch),
    onSuccess: () => invalidateEventViews(qc, scope),
  })
}

export function useDeleteEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: { id: number } & EventScope) => api.del<void>(`/api/events${qs({ id: args.id })}`),
    onSuccess: (_res, args) => invalidateEventViews(qc, args),
  })
}

// --- dashboard -----------------------------------------------------
export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardData>('/api/dashboard'),
  })
}

// --- Phase 2: AI inbound review ----------------------------------
/** Per-op override sent to POST /api/inbound/resolve. */
export interface OpOverride {
  decision?: 'accept' | 'skip'
  chosen?: number | null
  args?: Record<string, unknown>
  op?: string
}
export type ResolveBody =
  | { action: 'apply'; ops: Record<string, OpOverride> }
  | { action: 'dismiss' }
  | { action: 'choose'; choice: Record<string, number> }

/** `enabled` false while signed out (e.g. rendered from the layout during redirect). */
export function useReviewQueue(enabled = true) {
  return useQuery({
    queryKey: ['inbound', 'queue'],
    queryFn: () => api.get<InboundRow[]>('/api/inbound?status=needs_review'),
    refetchInterval: 60_000,
    enabled,
  })
}

export function useInboundHistory() {
  return useQuery({
    queryKey: ['inbound', 'history'],
    queryFn: () => api.get<InboundRow[]>('/api/inbound?limit=200'),
  })
}

export function useInboundAction(id: number) {
  return useQuery({
    queryKey: ['inbound', id],
    queryFn: () => api.get<InboundDetail>(`/api/inbound?id=${id}`),
  })
}

export function useResolveInbound() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: ResolveBody }) =>
      api.post<{ status: string; applied?: unknown }>(`/api/inbound/resolve?id=${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inbound'] })
      // an apply may have written companies / contacts / applications / events
      qc.invalidateQueries({ queryKey: ['applications'] })
      qc.invalidateQueries({ queryKey: ['companies'] })
      qc.invalidateQueries({ queryKey: ['contacts'] })
      qc.invalidateQueries({ queryKey: ['company'] })
      qc.invalidateQueries({ queryKey: ['contact'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

// --- Phase 2: worker API tokens (Settings) --------------------
export function useTokens() {
  return useQuery({
    queryKey: ['tokens'],
    queryFn: () => api.get<ApiToken[]>('/api/tokens'),
  })
}

export function useCreateToken() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => api.post<NewApiToken>('/api/tokens', { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tokens'] }),
  })
}

export function useDeleteToken() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.del<void>(`/api/tokens?id=${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tokens'] }),
  })
}
