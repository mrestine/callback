/**
 * Thin fetch wrapper for the /api routes. Sends cookies, parses JSON, throws on
 * non-2xx. A 401 means the session is gone — bounce to the login screen.
 */

export interface ApiIssue {
  path: string
  message: string
}

export class ApiError extends Error {
  status: number
  /** Per-field validation issues from a 400 response, if any. */
  issues?: ApiIssue[]
  constructor(status: number, message: string, issues?: ApiIssue[]) {
    super(message)
    this.status = status
    this.name = 'ApiError'
    this.issues = issues
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (res.status === 401 && !path.endsWith('/api/auth/me')) {
    window.location.assign('/login')
    throw new ApiError(401, 'unauthenticated')
  }

  const text = await res.text()
  const data = text ? JSON.parse(text) : null

  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? `${res.status} ${res.statusText}`, data?.issues)
  }
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
}
