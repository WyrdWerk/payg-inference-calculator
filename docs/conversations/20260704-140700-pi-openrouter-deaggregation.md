---
timestamp: "2026-07-04T14:07:00+05:30"
agent_id: "pi"
agent_name: "Pi (Oh My Pi)"
session_id: "payg-pricing-openrouter-deaggregation-20260704"
user: "yash"
duration_minutes: 180
topics: ["payg-inference-calculator", "openrouter-deaggregation", "llmgateway-removal", "provider-overlap-analysis", "discount-pricing", "text-only-filtering", "3-tier-precedence", "cloudflare-pages", "longevity-maintainability"]
related_repos: ["WyrdWerk/payg-inference-calculator"]
related_sessions: ["20260704-001612-pi-phase1", "20260704-021100-pi-phase2-providers"]
artifacts: []
learnings: [
  "OpenRouter /api/v1/models/{canonical_slug}/endpoints is FULLY PUBLIC — no auth, no API key needed. Earlier 404s were caused by encodeURIComponent(slug) encoding the / separator to %2F. The slug slash is a literal path segment, must NOT be encoded.",
  "OpenRouter /endpoints returns a discount field (0=structural, >0=promo fraction, e.g. 0.7=70% off). The prompt/completion prices ARE the discounted prices. No pre-discount/original price field exists in the API — do NOT compute one.",
  "OpenRouter /v1/models has architecture.output_modalities — filter to exactly ['text'] for text-only models. Allows multimodal input (text+image->text), excludes image/audio/video output.",
  "DeepInfra /v1/models has metadata.tags for structured type filtering — exclude image-gen/tts/stt/embed/embeddings/video-gen/audio. More maintainable than ID regex.",
  "LLMGateway providers[] array has per-provider pricing at zero extra API calls, but was dropped for longevity/maintainability: added dedup complexity, a breakable source, and the user explicitly deprioritized coverage over simplicity.",
  "3-tier precedence: direct providers > OpenRouter /endpoints > CSV/hardcoded. Dedup key: (canonical_model, normalized_provider, quantization). Provider-name normalization map reconciles direct keys (ember) with OpenRouter display names (EmberCloud).",
  "Voxtral (speech-to-text) has output_modalities=['text'] and accepts text input — no structural signal distinguishes it from audio-capable chat models. Accepted as a text-output model.",
  "Default 97% cache preset excludes ~40% of models (375/944) that lack cache_read pricing — correct behavior per existing design (if a provider doesn't support requested token types, that offering is excluded).",
  "~310 OpenRouter /endpoints calls at 20 concurrent takes ~15-17 seconds total. Zero rate limits observed on 50-call burst test. No rate-limit headers returned.",
  "Resilience safeguards for unattended pipeline: retry on 429/5xx (1 retry, 2s backoff), abort on >20% endpoint failure, abort on >15% coverage drop vs previous pricing.json.",
  "GITHUB_TOKEN env var overrides gh CLI keyring token — prefix push commands with env -u GITHUB_TOKEN to use the keyring token with push scope for the agentic-memory-hub repo."
]
---

## Context

Continued work on the PAYG Inference Calculator project at `~/projects/PAYGO Pricing`. This session covered: deep investigation of OpenRouter vs LLMGateway data sources, a strategic decision to de-aggregate OpenRouter and drop LLMGateway, full implementation of the de-aggregation pipeline, text-only filtering, discount/promo handling, 3-tier dedup precedence, frontend updates (quantization column, promo badges), resilience safeguards, and documentation updates.

The session began with the user asking to internalize the current state of the project (944 models, 12 providers, dual search UX). The user then directed a major architectural shift: instead of treating OpenRouter as a single provider row, de-aggregate it to surface the underlying inference providers (Fireworks, Together, Novita, SiliconFlow, etc.) as their own rows — using OpenRouter as a data source, not a provider.

## Key Discussion Points

1. **Project internalization**: Reviewed all files — fetch-pricing.mjs (486 lines, 12 providers, 3 ingestion methods), app.js (296 lines, dual search, percentage-based cost), index.html, styles.css, CI/CD workflow, CSV data, docs/conversations. Confirmed 726 models across 12 providers, 66 orgs.

