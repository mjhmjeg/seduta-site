# Seduta's pages and the Plus key endpoint

`seduta.spert.ai`: the home page, the privacy policy and the support page App Store Connect asks for, `auth.html`
(the EUrouter connect bounce, a copy of `server/auth/index.html`), and one Pages Function under `/api/`.

Cloudflare Pages project `seduta-site` (account mj@spert.ai), live at https://seduta-site.pages.dev and
seduta.spert.ai (CNAME to `seduta-site.pages.dev`). The folder is mirrored to https://github.com/mjhmjeg/seduta-site
(public), remote `site`: `git subtree push --prefix=server/site site main`. **Nothing secret goes in this folder.**

## Deploy

Wrangler takes the functions from `./functions` of the folder it runs in and its settings from `wrangler.toml`, so
it runs from this folder (from the repository root it would publish the pages without the API):

    cd server/site
    npm ci
    npm test
    npx wrangler pages deploy . --project-name seduta-site --branch main --commit-dirty=true

`wrangler.toml` names the project, publishes this folder (`pages_build_output_dir = "."`) and turns on
`nodejs_compat`, which Apple's library needs. With that file present, it holds the project's settings instead of
the dashboard. `node_modules`, `functions` and `.wrangler` are never uploaded as pages; everything else here is,
including this README and `package.json`, which are public on GitHub anyway. **Never put a `.dev.vars` file here**:
it would be published as a page.

## The Plus key endpoint (`functions/api/[[path]].js`)

It turns an App Store subscription into an EUrouter key that belongs to that one subscriber, and takes the key away
when the subscription ends. Summaries go from the app straight to EUrouter; EUrouter enforces the monthly cap.

| Call | Does |
|---|---|
| `POST /api/key` `{"jws": "<Transaction.jwsRepresentation>"}` | 200 `{"key", "limit", "resets"}`. Errors `{"error"}`: 400 bad input or unverified transaction, 402 expired or refunded, 429 a key was issued less than 60 s ago (or this month's allowance is used up), 502 EUrouter failed |
| `POST /api/notify` | App Store Server Notifications V2. EXPIRED, REFUND, REVOKE, GRACE_PERIOD_EXPIRED delete the key; others are ignored |

- **Products:** `ai.spert.seduta.plus.monthly` and `.yearly`, each 4.70 EUrouter credits a month in Production and
  1.00 in Sandbox (TestFlight, App Review), `limit_reset: "monthly"`. Anything else is refused. The 1-week trial is
  Apple's intro offer, an ordinary transaction here.
- **No database.** A key is named `seduta-<originalTransactionId>` (`seduta-sandbox-…` for Sandbox), so EUrouter's
  key list is the record. A key is shown once, so asking again replaces it. The replacement's limit is the cap minus
  what the subscriber's keys spent this month, or asking again would reset the month. The app asks when it has no
  key or when EUrouter reports the limit reached (at most once a day): a key cut in an earlier month then comes back
  at the full cap minus this month's spend; with nothing left it gets 429 and keeps its key. Two requests at the same moment: the first key created stays, the other is
  deleted and gets 429.
- **Apple:** the transaction is verified with Apple's library against Apple Root CA - G3
  (`functions/api/AppleRootCA-G3.cer`, inlined in the function), bundle id `ai.spert.MeetingTranscriber`. Production
  first, then Sandbox (TestFlight and App Review); Xcode and LocalTesting transactions are always refused. OCSP
  checks are off. The Production check needs the app's Apple ID in `APP_APPLE_ID`; until then only Sandbox works.
- **EUrouter** management API at `https://api.eurouter.ai/api/v1/keys` (list, create, delete, per
  https://www.eurouter.ai/docs/api/keys.md); only documented endpoints.

### Setup, once

1. `APP_APPLE_ID` in the function: App Store Connect › Seduta › App Information › Apple ID (a number).
2. In the EUrouter dashboard, a key of type `management`, then (from this folder):
   `npx wrangler pages secret put EUROUTER_MANAGEMENT_KEY --project-name seduta-site`
3. Deploy (above).
4. App Store Connect › Seduta › App Information › App Store Server Notifications: Version 2,
   `https://seduta.spert.ai/api/notify` for both Production and Sandbox.

### Test

`npm test` checks the product table, the environment order, the Sandbox cap, the 60 s rule, the month carry-over and self-healing, the race, the
notifications and the inlined root, with a made-up certificate chain (openssl) and a mocked EUrouter.
To try it locally: `npx wrangler pages dev --binding EUROUTER_MANAGEMENT_KEY=dummy`, then
`curl -X POST -d '{}' localhost:8788/api/key` answers 400.

### Worth knowing

- The key list is read whole on every call. Fine for hundreds of subscribers; ask EUrouter for a name filter past that.
- Refunds come late: credits already spent are gone. The monthly cap bounds that to one month per subscriber.
- Sandbox keys spend real credits, hence the 1.00 cap.
