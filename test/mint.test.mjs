// Checks the mint function without Apple or EUrouter: a made-up certificate chain stands in for Apple's, and a
// mocked fetch stands in for EUrouter. Run from server/site: `npm test` (needs node 20+ and openssl).
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { makeChain, sign, transaction, notification } from "./fake-apple.mjs"
import { handle, makeVerifiers, CAP, SANDBOX_CAP, APPLE_ROOTS, APP_APPLE_ID } from "../functions/api/[[path]].js"

const chain = makeChain()
const verifiers = await makeVerifiers([chain.root], 1234)
const env = { EUROUTER_MANAGEMENT_KEY: "test" }
const MINUTE = 60_000

/// A fake EUrouter: a key list, and a log of every call.
function eurouter(keys = []) {
  const calls = []
  let n = 0
  globalThis.fetch = async (url, options = {}) => {
    const method = options.method || "GET"
    const path = new URL(url).pathname.replace("/api/v1", "")
    calls.push(`${method} ${path}`)
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status })
    if (method === "GET") return reply({ data: new URL(url).searchParams.get("offset") === "0" ? keys : [] })
    if (method === "DELETE") {
      keys.splice(keys.findIndex((k) => path.endsWith(k.hash)), 1)
      return reply({ data: { success: true } })
    }
    if (method === "POST") {
      const body = JSON.parse(options.body)
      const created = { ...body, hash: `new${++n}`, created_at: new Date().toISOString(), usage_monthly: 0 }
      keys.push(created)
      return reply({ data: created, key: "sk-new" })
    }
    if (method === "PATCH") {
      Object.assign(keys.find((k) => path.endsWith(k.hash)), JSON.parse(options.body))
      return reply({ data: {} })
    }
  }
  return { calls, keys }
}

const post = (path, body) =>
  handle(new Request(`http://x${path}`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }), env, verifiers)
const mint = (tx) => post("/api/key", { jws: sign(chain, transaction(tx)) })
const read = async (response) => ({ status: response.status, ...(await response.json()) })
const key = (fields) => ({ name: "seduta-2000000000000001", hash: "old", limit: 4.7, usage_monthly: 0, ...fields })

