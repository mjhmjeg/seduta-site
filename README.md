# Seduta's pages

`seduta.spert.ai`: the home page, the privacy policy and the support page App Store Connect asks for, and `auth.html`,
the EUrouter connect bounce (a copy of `server/auth/index.html`; `Connect.callback` points at `https://seduta.spert.ai/auth.html`
once this is live).

Static files, no build step. Deploy to deploybase (EU) with its MCP server, which needs an API key only Martijn has:

1. In the deploybase dashboard create an API key (`dbk_…`).
2. Add the server to Claude Code with `claude mcp add deploybase -e DEPLOYBASE_API_KEY=dbk_… -e DEPLOYBASE_API_URL=https://api.deploybase.eu -- deploybase-mcp --transport stdio`
   (install `deploybase-mcp` first as their docs say: https://docs.deploybase.eu/mcp/).
3. Then in a session: `create_project` (static, root `server/site`), `trigger_deployment`, `add_domain` for `seduta.spert.ai`,
   and set the DNS record `get_dns_instructions` returns.

Cloudflare Pages works the same way if deploybase is not ready: dashboard › Workers & Pages › Upload assets, drag this folder.
