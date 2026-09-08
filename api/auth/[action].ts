import type { VercelRequest, VercelResponse } from '@vercel/node'
import { sql } from '../_db.js'
import {
  OAUTH_STATE_COOKIE,
  appendCookie,
  clearSessionCookie,
  newOAuthState,
  parseCookies,
  requireAuth,
  serializeCookie,
  setSessionCookie,
} from '../_auth.js'

const GITHUB_AUTHORIZE = 'https://github.com/login/oauth/authorize'
const GITHUB_TOKEN = 'https://github.com/login/oauth/access_token'
const GITHUB_USER = 'https://api.github.com/user'

function baseUrl(): string {
  const u = process.env.APP_BASE_URL
  if (!u) throw new Error('APP_BASE_URL is not set')
  return u.replace(/\/$/, '')
}

function signupAllowed(login: string): boolean {
  const raw = process.env.ALLOWED_GITHUB_LOGINS?.trim()
  if (!raw) return true
  const list = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  return list.includes(login.toLowerCase())
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = String(req.query.action ?? '')

  if (action === 'login') return login(res)
  if (action === 'callback') return callback(req, res)
  if (action === 'logout') return logout(req, res)
  if (action === 'me') return me(req, res)
  return res.status(404).json({ error: 'unknown auth action' })
}

function login(res: VercelResponse) {
  const clientId = process.env.GITHUB_CLIENT_ID
  if (!clientId) return res.status(500).json({ error: 'GITHUB_CLIENT_ID is not set' })

  const state = newOAuthState()
  appendCookie(
    res,
    serializeCookie(OAUTH_STATE_COOKIE, state, { maxAge: 600, sameSite: 'Lax' }),
  )

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${baseUrl()}/api/auth/callback`,
    scope: 'read:user',
    state,
  })
  res.redirect(302, `${GITHUB_AUTHORIZE}?${params}`)
}

async function callback(req: VercelRequest, res: VercelResponse) {
  const { code, state } = req.query
  const cookieState = parseCookies(req)[OAUTH_STATE_COOKIE]
  // one-shot: clear the state cookie regardless of outcome
  appendCookie(res, serializeCookie(OAUTH_STATE_COOKIE, '', { maxAge: 0, sameSite: 'Lax' }))

  if (typeof code !== 'string' || typeof state !== 'string' || !cookieState || state !== cookieState) {
    return res.status(400).json({ error: 'invalid oauth state' })
  }

  const tokenRes = await fetch(GITHUB_TOKEN, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${baseUrl()}/api/auth/callback`,
    }),
  })
  const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string }
  if (!tokenJson.access_token) {
    return res.status(502).json({ error: 'github token exchange failed', detail: tokenJson.error })
  }

  const userRes = await fetch(GITHUB_USER, {
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'callback-app',
    },
  })
  if (!userRes.ok) return res.status(502).json({ error: 'github user fetch failed' })
  const gh = (await userRes.json()) as {
    id: number
    login: string
    name: string | null
    avatar_url: string | null
  }

  // Is this a brand-new account, and if so is signup open to them?
  const existing = await sql`select id from users where github_id = ${gh.id}`
  if (existing.length === 0 && !signupAllowed(gh.login)) {
    return res.status(403).json({ error: 'signups are closed' })
  }

  const rows = await sql`
    insert into users (github_id, github_login, name, avatar_url)
    values (${gh.id}, ${gh.login}, ${gh.name}, ${gh.avatar_url})
    on conflict (github_id) do update
      set github_login = excluded.github_login,
          name         = excluded.name,
          avatar_url   = excluded.avatar_url,
          last_login_at = now()
    returning id
  `
  setSessionCookie(res, { uid: Number(rows[0].id), login: gh.login })
  res.redirect(302, `${baseUrl()}/`)
}

function logout(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  clearSessionCookie(res)
  res.status(200).json({ ok: true })
}

async function me(req: VercelRequest, res: VercelResponse) {
  const auth = requireAuth(req, res)
  if (!auth) return
  const rows = await sql`
    select github_login as login, name, avatar_url
    from users where id = ${auth.uid}
  `
  if (rows.length === 0) return res.status(401).json({ error: 'unauthenticated' })
  res.status(200).json(rows[0])
}
