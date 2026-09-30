// GET /api/price -> {"country": "DE", "price": ["EUR", "39.99", "6.99", "44.99"]}: Apple's prices for the visitor's
// storefront, by the country Cloudflare sees for the request (cf.country; nothing is stored). Table: prices.json,
// built by scripts/site_prices.py from App Store Connect's exports. Unknown country -> Switzerland, the base prices.
import table from "../../prices.json"

export const onRequestGet = ({ request }) => {
  const c = request.cf && table[request.cf.country] ? request.cf.country : "CH"
  return new Response(JSON.stringify({ country: c, price: table[c] }), {
    headers: { "content-type": "application/json", "cache-control": "private, max-age=3600" },
  })
}
