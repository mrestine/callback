import type { VercelRequest, VercelResponse } from '@vercel/node'
import { ZodError, type ZodTypeAny, type infer as ZodInfer } from 'zod'

/** `?id=` as a positive integer, or null if absent/invalid. */
export function getId(req: VercelRequest): number | null {
  const raw = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** A string query param, or undefined if absent/empty. */
export function qparam(req: VercelRequest, key: string): string | undefined {
  const raw = Array.isArray(req.query[key]) ? req.query[key]?.[0] : req.query[key]
  return raw && raw.length > 0 ? String(raw) : undefined
}

/**
 * Validates `req.body` against `schema`. On failure sends a 400 with the Zod
 * issues and returns null — callers do `if (!data) return`.
 */
export function parseBody<S extends ZodTypeAny>(
  schema: S,
  req: VercelRequest,
  res: VercelResponse,
): ZodInfer<S> | null {
  try {
    return schema.parse(req.body ?? {}) as ZodInfer<S>
  } catch (err) {
    if (err instanceof ZodError) {
      res.status(400).json({
        error: 'validation',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      })
      return null
    }
    throw err
  }
}

export function methodNotAllowed(res: VercelResponse, allow: string[]): void {
  res.setHeader('Allow', allow.join(', '))
  res.status(405).json({ error: 'method not allowed' })
}

/** Wraps a handler so thrown errors become a 500 instead of crashing the fn. */
export function withErrors(
  fn: (req: VercelRequest, res: VercelResponse) => Promise<void> | void,
) {
  return async (req: VercelRequest, res: VercelResponse) => {
    try {
      await fn(req, res)
    } catch (err) {
      console.error(err)
      if (!res.headersSent) res.status(500).json({ error: 'internal error' })
    }
  }
}
