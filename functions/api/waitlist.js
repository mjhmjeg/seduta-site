// Waitlist: POST /api/waitlist {"email", "company"} -> 200 {"ok":true}. Stores `email:<address>` -> {"date"} in the
// KV namespace WAITLIST (README: Waitlist). Nothing else is kept: no IP, no user agent. `company` is a honeypot.
// Pages routes this file before the [[path]].js catch-all.
// ponytail: no rate limit beyond the honeypot; add a per-IP KV marker if spam shows up.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } })

export async function handle(request, env) {
  if (request.method !== "POST") return json({ error: "method" }, 405)
  if (!env.WAITLIST) return json({ error: "unavailable" }, 503)
  let body
  try { body = await request.json() } catch { return json({ error: "invalid" }, 400) }
  if (!body || typeof body !== "object") return json({ error: "invalid" }, 400)
  if (body.company) return json({ ok: true })
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
  if (email.length > 254 || !EMAIL.test(email)) return json({ error: "invalid" }, 400)
  const key = `email:${email}`
  if (!(await env.WAITLIST.get(key))) await env.WAITLIST.put(key, JSON.stringify({ date: new Date().toISOString().slice(0, 10) }))
  return json({ ok: true })
}

export const onRequest = ({ request, env }) => handle(request, env)
