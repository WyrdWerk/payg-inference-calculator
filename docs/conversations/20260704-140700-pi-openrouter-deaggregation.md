---
timestamp: "2026-07-04T14:07:00+05:30"
session_id: "payg-pricing-openrouter-deaggregation-20260704"
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
  "LLMGateway providers[] array has per-provider pricing at zero extra API calls, but was dropped for longevity/maintainability: added dedup complexity, a breakable source, and coverage was deprioritized over simplicity.",
  "3-tier precedence: direct providers > OpenRouter /endpoints > CSV/hardcoded. Dedup key: (canonical_model, normalized_provider, quantization). Provider-name normalization map reconciles direct keys (ember) with OpenRouter display names (EmberCloud).",
  "Voxtral (speech-to-text) has output_modalities=['text'] and accepts text input — no structural signal distinguishes it from audio-capable chat models. Accepted as a text-output model.",
  "Default 97% cache preset excludes ~40% of models (375/944) that lack cache_read pricing — correct behavior per existing design (if a provider doesn't support requested token types, that offering is excluded).",
  "~310 OpenRouter /endpoints calls at 20 concurrent takes ~15-17 seconds total. Zero rate limits observed on 50-call burst test. No rate-limit headers returned.",
  "Resilience safeguards for unattended pipeline: retry on 429/5xx (1 retry, 2s backoff), abort on >20% endpoint failure, abort on >15% coverage drop vs previous pricing.json.",
  "git checkout --ours during a stash pop conflict keeps the CURRENT tree, NOT the stashed work — for generated files like pricing.json, always regenerate after any stash pop conflict rather than trusting git conflict resolution."
]
---

# Phase 3 — OpenRouter De-aggregation and 3-Tier Pipeline

## Phase Summary

Major architectural shift: de-aggregate OpenRouter to surface underlying inference providers (Fireworks, Together, Novita, SiliconFlow, etc.) as their own rows, using OpenRouter as a data source rather than a provider. Dropped LLMGateway for longevity/maintainability. Implemented 3-tier dedup precedence, text-only filtering, discount/promo handling, frontend updates, and resilience safeguards.

## What Was Built

### OpenRouter de-aggregation pipeline
- `/v1/models` returns one aggregate price per model; `/endpoints` (per model via `canonical_slug`) returns per-backend pricing with quantization (fp4/fp8/unknown) and discount field
- Each backend becomes its own row — zero "OpenRouter" rows in output data
- ~317 API calls per refresh (~310 `/endpoints` at 20 concurrent, ~15–17 seconds)

### 3-tier precedence
1. **Tier 1**: Direct providers (DeepInfra, Crof, EmberCloud, Wafer, Synthetic, Lilac)
2. **Tier 2**: OpenRouter `/endpoints` de-aggregated backends
3. **Tier 3**: CSV/hardcoded (Hyper, Makora, Xiaomimimo, OpenCode Go)

Dedup key: `(canonical_model, normalized_provider, quantization)`. Provider-name normalization map (~15 entries) reconciles direct keys with OpenRouter display names.

### Text-only filtering
- **OpenRouter**: `architecture.output_modalities` must be exactly `["text"]`
- **DeepInfra**: `metadata.tags` exclusion (image-gen, tts, stt, embed, embeddings, video-gen, audio)
- **Others**: ID-regex fallback (embed, embedding, tts, bark, parler, kokoro, openvoice)

### Frontend updates
- Quant column (fp8/fp4/int4/unknown) between Provider and Model
- Promo badge ("promo" with tooltip showing discount %) next to model name
- `providerName()` uses `provider_display` from OpenRouter rows

### Resilience safeguards
- Retry on 429/5xx (1 retry, 2s backoff)
- Abort on >20% endpoint failure rate
- Abort on >15% coverage drop vs previous `pricing.json`

## Key Decisions

- Drop LLMGateway entirely — longevity/maintainability over coverage
- De-aggregate OpenRouter via `/endpoints` — each backend is its own row
- 3-tier precedence: direct > OpenRouter > CSV/hardcoded
- Text-only filtering as described above
- Include discounts with promo badge only — no computed original price (API provides no pre-discount field)
- Provider-name normalization map for dedup and display
- Keep CSV-sourced providers and OpenCode Go for now
- Drop Novita (not required at this stage)

## Technical Discoveries

### OpenRouter `/endpoints` API
- **Fully public** — no auth required; earlier 404s caused by `encodeURIComponent(slug)` encoding `/` to `%2F`; slug slash is a literal path segment
- **Discount field**: `discount=0` structural, `discount>0` promo fraction (e.g., 0.7 = 70% off); `prompt`/`completion` values ARE the discounted prices
- **No pre-discount field** in API — verified by cross-checking minimax-m2.7 aggregate vs Mara endpoint

### Provider overlap (pre-deaggregation)
- Canonical overlap: 111 both, 187 OpenRouter-only, 114 LLMGateway-only
- Backend overlap: 12 shared, 17+ OpenRouter-only, 27 LLMGateway-only

### Implementation bugs fixed
- Missing `tbody id=resultsBody` opening tag — caused 0 rows to render
- Duplicate promo badge in cost cell — removed, kept only on model name
- Direct providers missing from `out.providers` array — caused lowercase keys in `providerName`
- **Stash pop conflict on `pricing.json`**: `git checkout --ours` during stash pop keeps current (stale cron) tree, not stashed work — regenerated via `npm run fetch` to restore correct 944-model catalog

## Code Changes

| File | Changes |
|------|---------|
| `scripts/fetch-pricing.mjs` | 3-tier fetch, OpenRouter de-aggregation, org extraction, dedup, resilience |
| `public/app.js` | Quant column, promo badges, provider display names |
| `public/index.html` | 9-column results table (incl. Quant) |
| `public/styles.css` | quant, promo-badge styles |
| `public/pricing.json` | 944 text-generation models across ~75 inference providers |
| `AGENTS.md`, `README.md` | Updated architecture documentation |

## Final State

- **944 models** across **75 inference providers** and **11 source providers**
- **62 discounted rows** with promo badges
- **89 deduped overlaps** (direct providers winning over OpenRouter backends)
- **Zero "OpenRouter" or "LLMGateway" rows**
- **Text-only**: no TTS, image gen, video gen, or embeddings
- **Quantization data**: fp8, fp4, int4, bf16, fp16, unknown

## Follow-up (Planned)

- Auth-gated providers with API keys (many covered via OpenRouter backends)
- Cloudflare Pages auto-deploy on push
- Consider dropping CSV/hardcoded providers if models appear in OpenRouter backends
- Turbo/preview model grouping in UI

## References

- **Repo**: https://github.com/WyrdWerk/payg-inference-calculator
- **Live site**: https://payg-inference-calculator.pages.dev