const tests = {
  "the product table: both Plus plans at 4.70 credits a month, nothing else"() {
    assert.deepEqual(CAP, { "ai.spert.seduta.plus.monthly": 4.7, "ai.spert.seduta.plus.yearly": 4.7 })
  },
  async "monthly and yearly get a key with the cap"() {
    for (const productId of Object.keys(CAP)) {
      const { calls } = eurouter()
      const out = await read(await mint({ productId }))
      assert.deepEqual(out, { status: 200, key: "sk-new", limit: 4.7, resets: "monthly" })
      assert.ok(calls.includes("POST /keys"))
    }
  },
  async "the unlock or any other product is refused without calling EUrouter"() {
    const { calls } = eurouter()
    assert.equal((await mint({ productId: "ai.spert.seduta.unlock" })).status, 400)
    assert.deepEqual(calls, [])
  },
  async "a transaction signed by anyone but the trusted root is refused before EUrouter"() {
    const { calls } = eurouter()
    const stranger = makeChain()
    assert.equal((await post("/api/key", { jws: sign(stranger, transaction()) })).status, 400)
    assert.equal((await post("/api/key", { jws: "not.a.jws" })).status, 400)
    assert.deepEqual(calls, [])
  },
  async "bad input"() {
    eurouter()
    assert.equal((await post("/api/key", {})).status, 400)
    assert.equal((await post("/api/key", "{nope")).status, 400)
    assert.equal((await handle(new Request("http://x/api/key"), env, verifiers)).status, 405)
    assert.equal((await post("/api/other", {})).status, 404)
  },
  async "environments: Production, then Sandbox; Xcode and LocalTesting never"() {
    assert.equal(verifiers.length, 2)
    assert.equal(verifiers[0].environment, "Production")
    assert.equal(verifiers[1].environment, "Sandbox")
    let fake = eurouter()
    assert.equal((await mint({ environment: "Production" })).status, 200)
    assert.equal(fake.keys[0].name, "seduta-2000000000000001")
    fake = eurouter()
    assert.equal((await mint({ environment: "Sandbox" })).status, 200)
    assert.equal(fake.keys[0].name, "seduta-sandbox-2000000000000001")
    assert.equal(fake.keys[0].limit, 1)
    for (const environment of ["Xcode", "LocalTesting"]) {
      fake = eurouter()
      assert.equal((await mint({ environment })).status, 400)
      assert.deepEqual(fake.calls, [])
    }
  },
  async "without the app's Apple ID only Sandbox is verified"() {
    const sandboxOnly = await makeVerifiers([chain.root], undefined)
    assert.deepEqual(sandboxOnly.map((v) => v.environment), ["Sandbox"])
  },
  async "expired and refunded subscriptions get 402"() {
    eurouter()
    assert.equal((await mint({ expiresDate: Date.now() - 1000 })).status, 402)
    assert.equal((await mint({ revocationDate: Date.now() - 1000 })).status, 402)
  },
  async "429 when this subscription's key is less than 60 s old; nothing is deleted or created"() {
    const { calls } = eurouter([key({ created_at: new Date(Date.now() - 10_000).toISOString() })])
    assert.equal((await mint()).status, 429)
    assert.deepEqual(calls, ["GET /keys", "GET /keys"])
  },
  async "an older key is replaced, and what it spent this month comes off the new limit"() {
    const { calls, keys } = eurouter([key({ created_at: new Date(Date.now() - 2 * MINUTE).toISOString(), usage_monthly: 1.2 })])
    const out = await read(await mint())
    assert.equal(out.status, 200)
    assert.ok(Math.abs(out.limit - 3.5) < 1e-9)
    assert.ok(calls.includes("DELETE /keys/old"))
    assert.deepEqual(keys.map((k) => k.hash), ["new1"])
  },
  async "replacing a replacement keeps counting the month (no reset by asking again)"() {
    // created this month with limit 3.5, so 1.2 was spent before it; it has since spent 3.0 more
    const thisMonth = new Date(Date.now() - 2 * MINUTE)
    if (thisMonth.getUTCMonth() !== new Date().getUTCMonth()) return // first two minutes of a month
    eurouter([key({ created_at: thisMonth.toISOString(), limit: 3.5, usage_monthly: 3.0 })])
    const out = await read(await mint())
    assert.ok(Math.abs(out.limit - 0.5) < 1e-9, `limit ${out.limit}`)
    eurouter([key({ created_at: thisMonth.toISOString(), limit: 3.5, usage_monthly: 3.5 })])
    assert.equal((await mint()).status, 429)
  },
  async "two keys at once: the later one deletes itself"() {
    const { keys } = eurouter()
    const rival = key({ hash: "aaa", created_at: new Date(Date.now() - 1).toISOString() })
    const realFetch = globalThis.fetch
    globalThis.fetch = async (url, options = {}) => {
      const response = await realFetch(url, options)
      if (options.method === "POST") keys.push(rival) // the rival appears between our check and our create
      return response
    }
    assert.equal((await mint()).status, 429)
    assert.deepEqual(keys.map((k) => k.hash), ["aaa"])
  },
  async "EUrouter failing gives 502"() {
    globalThis.fetch = async () => new Response("{}", { status: 500 })
    assert.equal((await mint()).status, 502)
    globalThis.fetch = async () => { throw new Error("offline") }
    assert.equal((await mint()).status, 502)
  },
  async "notifications: EXPIRED, REFUND, REVOKE, GRACE_PERIOD_EXPIRED delete the key; others are ignored"() {
    for (const type of ["EXPIRED", "REFUND", "REVOKE", "GRACE_PERIOD_EXPIRED"]) {
      const { keys } = eurouter([key({ created_at: "2026-01-01T00:00:00Z" })])
      const out = await read(await post("/api/notify", { signedPayload: notification(chain, type, sign(chain, transaction())) }))
      assert.deepEqual([out.status, out.revoked, keys.length], [200, 1, 0], type)
    }
    const { calls } = eurouter([key({ created_at: "2026-01-01T00:00:00Z" })])
    assert.equal((await post("/api/notify", { signedPayload: notification(chain, "SUBSCRIBED", sign(chain, transaction())) })).status, 200)
    assert.deepEqual(calls, [])
    assert.equal((await post("/api/notify", { signedPayload: notification(makeChain(), "REFUND", "x") })).status, 400)
  },
  async "a sandbox notification revokes the sandbox key"() {
    const { keys } = eurouter([key({ name: "seduta-sandbox-2000000000000001", created_at: "2026-01-01T00:00:00Z" })])
    const tx = sign(chain, transaction({ environment: "Sandbox" }))
    assert.equal((await post("/api/notify", { signedPayload: notification(chain, "EXPIRED", tx, "Sandbox") })).status, 200)
    assert.equal(keys.length, 0)
  },
  async "self-healing: a key cut in an earlier month is replaced with the cap minus this month's spend"() {
    const { keys } = eurouter([key({ created_at: "2026-01-01T00:00:00Z", limit: 1.5, usage_monthly: 0.2 })])
    const out = await read(await mint())
    assert.equal(out.status, 200)
    assert.ok(Math.abs(out.limit - 4.5) < 1e-9, `limit ${out.limit}`)
    assert.deepEqual(keys.map((k) => k.hash), ["new1"])
  },
  async "limit reached this month: 429 and the old key is kept"() {
    const created_at = new Date(Date.now() - 2 * MINUTE).toISOString()
    if (new Date(created_at).getUTCMonth() !== new Date().getUTCMonth()) return
    const { calls, keys } = eurouter([key({ created_at, limit: 4.7, usage_monthly: 4.7 })])
    assert.equal((await mint()).status, 429)
    assert.deepEqual(calls, ["GET /keys", "GET /keys"])
    assert.equal(keys.length, 1)
  },
  async "Sandbox keys get 1.00 a month, Production 4.70"() {
    for (const productId of Object.keys(CAP)) {
      eurouter()
      assert.equal((await read(await mint({ productId, environment: "Sandbox" }))).limit, 1)
      eurouter()
      assert.equal((await read(await mint({ productId, environment: "Production" }))).limit, 4.7)
    }
    assert.equal(SANDBOX_CAP, 1)
  },
  async "Sandbox carry-over counts against 1.00"() {
    eurouter([key({ name: "seduta-sandbox-2000000000000001", created_at: "2026-01-01T00:00:00Z", usage_monthly: 0.4 })])
    assert.ok(Math.abs((await read(await mint({ environment: "Sandbox" }))).limit - 0.6) < 1e-9)
  },
  async "renewals are ignored (no PATCH)"() {
    const { calls } = eurouter([key({ created_at: "2026-01-01T00:00:00Z", limit: 1.5 })])
    await post("/api/notify", { signedPayload: notification(chain, "DID_RENEW", sign(chain, transaction())) })
    assert.deepEqual(calls, [])
  },
  "the inlined Apple root is the committed AppleRootCA-G3.cer"() {
    const file = readFileSync(new URL("../functions/api/AppleRootCA-G3.cer", import.meta.url)).toString("base64")
    assert.equal(APPLE_ROOTS[0], file)
  },
}

let failed = 0
for (const [name, test] of Object.entries(tests)) {
  try {
    await test()
    console.log(`ok    ${name}`)
  } catch (error) {
    failed++
    console.log(`FAIL  ${name}\n      ${error.message}`)
  }
}
if (APP_APPLE_ID === undefined) console.log("WARN  APP_APPLE_ID is not set: production purchases are refused until it is")
process.exit(failed ? 1 : 0)
