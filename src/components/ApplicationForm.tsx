import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { APPLICATION_STATUSES, REMOTE_MODES } from '../schemas'
import { useCompanyOptions, useContactOptions } from '../lib/queries'
import type { ApplicationInput } from '../lib/queries'
import type { AutocompleteOption } from '../lib/types'
import { applyServerErrors, errorMessage } from '../lib/forms'
import { titleCase } from '../lib/format'
import { Autocomplete } from './Autocomplete'
import { Button, ErrorNote, Field, SelectField, TextArea, TextField } from './ui'

type FormValues = Omit<ApplicationInput, 'company_id' | 'contact_id'>

export function ApplicationForm({
  defaultValues,
  defaultCompany = null,
  defaultContact = null,
  onSubmit,
  onCancel,
  submitLabel = 'Save',
}: {
  defaultValues?: Partial<FormValues>
  /** The currently-linked company/contact, for edit mode (so the field shows
   *  a name instead of starting blank) — omit when creating. */
  defaultCompany?: AutocompleteOption | null
  defaultContact?: AutocompleteOption | null
  /** Should reject on failure so field errors can be surfaced. */
  onSubmit: (values: ApplicationInput) => Promise<unknown>
  onCancel?: () => void
  submitLabel?: string
}) {
  const [formError, setFormError] = useState<string | null>(null)
  const [company, setCompany] = useState<AutocompleteOption | null>(defaultCompany)
  const [companyError, setCompanyError] = useState<string | null>(null)
  const [contact, setContact] = useState<AutocompleteOption | null>(defaultContact)
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      role_title: '',
      status: 'lead',
      jd_url: '',
      source: '',
      location: '',
      remote: '',
      salary_range: '',
      applied_at: '',
      notes: '',
      ...defaultValues,
    },
  })

  const submit = handleSubmit(async (values) => {
    setFormError(null)
    setCompanyError(company ? null : 'Company is required')
    if (!company) return
    try {
      await onSubmit({ ...values, company_id: String(company.id), contact_id: contact ? String(contact.id) : '' })
    } catch (err) {
      if (!applyServerErrors(err, setError)) setFormError(errorMessage(err))
    }
  })

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Company" error={companyError ?? undefined}>
          <Autocomplete value={company} onChange={setCompany} useOptions={useCompanyOptions} placeholder="Search companies…" invalid={!!companyError} />
        </Field>
        <Field label="Role / title" error={errors.role_title?.message}>
          <TextField autoFocus {...register('role_title', { required: 'Role is required' })} />
        </Field>
        <Field label="Status" error={errors.status?.message}>
          <SelectField {...register('status')}>
            {APPLICATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </SelectField>
        </Field>
        <Field label="Applied on" error={errors.applied_at?.message}>
          <TextField type="date" {...register('applied_at')} />
        </Field>
        <Field label="Contact">
          <Autocomplete
            value={contact}
            onChange={setContact}
            useOptions={useContactOptions}
            placeholder="Search contacts…"
            allowClear
          />
        </Field>
        <Field label="Source" error={errors.source?.message} hint="referral, LinkedIn, cold…">
          <TextField {...register('source')} />
        </Field>
        <Field label="Location" error={errors.location?.message}>
          <TextField {...register('location')} />
        </Field>
        <Field label="Remote" error={errors.remote?.message}>
          <SelectField {...register('remote')}>
            <option value="">— unspecified —</option>
            {REMOTE_MODES.map((m) => (
              <option key={m} value={m}>
                {titleCase(m)}
              </option>
            ))}
          </SelectField>
        </Field>
        <Field label="Salary range" error={errors.salary_range?.message}>
          <TextField {...register('salary_range')} />
        </Field>
        <Field label="Job posting URL" error={errors.jd_url?.message}>
          <TextField type="url" inputMode="url" placeholder="https://…" {...register('jd_url')} />
        </Field>
      </div>
      <Field label="Notes" error={errors.notes?.message}>
        <TextArea {...register('notes')} />
      </Field>
      {formError && <ErrorNote error={new Error(formError)} />}
      <div className="flex gap-2 pt-1">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}
