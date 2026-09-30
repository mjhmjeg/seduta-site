// Checks the waitlist function with a fake in-memory KV. Run from server/site: `node test/waitlist.test.mjs`.
import assert from "node:assert/strict"
import { handle } from "../functions/api/waitlist.js"

const kv = () => {
  const m = new Map()
  return { get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, v), m }
}
const post = (env, body, method = "POST") =>
  handle(new Request("https://seduta.spert.ai/api/waitlist", { method, body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined }), env)
const today = new Date().toISOString().slice(0, 10)

let env = { WAITLIST: kv() }
let r = await post(env, { email: "  Ann@Example.COM ", company: "" })
assert.equal(r.status, 200)
assert.deepEqual(await r.json(), { ok: true })
assert.equal(r.headers.get("content-type"), "application/json")
assert.equal(r.headers.get("cache-control"), "no-store")
assert.deepEqual([...env.WAITLIST.m.keys()], ["email:ann@example.com"])
assert.deepEqual(JSON.parse(env.WAITLIST.m.get("email:ann@example.com")), { date: today }) // the date and nothing else

env.WAITLIST.m.set("email:ann@example.com", JSON.stringify({ date: "2020-01-01" }))
r = await post(env, { email: "ann@example.com", company: "" })
assert.equal(r.status, 200)
assert.equal(env.WAITLIST.m.get("email:ann@example.com"), '{"date":"2020-01-01"}') // first date kept

env = { WAITLIST: kv() }
r = await post(env, { email: "bot@example.com", company: "Acme" })
assert.equal(r.status, 200)
assert.equal(env.WAITLIST.m.size, 0)

for (const bad of [{ email: "nope", company: "" }, { email: "a@b", company: "" }, { email: "a".repeat(250) + "@b.co" }, { company: "" }, { email: 5 }, "{not json", "null"]) {
  r = await post(env, bad)
  assert.equal(r.status, 400, JSON.stringify(bad))
  assert.deepEqual(await r.json(), { error: "invalid" })
}
assert.equal(env.WAITLIST.m.size, 0)

r = await post(env, null, "GET")
assert.equal(r.status, 405)

r = await post({}, { email: "ann@example.com", company: "" })
assert.equal(r.status, 503)
assert.deepEqual(await r.json(), { error: "unavailable" })

console.log("waitlist: ok")
