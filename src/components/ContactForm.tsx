import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { CONTACT_KINDS, WARMTH_LEVELS } from '../schemas'
import { useCompanyOptions } from '../lib/queries'
import type { ContactInput } from '../lib/queries'
import type { AutocompleteOption } from '../lib/types'
import { applyServerErrors, errorMessage } from '../lib/forms'
import { dateInputToInstant } from '../lib/format'
import { Autocomplete } from './Autocomplete'
import { Button, ErrorNote, Field, SelectField, TextArea, TextField } from './ui'

const KIND_LABELS: Record<string, string> = {
  friend: 'Friend',
  recruiter: 'Recruiter',
  hiring_mgr: 'Hiring manager',
  referral: 'Referral',
  other: 'Other',
}

type FormValues = Omit<ContactInput, 'company_id'>

export function ContactForm({
  defaultValues,
  defaultCompany = null,
  onSubmit,
  onCancel,
  submitLabel = 'Save',
}: {
  defaultValues?: Partial<FormValues>
  /** The currently-linked company, for edit mode — omit when creating. */
  defaultCompany?: AutocompleteOption | null
  /** Should reject on failure so field errors can be surfaced. */
  onSubmit: (values: ContactInput) => Promise<unknown>
  onCancel?: () => void
  submitLabel?: string
}) {
  const [formError, setFormError] = useState<string | null>(null)
  const [company, setCompany] = useState<AutocompleteOption | null>(defaultCompany)
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      name: '',
      role: '',
      kind: 'other',
      email: '',
      linkedin_url: '',
      warmth: 'cold',
      notes: '',
      last_contact_at: '',
      ...defaultValues,
    },
  })

  const submit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      await onSubmit({
        ...values,
        last_contact_at: values.last_contact_at ? dateInputToInstant(values.last_contact_at) : '',
        company_id: company ? String(company.id) : '',
      })
    } catch (err) {
      if (!applyServerErrors(err, setError)) setFormError(errorMessage(err))
    }
  })

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" error={errors.name?.message}>
          <TextField autoFocus {...register('name', { required: 'Name is required' })} />
        </Field>
        <Field label="Company">
          <Autocomplete value={company} onChange={setCompany} useOptions={useCompanyOptions} placeholder="Search companies…" allowClear />
        </Field>
        <Field label="Role / title" error={errors.role?.message}>
          <TextField {...register('role')} />
        </Field>
        <Field label="Kind" error={errors.kind?.message}>
          <SelectField {...register('kind')}>
            {CONTACT_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </SelectField>
        </Field>
        <Field label="Email" error={errors.email?.message}>
          <TextField type="email" inputMode="email" {...register('email')} />
        </Field>
        <Field label="LinkedIn URL" error={errors.linkedin_url?.message}>
          <TextField type="url" inputMode="url" placeholder="https://…" {...register('linkedin_url')} />
        </Field>
        <Field label="Warmth" error={errors.warmth?.message}>
          <SelectField {...register('warmth')}>
            {WARMTH_LEVELS.map((w) => (
              <option key={w} value={w}>
                {w[0].toUpperCase() + w.slice(1)}
              </option>
            ))}
          </SelectField>
        </Field>
        <Field label="Last contact" error={errors.last_contact_at?.message}>
          <TextField type="date" {...register('last_contact_at')} />
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
