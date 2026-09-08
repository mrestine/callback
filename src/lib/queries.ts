import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import type { Company, CompanyDetail, Contact, ContactDetail, ContactKind, Warmth } from './types'

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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['companies'] }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts'] }),
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
