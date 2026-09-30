// A made-up certificate chain shaped like Apple's (root → intermediate with Apple's WWDR marker → leaf with Apple's
// App Store marker), for signing test transactions. Uses the openssl command line; nothing here is Apple's.
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createSign } from "node:crypto"

export function makeChain() {
  const dir = mkdtempSync(join(tmpdir(), "seduta-fake-apple-"))
  const f = (name) => join(dir, name)
  const ssl = (...args) => execFileSync("openssl", args, { stdio: "pipe" })
  writeFileSync(f("ext.cnf"), [
    "[inter]", "basicConstraints=critical,CA:true", "1.2.840.113635.100.6.2.1=ASN1:NULL",
    "[leaf]", "basicConstraints=critical,CA:false", "1.2.840.113635.100.6.11.1=ASN1:NULL", "",
  ].join("\n"))
  for (const name of ["root", "inter", "leaf"]) ssl("ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", f(`${name}.key`))
  ssl("req", "-new", "-x509", "-key", f("root.key"), "-subj", "/CN=Fake Root", "-days", "30", "-out", f("root.pem"))
  ssl("req", "-new", "-key", f("inter.key"), "-subj", "/CN=Fake Intermediate", "-out", f("inter.csr"))
  ssl("x509", "-req", "-in", f("inter.csr"), "-CA", f("root.pem"), "-CAkey", f("root.key"), "-CAcreateserial", "-days", "30",
    "-extfile", f("ext.cnf"), "-extensions", "inter", "-out", f("inter.pem"))
  ssl("req", "-new", "-key", f("leaf.key"), "-subj", "/CN=Fake Leaf", "-out", f("leaf.csr"))
  ssl("x509", "-req", "-in", f("leaf.csr"), "-CA", f("inter.pem"), "-CAkey", f("inter.key"), "-CAcreateserial", "-days", "30",
    "-extfile", f("ext.cnf"), "-extensions", "leaf", "-out", f("leaf.pem"))
  const der = (name) => ssl("x509", "-in", f(`${name}.pem`), "-outform", "DER").toString("base64")
  const chain = { root: der("root"), x5c: [der("leaf"), der("inter"), der("root")], key: readFileSync(f("leaf.key"), "utf8") }
  rmSync(dir, { recursive: true, force: true })
  return chain
}

/// Signs a payload as an ES256 JWS with the chain in its x5c header, the way the App Store does.
export function sign(chain, payload) {
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url")
  const input = `${b64({ alg: "ES256", x5c: chain.x5c })}.${b64(payload)}`
  const signature = createSign("SHA256").update(input).sign({ key: chain.key, dsaEncoding: "ieee-p1363" })
  return `${input}.${signature.toString("base64url")}`
}

export function transaction(overrides = {}) {
  const now = Date.now()
  return {
    transactionId: "2000000000000002", originalTransactionId: "2000000000000001",
    bundleId: "ai.spert.MeetingTranscriber", productId: "ai.spert.seduta.plus.monthly",
    purchaseDate: now - 3_600_000, originalPurchaseDate: now - 3_600_000, expiresDate: now + 7 * 86_400_000,
    type: "Auto-Renewable Subscription", inAppOwnershipType: "PURCHASED", environment: "Production", signedDate: now,
    ...overrides,
  }
}

export function notification(chain, notificationType, signedTransactionInfo, environment = "Production") {
  return sign(chain, {
    notificationType, notificationUUID: "00000000-0000-4000-8000-000000000000", version: "2.0", signedDate: Date.now(),
    data: { bundleId: "ai.spert.MeetingTranscriber", appAppleId: 1234, environment, signedTransactionInfo },
  })
}
