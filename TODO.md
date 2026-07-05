# TokenWatch — ToDos

## Critical bugs

### STALE CACHE — column misalignment on returning visitors
**Status**: ✅ FIXED. Cache-busting query strings added to `app.js` and `styles.css` in `index.html` (currently `?v=20260705c`). Update the version string on each deploy that changes CSS/JS.

### MOBILE RESPONSIVE LAYOUT
The 10-column table is too wide for mobile screens. Needs work:
- Table is too wide for mobile screens
- Horizontal scroll fallback is functional but not great
- Consider card layout on mobile (≤640px)
- Usage grid stacking needs testing


## Planned features

### ZDR (Zero Data Retention) — ✅ IMPLEMENTED
**Status**: Implemented. 634 of 891 models (71%) tagged ZDR.

**What's done**:
- Pipeline: two-stage ZDR tagging via OpenRouter `/api/v1/endpoints/zdr` (endpoint-level) + `/api/frontend/all-providers` (provider-level fallback)
- Manual providers: privacy policies reviewed for Crof (ZDR), Lilac (ZDR), Synthetic (ZDR), Makora (ZDR on PAYG), Hyper (not ZDR, 30d retention), OpenCode (not ZDR), Xiaomi (not ZDR)
- `MANUAL_PROVIDER_META` enriched with `retains_prompts`, `may_train`, `retention_days`, `headquarters`, `datacenters`
- Frontend: green ZDR badge on provider cells, "ZDR only" filter checkbox, ZDR row in compare modal, URL hash `#zdr=1`
- API: `?zdr=true` filter on `/api/v1/models`, `zdr` field on `/api/v1/models/:id/providers` response
- `providers_meta` includes `retains_prompts`, `may_train`, `retention_days` for 85 providers

**Remaining**:
- EmberCloud ZDR status not yet determined (no policy URLs reviewed)
- Tooltip showing retention policy details on hover (currently badge only)
- Data retention info in comparison modal (ZDR badge shown, retention days not displayed)

### Auth-gated direct providers (A1 — postponed)
Cerebras, Groq, Together, SiliconFlow, Fireworks, Baseten, Hyperbolic, Replicate, Mistral all have auth-gated `/v1/models` endpoints. All are already covered as OpenRouter backends (Tier 2). Direct fetch would give Tier-1 precedence + fresher data, not new model coverage. Postponed until user has API keys.

### Historical price tracking (A7 — not started)
Store daily pricing.json snapshots to enable price-drop alerts, trend charts, and "cheapest this model has ever been" features. Would require a `pricing-history/` archive or Cloudflare D1/KV storage.

### EmberCloud provider metadata
`MANUAL_PROVIDER_META` for ember has privacy/ToS URLs filled but no HQ/datacenters — update if available.

### Turbo/preview model grouping
Currently turbo and preview variants are kept separate. Could add UI to group them with their base model.

### Cache write in cost computation
Currently display-only. Could add a separate "cache write tokens (one-time)" input with amortization over N requests.