2. **OpenRouter price source investigation**: User asked "where exactly are these prices coming from?" — OpenRouter's /v1/models returns ONE aggregate price per model (OpenRouter's chosen default backend). The /endpoints API (per model, via canonical_slug) returns per-backend pricing with distinct prices, quantization (fp4/fp8/unknown), and a discount field. CRITICAL BUG FOUND: encodeURIComponent(slug) encoded the / separator to %2F, causing 404s. The slash is a literal path segment — must NOT be encoded. Once fixed, all endpoints return 200 with full per-provider data, zero auth.

3. **LLMGateway investigation**: LLMGateway's /v1/models has a providers[] array with per-provider pricing at zero extra API calls (226 of 228 models have it, 100 have >1 provider). However, user decided to drop LLMGateway entirely for longevity/maintainability — added dedup complexity and a breakable source for minimal unique value.

4. **Provider overlap analysis**: Canonical model overlap: 111 both, 187 OpenRouter-only, 114 LLMGateway-only (26 TTS/image/embed dropped to 90 real chat, mostly legacy Claude date-suffixes, Alibaba Qwen API-tier names, Grok family). Backend provider overlap: 12 shared, 17+ OpenRouter-only (SiliconFlow, Fireworks, Together, etc.), 27 LLMGateway-only (Cerebras, xAI, ByteDance, etc.).

5. **User criteria for architecture decision**: (a) Ignore all non-text models (speech, image, video, embeddings — multimodal input OK, text output only). (b) Longevity and maintainability over coverage. (c) Fewer providers OK if easier to maintain. (d) LLMGateway cheaper prices likely short-term discounts — not a long-term decision criterion. (e) Include discounts (promo badges) — users may switch providers short-term to capture promos. (f) Don't compute original/structural prices — only include if OpenRouter provides them directly (they don't — just show promo badge).

6. **Discount field verification**: OpenRouter /endpoints pricing object is {prompt, completion, input_cache_read?, discount} — no pre-discount/original/base price field. The prompt/completion values ARE the discounted prices. discount=0.7 means 70% off. Verified by cross-checking: /v1/models aggregate for minimax-m2.7 ($0.18/M) matches Mara's /endpoints price ($0.18/M, discount=0.7). Structural price would be $0.60/M but is NOT available from the API.

7. **Text-only filtering**: OpenRouter: architecture.output_modalities must be exactly ["text"] (allows multimodal input). DeepInfra: metadata.tags exclusion (image-gen, tts, stt, embed, embeddings, video-gen, audio). Crof/Wafer/Lilac: ID-regex fallback (embed, embedding, embeddinggemma, clip, bge, tts, bark, parler, kokoro, openvoice). Voxtral (STT) has output_modalities=["text"] — no structural signal to exclude it, accepted as text-output model.

8. **3-tier precedence implementation**: Direct providers (DeepInfra, Crof, EmberCloud, Wafer, Synthetic, Lilac) > OpenRouter /endpoints > CSV/hardcoded. Dedup key: (canonical_model, normalized_provider, quantization). Provider-name normalization map (~15 entries) reconciles direct keys with OpenRouter display names.

9. **Resilience safeguards**: Retry on 429/5xx (1 retry, 2s backoff), abort on >20% endpoint failure rate, abort on >15% coverage drop vs previous pricing.json. These prevent shipping a degraded catalog in the daily unattended CI/CD cron.

10. **Frontend updates**: Added Quant column (fp8/fp4/int4/unknown) between Provider and Model. Added promo badge ("promo" with tooltip showing discount %) next to model name. Updated providerName() to use provider_display from OpenRouter rows, fall back to providers array for direct providers. Fixed colspan from 8 to 9.

11. **Bug fixes during implementation**: (a) Missing tbody id=resultsBody opening tag in index.html after edit — caused 0 rows to render. (b) Duplicate promo badge in cost cell — removed, kept only on model name. (c) Direct providers missing from out.providers array on success — caused providerName to show lowercase keys instead of display names.

## Decisions Made

- [x] Drop LLMGateway entirely — longevity/maintainability over coverage
- [x] De-aggregate OpenRouter via /endpoints — each backend becomes its own row, not "OpenRouter"
- [x] 3-tier precedence: direct > OpenRouter > CSV/hardcoded
- [x] Text-only filtering: output_modalities === ["text"] for OpenRouter, metadata.tags for DeepInfra, ID-regex for others
- [x] Include discounts with promo badge only — no computed original price
- [x] Provider-name normalization map for dedup and display
- [x] Resilience: retry, abort on >20% failure, abort on >15% coverage drop
- [x] Quantization column in frontend
- [x] Promo badge in frontend (next to model name, not cost)
- [x] Update AGENTS.md and README.md with new architecture
- [x] Drop Novita (user said "not required")
- [x] Drop OpenRouter MCP server plan (REST /endpoints is free, no key needed)
- [x] Keep CSV-sourced providers (Hyper, Makora, Xiaomimimo) and OpenCode Go for now

