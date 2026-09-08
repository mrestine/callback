import { useState } from 'react'
import type { FormEvent } from 'react'
import type { EventRow } from '../lib/types'
import { formatDate, titleCase } from '../lib/format'
import { MANUAL_EVENT_TYPES } from '../schemas'
import { useCreateEvent, useDeleteEvent } from '../lib/queries'
import { Badge, Button, EmptyState, ErrorNote, Field, SelectField, TextArea, TextField } from './ui'

/**
 * Activity feed for one application or one contact. Pass exactly one of
 * `applicationId` / `contactId` to enable the compose box and per-row delete;
 * omit both for a read-only feed.
 */
export function Timeline({
  events,
  applicationId,
  contactId,
}: {
  events: EventRow[]
  applicationId?: number
  contactId?: number
}) {
  const editable = applicationId !== undefined || contactId !== undefined
  const del = useDeleteEvent()

  return (
    <div>
      {editable && <Composer applicationId={applicationId} contactId={contactId} />}

      {events.length === 0 ? (
        <EmptyState>No activity yet.</EmptyState>
      ) : (
        <ul className="space-y-2 text-sm">
          {events.map((e) => (
            <li key={e.id} className="group rounded-md border border-gray-200 px-3 py-2 dark:border-gray-800">
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span className="flex items-center gap-1.5">
                  {titleCase(e.type)}
                  {e.source === 'ai' && <Badge>AI</Badge>}
                </span>
                <span className="flex items-center gap-2">
                  {formatDate(e.occurred_at)}
                  {editable && e.type !== 'status_change' && (
                    <button
                      onClick={() =>
                        del.mutate({ id: e.id, applicationId, contactId })
                      }
                      className="text-gray-400 opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100"
                      aria-label="Delete event"
                    >
                      ✕
                    </button>
                  )}
                </span>
              </div>
              {e.type === 'status_change' && e.old_status && e.new_status && (
                <p className="mt-1">
                  {titleCase(e.old_status)} <span className="text-gray-400">→</span>{' '}
                  {titleCase(e.new_status)}
                </p>
              )}
              {e.body && <p className="mt-1 whitespace-pre-wrap">{e.body}</p>}
            </li>
          ))}
        </ul>
      )}

      {del.isError && (
        <div className="mt-2">
          <ErrorNote error={del.error} />
        </div>
      )}
    </div>
  )
}

function Composer({ applicationId, contactId }: { applicationId?: number; contactId?: number }) {
  const create = useCreateEvent()
  const [type, setType] = useState<string>('note')
  const [occurredAt, setOccurredAt] = useState('')
  const [body, setBody] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    create.mutate(
      {
        application_id: applicationId,
        contact_id: contactId,
        type,
        body: body || undefined,
        occurred_at: occurredAt || undefined,
      },
      {
        onSuccess: () => {
          setBody('')
          setOccurredAt('')
          setType('note')
        },
      },
    )
  }

  return (
    <form onSubmit={submit} className="mb-4 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
      <div className="mb-2 flex gap-2">
        <div className="w-40">
          <Field label="Type">
            <SelectField value={type} onChange={(e) => setType(e.target.value)}>
              {MANUAL_EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {titleCase(t)}
                </option>
              ))}
            </SelectField>
          </Field>
        </div>
        <div className="w-40">
          <Field label="When" hint="defaults to now">
            <TextField type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
          </Field>
        </div>
      </div>
      <Field label="Note">
        <TextArea
          rows={2}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What happened?"
        />
      </Field>
      {create.isError && (
        <div className="mt-2">
          <ErrorNote error={create.error} />
        </div>
      )}
      <div className="mt-2">
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Adding…' : 'Add to timeline'}
        </Button>
      </div>
    </form>
  )
}
