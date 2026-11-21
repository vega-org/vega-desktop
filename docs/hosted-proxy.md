# Hosted web proxy

The web app recommends the browser extension when adding a source or installing a
provider. **Skip and use proxy** remembers the choice in this browser and resumes
setup. An installed extension takes precedence over the proxy. Desktop and TV
networking are unchanged.

The Worker entry point is `workers/web.mjs`. It serves the existing static assets
and `/api/proxy/*` on `web.vega-app.in`, using the same hostname and browser cookies
as the application. A static-only deployment does not provide proxy functionality.
Vite dev/preview also serves only the frontend; use Wrangler for a real proxy.

## Deployment

1. Set `PROXY_SECRET` as a Worker secret (at least 32 random characters), using
   `npx wrangler secret put PROXY_SECRET`. Keep the secret stable across releases;
   rotating it expires existing sessions and media links.
2. All public HTTPS provider, manifest, redirect, video CDN and subtitle domains
   are supported without per-provider configuration. Port 443 is required.
   Private/local destinations and requests back to the Vega app are blocked.
3. Build and deploy with `npm run deploy:web`. Wrangler installs the assets and
   rate-limit binding. The Worker fails closed without its secret or rate limiter.
4. In the Cloudflare dashboard for `vega-app.in`, enable **Under Attack Mode** for
   `http.host eq "web.vega-app.in"` with a configuration rule, or enable it for the
   zone if protecting every hostname is intended. Apply it to the API path too.
   A normal page visit must complete the challenge before the app calls the API.
   Do not exempt the session endpoint or media endpoint from protection.
5. Verify the deployed hostname in a clean browser: complete the challenge, skip
   the extension recommendation, install a provider, and play/seek video.
   Test HLS variants, keys and subtitles on the actual provider as well.

`workers.dev` and preview URLs are disabled so those addresses do not expose a
second proxy endpoint outside the zone WAF. WAF configuration is an account-level
setting and is **not enabled by deploying this repository**. Cloudflare documents
that Under Attack Mode can affect API requests:
https://developers.cloudflare.com/waf/tools/security-level/

An API challenge cannot be solved inside a JSON fetch. The frontend reports
expired clearance and asks the user to reload Vega. A cleared page's subsequent
same-origin calls automatically include the browser's clearance cookie; the
Worker does not try to forge or validate `cf_clearance` itself. Provider-site WAF
challenges are separate and are not cleared by verification on Vega.

## Limits and isolation

- WAF verification is an abuse barrier, not user authentication or a guarantee
  against abuse. The anonymous session endpoint relies on WAF enforcement at the
  hostname. No client secret or Origin check alone authorizes proxy use.
- Rate limit: 600 requests per minute per Cloudflare client IP, including media
  and session requests. This is a request limit, not a monthly bandwidth quota.
  Tune it for real HLS traffic and add account spending/bandwidth controls.
- Sessions last six hours and are bound to the ingress client IP. Encrypted media
  URLs require the issuing HttpOnly session cookie and expire with that session.
  Network/IP changes or expiry during playback require restarting playback.
- Provider cookies are selected by destination using the existing cookie rules;
  Vega/WAF cookies are never forwarded upstream. Metadata returns cookie updates
  to the browser's existing per-source jar. Media cookies stay in encrypted links
  for their delivery chain. Media responses never set upstream cookies on Vega.
- When a provider omits User-Agent or Accept-Language, the proxy uses the browser
  client's corresponding headers. Explicit provider headers take precedence.
  No Vega referrer, authorization or profile cookies are inherited. This improves
  ordinary HTTP compatibility but does not guarantee acceptance by a provider.
- There is no hostname allowlist. Destinations, redirects and HLS child URLs must
  use public HTTPS on port 443 and pass public IPv4/IPv6 DNS checks. Workers fetch
  resolves independently, so these checks do not pin the upstream connection and
  do not eliminate DNS rebinding risk. WAF, sessions and request/transfer limits
  remain enforced; they do not guarantee that the proxy cannot be misused.
- Metadata responses and playlists are limited to 8 MiB, JSON requests to 32 MiB,
  redirect chains to ten hops, metadata calls to 30 seconds and streamed responses
  to 2 GiB per transfer. Seeking uses Range/Content-Range; video is not transcoded.
- HLS playlist URLs, URI attributes, keys and segments are proxied. DASH manifest
  rewriting and provider interactive verification are not supported. Some providers block data-center addresses; the extension
  remains the recommended compatibility option. Review Cloudflare's current
  media-delivery terms and pricing before enabling production video traffic.

## Checks

```powershell
node --test tests/hosted-proxy.test.mjs tests/platform.test.mjs
npm run build:web
npx playwright test --config playwright.web.config.mjs tests/web-production/extension-gate.spec.mjs
npx wrangler deploy --dry-run --config wrangler.jsonc
```

The browser test stubs the API to verify the skip/install flow. The Worker tests
exercise session enforcement, redirect filtering, cookies, ranges and playlist
rewriting; they do not simulate Cloudflare's actual WAF or prove compatibility
with every provider.