## Action Items

- [ ] Consider adding auth-gated providers (Makora, Xiaomimimo, SiliconFlow, Baseten, Fireworks, GeneralCompute) with API keys as GitHub Actions secrets — many already covered via OpenRouter backends, check overlap first
- [ ] Set up Cloudflare Pages auto-deploy on push (currently only deploys on daily cron)
- [ ] Periodically update data/manual-pricing.csv for CSV-sourced providers
- [ ] Consider dropping CSV/hardcoded providers if their models appear in OpenRouter backends
- [ ] Consider turbo/preview model grouping in UI

## Code/Config References

- **Repo**: https://github.com/WyrdWerk/payg-inference-calculator
- **Live site**: https://payg-inference-calculator.pages.dev
- **fetch-pricing.mjs**: `scripts/fetch-pricing.mjs` — 3-tier fetch, OpenRouter de-aggregation via /endpoints, org extraction, dedup, pricing normalization, resilience safeguards
- **app.js**: `public/app.js` — frontend with quant column, promo badges, provider display names
- **index.html**: `public/index.html` — 9-column results table (incl. Quant)
- **styles.css**: `public/styles.css` — quant, promo-badge styles
- **pricing.json**: `public/pricing.json` — 944 text-generation models across ~75 inference providers
- **CI/CD**: `.github/workflows/refresh-pricing.yml` — daily cron, fetch, commit, Cloudflare deploy
- **GitHub secrets**: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID

## Final State

- **944 models** across **75 inference providers** and **11 source providers**
- **62 discounted rows** with promo badges
- **89 deduped overlaps** (direct providers winning over OpenRouter backends)
- **Zero "OpenRouter" or "LLMGateway" rows** in the data
- **~317 API calls per refresh** (6 direct + 1 OpenRouter /v1/models + ~310 /endpoints), ~15-17 seconds at 20 concurrent
- **Text-only**: no TTS, image gen, video gen, or embeddings
- **Quantization data**: fp8, fp4, int4, bf16, fp16, unknown
- **Discount data**: structural (discount=0) and promo (discount>0) prices shown with badges

## Thought Process

The session evolved through several phases:

**Phase 1 — Investigation**: User asked where OpenRouter prices come from. Discovered /v1/models gives one aggregate price, /endpoints gives per-backend pricing. Initially concluded /endpoints requires auth (404s) — this was WRONG, caused by encodeURIComponent encoding the / in the slug. The advisor caught this and pushed back. Verified: /endpoints is fully public, no key needed.

**Phase 2 — Strategy**: User asked whether to use LLMGateway as base + OpenRouter incremental, or OpenRouter-only. Initially recommended Strategy B (OpenRouter-only, drop LLMGateway). The advisor pushed back: LLMGateway costs zero extra calls (providers[] already in the response), and the minimax-m2 cheaper price was a valid data point. Then user provided new criteria: longevity over coverage, text-only, LLMGateway discounts likely short-term. This nullified both the advisor's pro-LLMGateway arguments. Final decision: drop LLMGateway, use OpenRouter de-aggregated + direct providers.

**Phase 3 — Discount handling**: Initially proposed filtering discount==0 for structural prices. User said include discounts — users may switch short-term to capture promos. Then proposed showing both discounted and computed original prices. Advisor pushed back: computing original from discount is unverified (one data point), and OpenRouter has no pre-discount field. User agreed: just show promo badge, don't compute original price. If OpenRouter provides the original in the future, include it then.

**Phase 4 — Implementation**: Rewrote fetch-pricing.mjs with 3-tier architecture. Added text-only filtering (output_modalities for OpenRouter, metadata.tags for DeepInfra, ID-regex for others). Added resilience safeguards. Updated frontend with quant column and promo badges. Fixed several bugs (missing tbody tag, duplicate promo badge, missing providers.push on success).

**Phase 5 — Verification**: Ran pipeline (944 models, 75 providers, 62 discounted). Browser smoke tests confirmed: no OpenRouter/LLMGateway rows, quant column populated, promo badges working, provider display names correct. Updated AGENTS.md and README.md.
