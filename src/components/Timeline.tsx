import { useState } from 'react'
import type { FormEvent } from 'react'
import type { EventRow } from '../lib/types'
import { formatDate, formatShortDate, titleCase, toDateInput } from '../lib/format'
import { EVENT_SUBTYPE_SUGGESTIONS, MANUAL_EVENT_TYPES } from '../schemas'
import { useCreateEvent, useDeleteEvent, useUpdateEvent } from '../lib/queries'
import { Badge, Button, EmptyState, ErrorNote, Field, SelectField, TextArea, TextField } from './ui'

interface Scope {
  applicationId?: number
  contactId?: number
}

interface FieldValues {
  type: string
  subtype: string
  body: string
  occurredAt: string
}

const SUBTYPE_LIST_ID = 'event-subtype-suggestions'

/** Renders `<label — subtype>` e.g. "Interview · Technical". */
export function eventLabel(type: string, subtype: string | null): string {
  return subtype ? `${titleCase(type)} · ${subtype}` : titleCase(type)
}

/**
 * Activity feed for one application or one contact. Pass `applicationId` or
 * `contactId` to enable composing, editing, and deleting; omit both for a
 * read-only feed. Scheduled (future) events sort to the top with a badge.
 */
export function Timeline({ events, applicationId, contactId }: { events: EventRow[] } & Scope) {
  const scope: Scope = { applicationId, contactId }
  const editable = applicationId !== undefined || contactId !== undefined

  return (
    <div>
      <datalist id={SUBTYPE_LIST_ID}>
        {EVENT_SUBTYPE_SUGGESTIONS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      {editable && <Composer {...scope} />}

      {events.length === 0 ? (
        <EmptyState>No activity yet.</EmptyState>
      ) : (
        <ul className="space-y-2 text-sm">
          {events.map((e) => (
            <EventItem key={e.id} event={e} scope={scope} editable={editable} />
          ))}
        </ul>
      )}
    </div>
  )
}

function EventItem({ event: e, scope, editable }: { event: EventRow; scope: Scope; editable: boolean }) {
  const [editing, setEditing] = useState(false)
  const update = useUpdateEvent(scope)
  const del = useDeleteEvent()
  const system = e.type === 'status_change'
  const canEdit = editable && !system

  if (editing) {
    return (
      <li className="rounded-md border border-gray-200 px-3 py-2 dark:border-gray-800">
        <EventFields
          initial={{
            type: e.type,
            subtype: e.subtype ?? '',
            body: e.body ?? '',
            occurredAt: toDateInput(e.occurred_at),
          }}
          pending={update.isPending}
          error={update.error}
          onCancel={() => setEditing(false)}
          onSubmit={(v) =>
            update.mutate(
              {
                id: e.id,
                type: v.type,
                subtype: v.subtype || undefined,
                body: v.body || undefined,
                occurred_at: v.occurredAt || undefined,
              },
              { onSuccess: () => setEditing(false) },
            )
          }
        />
      </li>
    )
  }

  return (
    <li className="rounded-md border border-gray-200 px-3 py-2 dark:border-gray-800">
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="tabular-nums text-gray-400" title={formatDate(e.occurred_at)}>
            {formatShortDate(e.occurred_at)}
          </span>
          {eventLabel(e.type, e.subtype)}
          {e.status === 'scheduled' && <Badge tone="onsite">Scheduled</Badge>}
          {e.source === 'ai' && <Badge>AI</Badge>}
        </span>
        {canEdit && (
          <span className="flex items-center gap-2">
            {e.status === 'scheduled' && (
              <button
                onClick={() => update.mutate({ id: e.id, status: 'logged' })}
                className="hover:text-gray-900 dark:hover:text-gray-100"
              >
                Mark done
              </button>
            )}
            <button onClick={() => setEditing(true)} className="hover:text-gray-900 dark:hover:text-gray-100">
              Edit
            </button>
            <button
              onClick={() => {
                if (window.confirm(`Delete this ${eventLabel(e.type, e.subtype)} entry?`)) {
                  del.mutate({ id: e.id, ...scope })
                }
              }}
              className="hover:text-red-600"
              aria-label="Delete event"
            >
              ✕
            </button>
          </span>
        )}
      </div>

      {system && e.old_status && e.new_status && (
        <p className="mt-1">
          {titleCase(e.old_status)} <span className="text-gray-400">→</span> {titleCase(e.new_status)}
        </p>
      )}
      {e.body && <p className="mt-1 whitespace-pre-wrap">{e.body}</p>}

      {(del.isError || update.isError) && (
        <div className="mt-2">
          <ErrorNote error={del.error ?? update.error} />
        </div>
      )}
    </li>
  )
}

function Composer({ applicationId, contactId }: Scope) {
  const create = useCreateEvent()
  // bumping this remounts EventFields, clearing it after a successful add
  const [nonce, setNonce] = useState(0)

  function onSubmit(v: FieldValues) {
    create.mutate(
      {
        application_id: applicationId,
        contact_id: contactId,
        type: v.type,
        subtype: v.subtype || undefined,
        body: v.body || undefined,
        occurred_at: v.occurredAt || undefined,
      },
      { onSuccess: () => setNonce((n) => n + 1) },
    )
  }

  return (
    <div className="mb-4 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
      <EventFields
        key={nonce}
        initial={{ type: 'note', subtype: '', body: '', occurredAt: '' }}
        pending={create.isPending}
        error={create.error}
        submitLabel="Add to timeline"
        onSubmit={onSubmit}
        hint="A future date schedules it and shows it under Upcoming."
      />
    </div>
  )
}

function EventFields({
  initial,
  onSubmit,
  onCancel,
  pending,
  error,
  submitLabel = 'Save',
  hint,
}: {
  initial: FieldValues
  onSubmit: (v: FieldValues) => void
  onCancel?: () => void
  pending?: boolean
  error?: unknown
  submitLabel?: string
  hint?: string
}) {
  const [type, setType] = useState(initial.type)
  const [subtype, setSubtype] = useState(initial.subtype)
  const [body, setBody] = useState(initial.body)
  const [occurredAt, setOccurredAt] = useState(initial.occurredAt)

  function submit(e: FormEvent) {
    e.preventDefault()
    onSubmit({ type, subtype, body, occurredAt })
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <div className="w-32">
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
        <div className="w-44">
          <Field label="Detail" hint="Technical, Behavioral, Intro…">
            <TextField
              list={SUBTYPE_LIST_ID}
              value={subtype}
              onChange={(e) => setSubtype(e.target.value)}
            />
          </Field>
        </div>
        <div className="w-40">
          <Field label="When" hint={hint ? undefined : 'defaults to now'}>
            <TextField type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
          </Field>
        </div>
      </div>
      <Field label="Note" hint={hint}>
        <TextArea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What happened?" />
      </Field>
      {error != null && <ErrorNote error={error} />}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : submitLabel}
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
