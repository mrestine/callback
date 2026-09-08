import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'
import { ApiError } from './api'

/**
 * Maps a server 400 validation response onto react-hook-form fields.
 * Returns true if it handled the error (field issues were applied),
 * false if the caller should surface it as a general error.
 */
export function applyServerErrors<T extends FieldValues>(
  err: unknown,
  setError: UseFormSetError<T>,
): boolean {
  if (err instanceof ApiError && err.issues && err.issues.length > 0) {
    for (const issue of err.issues) {
      if (issue.path) setError(issue.path as Path<T>, { type: 'server', message: issue.message })
    }
    return true
  }
  return false
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong'
}
