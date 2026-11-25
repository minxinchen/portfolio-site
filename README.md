# Nio portfolio-site

Static portfolio with WP Search Lab, deployed through GitHub → Cloudflare Pages.

## WP Search Lab

- Homepage links directly to `/tools/wp-search-lab/`.
- Case study: `/projects/wp-search-lab.html`.
- Editable source: `tools/wp-search-lab/src/`; the generated self-contained HTML is committed in `public/tools/wp-search-lab/index.html`.
- `npm ci && npm run build` rebuilds the artifact. `npm test` checks the analysis engine and retrieval boundaries.
- `functions/api/inspect-page.js`, `functions/api/discover-sitemap.js`, and `functions/api/pagespeed.js` provide same-origin POST endpoints (`Origin` + `Sec-Fetch-Site` validation and per-IP sliding-window rate limiting in `functions/_lib/net.js`; Cloudflare WAF rate-limiting rules can be layered on top for multi-isolate enforcement). Optional `PSI_API_KEY` env var increases PageSpeed Insights quota. Cloudflare Pages deploys with repository root as project root and `public` as output. `public/_routes.json` limits Function invocation to `/api/*`.
- Public URLs are fetched without credentials; each redirect and DNS address is checked. Maximum 5 redirects, 15 seconds, and 2 MiB HTML. No input HTML is executed, stored in a database, or sent to an LLM.
- URL mode reads the server HTML, not a rendered browser DOM. Authentication, bot challenges, JavaScript-only content and upstream failures remain explicit limitations. DNS preflight is defense in depth, not DNS pinning. No custom internal networking bindings are used.
- The downloaded HTML supports local file import. Live URL retrieval needs the hosted Function.

## References reviewed (2026-11-25)

- [Cloudflare Pages Functions](https://developers.cloudflare.com/pages/functions/get-started/) and [routing](https://developers.cloudflare.com/pages/functions/routing/): official implementation documentation checked with Context7.
- [Cloudflare Browser Run](https://github.com/cloudflare/browser-run), Apache-2.0: reviewed as a rendered-DOM alternative; not installed or enabled.
- [Jina Reader](https://github.com/jina-ai/reader), Apache-2.0: reviewed as an external retrieval service; not called by this application.
- Existing parse5 HTML analysis is retained; runtime license texts are embedded in the application and preserved under `tools/wp-search-lab/licenses/`.
- [samclarke/robots-parser](https://github.com/samclarke/robots-parser), MIT: zero-dependency `robots.txt` and Sitemap directive parser used in online URL audits.
- [mozilla/readability](https://github.com/mozilla/readability) (`@mozilla/readability`), Apache-2.0: browser-side main-content extraction (Firefox Reader View algorithm) for WordPress readability analysis.
- [GoogleChrome/lighthouse](https://github.com/GoogleChrome/lighthouse), Apache-2.0 (`core/audits/seo/`) and [Google Search Central](https://developers.google.com/search/docs): SEO, crawlability, and AI features guideline references.
- [Google PageSpeed Insights API v5](https://developers.google.com/speed/docs/insights/v5/get-started): mobile Performance & Core Web Vitals (`LCP`, `CLS`, `TBT`, `FCP`) diagnostics.
