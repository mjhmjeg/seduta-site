// Seduta Plus: turns an App Store subscription into an EUrouter key that belongs to that one subscriber, and takes
// the key away when the subscription ends. Summaries go from the app straight to EUrouter; EUrouter enforces the cap.
// Served by Cloudflare Pages Functions at https://seduta.spert.ai/api/* (README.md has the deploy steps).
//
//   POST /api/key     {"jws": "<StoreKit 2 Transaction.jwsRepresentation>"}  ->  200 {key, limit, resets}
//                     errors {"error"}: 400 bad input, 402 expired/refunded, 429 too many requests, 502 EUrouter
//   POST /api/notify  App Store Server Notifications V2 (production and sandbox send to the same URL)
//
// No database: the key is named after the subscription, so EUrouter's key list is the record of who has one.
// One secret, EUROUTER_MANAGEMENT_KEY (a Pages secret, never in this public folder).

/// Credits a month per product (≈ €4, decision of 2026-09-30). Anything not listed is refused.
export const CAP = {
  "ai.spert.seduta.plus.monthly": 4.7,
  "ai.spert.seduta.plus.yearly": 4.7,
}

export const BUNDLE_ID = "ai.spert.MeetingTranscriber"
// TODO(Martijn): the app's Apple ID, a number: App Store Connect › Seduta › App Information › Apple ID.
// Apple's library refuses to build a Production verifier without it; until it is set, only Sandbox (TestFlight,
// App Review) transactions are accepted.
export const APP_APPLE_ID = undefined

const EUROUTER = "https://api.eurouter.ai/api/v1"
const MIN_KEY_AGE_MS = 60_000
const INVALID_ENVIRONMENT = 4 // VerificationStatus.INVALID_ENVIRONMENT in the library
const REVOKING = ["EXPIRED", "REFUND", "REVOKE", "GRACE_PERIOD_EXPIRED"]

// Apple Root CA - G3, the root of every App Store signature. The same bytes as AppleRootCA-G3.cer next to this
// file, downloaded from https://www.apple.com/certificateauthority/ (SHA-256 63:34:3A:BF:…:3E:91:79); the test
// checks they match. Inlined because Pages Functions cannot import a .cer file.
const APPLE_ROOT_CA_G3 =
  "MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwSQXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQL" +
  "DB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcNMTQwNDMw" +
  "MTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBSb290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRp" +
  "ZmljYXRpb24gQXV0aG9yaXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49AgEGBSuBBAAiA2IA" +
  "BJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtfTjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqX" +
  "l5dvMVztK517IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySrMA8GA1UdEwEB/wQFMAMBAf8w" +
  "DgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gAMGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWT" +
  "xnS4at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM6BgD56KyKA=="
export const APPLE_ROOTS = [APPLE_ROOT_CA_G3]

/// Production first, then Sandbox (TestFlight and App Review). Xcode and LocalTesting data is not signed by
/// Apple (the library skips the signature for them), so no verifier is ever built for those environments and such
/// a transaction fails both checks.
// Online checks (OCSP) are off: they would call Apple's OCSP responder through node-fetch on every cold start,
// and Workers keep no cache between isolates. Off, the chain is checked against the root as of the transaction's
// signing date, which is Apple's documented offline mode.
// The library is loaded on the first request: its jsrsasign dependency draws random numbers when it loads, which
// Workers forbid outside a request.
export async function makeVerifiers(roots = APPLE_ROOTS, appAppleId = APP_APPLE_ID) {
  const { SignedDataVerifier, Environment } = await import("@apple/app-store-server-library")
  const certs = roots.map((cert) => Buffer.from(cert, "base64"))
  const verifiers = []
  if (appAppleId !== undefined) {
    verifiers.push(new SignedDataVerifier(certs, false, Environment.PRODUCTION, BUNDLE_ID, appAppleId))
  }
  verifiers.push(new SignedDataVerifier(certs, false, Environment.SANDBOX, BUNDLE_ID))
  return verifiers
}

let defaultVerifiers
export const onRequest = ({ request, env }) => handle(request, env, (defaultVerifiers ||= makeVerifiers()))

export async function handle(request, env, verifiersPromise) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405)
  const path = new URL(request.url).pathname.replace(/\/+$/, "")
  let body
  try {
    if (Number(request.headers.get("content-length") || 0) > 64_000) throw new Error("too large")
    body = await request.json()
  } catch {
    return json({ error: "the body must be JSON" }, 400)
  }
  const verifiers = await verifiersPromise
  try {
    if (path === "/api/key") return await mint(body, env, verifiers)
    if (path === "/api/notify") return await notify(body, env, verifiers)
    return json({ error: "not found" }, 404)
  } catch (error) {
    if (error instanceof EUrouterError) {
      console.error(error.message)
      return json({ error: "the key service is unavailable, try again later" }, 502)
    }
    throw error
  }
}

