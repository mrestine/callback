import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Button, ErrorNote, Field, TextArea, TextField } from './ui'
import { applyServerErrors, errorMessage } from '../lib/forms'
import type { CompanyInput } from '../lib/queries'

export function CompanyForm({
  defaultValues,
  onSubmit,
  onCancel,
  submitLabel = 'Save',
}: {
  defaultValues?: Partial<CompanyInput>
  /** Should reject on failure so field errors can be surfaced. */
  onSubmit: (values: CompanyInput) => Promise<unknown>
  onCancel?: () => void
  submitLabel?: string
}) {
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CompanyInput>({
    defaultValues: { name: '', careers_url: '', notes: '', ...defaultValues },
  })

  const submit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      await onSubmit(values)
    } catch (err) {
      if (!applyServerErrors(err, setError)) setFormError(errorMessage(err))
    }
  })

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Name" error={errors.name?.message}>
        <TextField autoFocus {...register('name', { required: 'Name is required' })} />
      </Field>
      <Field label="Careers URL" error={errors.careers_url?.message}>
        <TextField type="url" inputMode="url" placeholder="https://…" {...register('careers_url')} />
      </Field>
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
