import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const SESSION_COOKIE = 'cb_session'
export const OAUTH_STATE_COOKIE = 'cb_oauth_state'
const SESSION_MAX_AGE = 60 * 60 * 24 * 30 // 30 days, seconds

function secret(): string {
  const s = process.env.SESSION_SECRET
  if (!s) throw new Error('SESSION_SECRET is not set')
  return s
}

// --- cookie parsing / serialisation ----------------------------------
export function parseCookies(req: VercelRequest): Record<string, string> {
  const header = req.headers.cookie
  if (!header) return {}
  const out: Record<string, string> = {}
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i === -1) continue
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

interface CookieOpts {
  maxAge?: number // seconds; 0 clears
  httpOnly?: boolean
  path?: string
  sameSite?: 'Strict' | 'Lax' | 'None'
}

export function serializeCookie(name: string, value: string, opts: CookieOpts = {}): string {
  const { maxAge, httpOnly = true, path = '/', sameSite = 'Lax' } = opts
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`]
  if (httpOnly) parts.push('HttpOnly')
  // Vercel terminates TLS; cookies are always sent over https in deployed envs.
  if (process.env.NODE_ENV === 'production') parts.push('Secure')
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`)
  return parts.join('; ')
}

export function appendCookie(res: VercelResponse, cookie: string): void {
  const existing = res.getHeader('Set-Cookie')
  if (!existing) res.setHeader('Set-Cookie', cookie)
  else if (Array.isArray(existing)) res.setHeader('Set-Cookie', [...existing, cookie])
  else res.setHeader('Set-Cookie', [String(existing), cookie])
}

// --- session token (HMAC-signed, self-contained) --------------------
export interface SessionUser {
  uid: number
  login: string
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url')
}

export function signSession(user: SessionUser): string {
  const payload = b64url(JSON.stringify({ ...user, iat: Math.floor(Date.now() / 1000) }))
  const mac = createHmac('sha256', secret()).update(payload).digest('base64url')
  return `${payload}.${mac}`
}

export function verifySession(token: string): SessionUser | null {
  const dot = token.indexOf('.')
  if (dot === -1) return null
  const payload = token.slice(0, dot)
  const mac = token.slice(dot + 1)
  const expected = createHmac('sha256', secret()).update(payload).digest('base64url')
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (typeof data.uid !== 'number' || typeof data.login !== 'string') return null
    return { uid: data.uid, login: data.login }
  } catch {
    return null
  }
}

// --- request-side helpers -----------------------------------------
export function readSession(req: VercelRequest): SessionUser | null {
  const raw = parseCookies(req)[SESSION_COOKIE]
  return raw ? verifySession(raw) : null
}

/**
 * Returns the authenticated user or sends a 401 and returns null. Handlers:
 *   const auth = requireAuth(req, res)
 *   if (!auth) return
 */
export function requireAuth(req: VercelRequest, res: VercelResponse): SessionUser | null {
  const user = readSession(req)
  if (!user) {
    res.status(401).json({ error: 'unauthenticated' })
    return null
  }
  return user
}

export function setSessionCookie(res: VercelResponse, user: SessionUser): void {
  appendCookie(res, serializeCookie(SESSION_COOKIE, signSession(user), { maxAge: SESSION_MAX_AGE }))
}

export function clearSessionCookie(res: VercelResponse): void {
  appendCookie(res, serializeCookie(SESSION_COOKIE, '', { maxAge: 0 }))
}

export function newOAuthState(): string {
  return randomBytes(16).toString('hex')
}