/// Verifies the transaction with Apple, then hands back a new key for this subscriber.
async function mint(body, env, verifiers) {
  if (typeof body?.jws !== "string" || !body.jws) return json({ error: "no transaction" }, 400)
  const transaction = await verify(verifiers, (v) => v.verifyAndDecodeTransaction(body.jws))
  if (!transaction) return json({ error: "the transaction could not be verified" }, 400)

  const cap = CAP[transaction.productId]
  if (!cap) return json({ error: "not a Seduta Plus subscription" }, 400)
  if (transaction.revocationDate) return json({ error: "this subscription was refunded" }, 402)
  if (!transaction.expiresDate || transaction.expiresDate < Date.now()) return json({ error: "this subscription has expired" }, 402)

  const name = keyName(transaction)
  const now = Date.now()
  const existing = await find(name, env)
  if (existing.some((key) => now - Date.parse(key.created_at) < MIN_KEY_AGE_MS)) {
    return json({ error: "a key was issued less than a minute ago" }, 429)
  }

  // A key is shown only once, so a second call means the app lost it: the old key goes. A fresh key would start
  // the month at zero, so what the old keys spent this month comes off the new key's limit.
  const limit = round(cap - spentThisMonth(existing, cap, now))
  if (limit <= 0) return json({ error: "this month's allowance is used up" }, 429)
  for (const key of existing) await remove(key.hash, env)

  const response = await eurouter("/keys", env, {
    method: "POST",
    body: JSON.stringify({ name, type: "inference", limit, limit_reset: "monthly" }),
  })
  if (!response.ok) throw new EUrouterError(`create said ${response.status}`)
  const created = await response.json()

  // Two requests at the same moment both pass the check above. The first key created wins; any other deletes
  // itself, so one subscription never holds two keys.
  const siblings = await find(name, env)
  const winner = siblings.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.hash.localeCompare(b.hash))[0]
  if (winner && winner.hash !== created.data?.hash) {
    await remove(created.data?.hash, env)
    return json({ error: "a key was issued less than a minute ago" }, 429)
  }
  return json({ key: created.key, limit, resets: "monthly" })
}

/// Apple tells us when a subscription lapses, is refunded or revoked; the key goes with it. A renewal puts a key
/// whose limit was cut by a replacement back to the full allowance.
async function notify(body, env, verifiers) {
  if (typeof body?.signedPayload !== "string") return json({ error: "no signedPayload" }, 400)
  const payload = await verify(verifiers, (v) => v.verifyAndDecodeNotification(body.signedPayload))
  if (!payload) return json({ error: "the notification could not be verified" }, 400)

  const type = payload.notificationType
  const signed = payload.data?.signedTransactionInfo
  if (!signed || !(REVOKING.includes(type) || type === "DID_RENEW")) return json({ ok: true, ignored: type })
  const transaction = await verify(verifiers, (v) => v.verifyAndDecodeTransaction(signed))
  if (!transaction) return json({ error: "the transaction could not be verified" }, 400)

  const existing = await find(keyName(transaction), env)
  if (type === "DID_RENEW") {
    const cap = CAP[transaction.productId]
    const month = monthStart(Date.now())
    let restored = 0
    for (const key of existing) {
      if (cap && key.limit < cap && Date.parse(key.created_at) < month) {
        // ponytail: PATCH /keys/{hash} is live on EUrouter (it validates limit, limit_reset, disabled) but not in
        // their published docs yet; if it goes away, cut keys stay cut until the app asks for a new key.
        const response = await eurouter(`/keys/${key.hash}`, env, { method: "PATCH", body: JSON.stringify({ limit: cap }) })
        if (!response.ok) throw new EUrouterError(`update said ${response.status}`)
        restored++
      }
    }
    return json({ ok: true, restored })
  }
  for (const key of existing) await remove(key.hash, env)
  return json({ ok: true, revoked: existing.length })
}

/// Tries each environment's verifier in order. Only a wrong environment moves on to the next one; a bad signature,
/// a wrong app or anything else is a refusal.
async function verify(verifiers, decode) {
  for (const verifier of verifiers) {
    try {
      return await decode(verifier)
    } catch (error) {
      if (error?.status === INVALID_ENVIRONMENT) continue
      return null
    }
  }
  return null
}

/// Sandbox and production transaction ids come from separate ranges in practice, but Apple does not promise it,
/// so a sandbox key carries the environment in its name.
export function keyName(transaction) {
  const prefix = transaction.environment === "Production" ? "seduta" : "seduta-sandbox"
  return `${prefix}-${transaction.originalTransactionId}`
}

/// Credits this subscriber's keys have spent since the start of the UTC month (EUrouter resets at midnight UTC).
/// A key created this month has a limit of cap minus what earlier keys had spent, so that part carries forward.
export function spentThisMonth(keys, cap, now) {
  const month = monthStart(now)
  let carried = 0
  let used = 0
  for (const key of keys) {
    used += Number(key.usage_monthly) || 0
    if (Date.parse(key.created_at) >= month && typeof key.limit === "number") carried = Math.max(carried, cap - key.limit)
  }
  return carried + used
}

function monthStart(now) {
  const date = new Date(now)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
}

/// Every key with this name. EUrouter pages the list with `offset`; the page size is not documented.
// ponytail: reads the whole list. Fine for hundreds of subscribers; ask EUrouter for a name filter past that.
async function find(name, env) {
  const found = []
  for (let offset = 0, page = 0; page < 100; page++) {
    const response = await eurouter(`/keys?offset=${offset}`, env)
    if (!response.ok) throw new EUrouterError(`list said ${response.status}`)
    const { data } = await response.json()
    if (!data?.length) break
    found.push(...data.filter((key) => key.name === name))
    offset += data.length
  }
  return found
}

async function remove(hash, env) {
  const response = await eurouter(`/keys/${hash}`, env, { method: "DELETE" })
  if (!response.ok && response.status !== 404) throw new EUrouterError(`delete said ${response.status}`)
}

async function eurouter(path, env, options = {}) {
  if (!env.EUROUTER_MANAGEMENT_KEY) throw new EUrouterError("EUROUTER_MANAGEMENT_KEY is not set")
  try {
    return await fetch(EUROUTER + path, {
      ...options,
      headers: { Authorization: `Bearer ${env.EUROUTER_MANAGEMENT_KEY}`, "Content-Type": "application/json" },
    })
  } catch (error) {
    throw new EUrouterError(`${path}: ${error.message}`)
  }
}

class EUrouterError extends Error {}

const round = (credits) => Math.round(credits * 100) / 100

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}
