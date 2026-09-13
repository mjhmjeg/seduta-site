# Seduta's pages

`seduta.spert.ai`: the home page, the privacy policy and the support page App Store Connect asks for, and `auth.html`,
the EUrouter connect bounce (a copy of `server/auth/index.html`; `Connect.callback` points at `https://seduta.spert.ai/auth.html`
once this is live).

Static files, no build step. Deployed to Cloudflare Pages (project `seduta-site`, account mj@spert.ai), live at
https://seduta-site.pages.dev and seduta.spert.ai (CNAME to `seduta-site.pages.dev`). To publish a change:

    npx wrangler pages deploy server/site --project-name seduta-site --branch main --commit-dirty=true

The folder is also mirrored to https://github.com/mjhmjeg/seduta-site (public, only these files), remote `site`:
`git subtree push --prefix=server/site site main`. Nothing reads from it yet.
