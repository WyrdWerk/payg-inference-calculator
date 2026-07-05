---
timestamp: "2026-07-04T02:11:00+05:30"
session_id: "payg-pricing-phase2-provider-expansion-20260704"
duration_minutes: 180
topics: ["payg-inference-calculator", "llm-pricing-comparison", "provider-expansion", "llmgateway", "synthetic", "lilac", "hyper", "makora", "xiaomimimo", "opencode-go", "csv-sourced-providers", "canonicalization", "org-extraction", "cloudflare-pages"]
related_repos: ["WyrdWerk/payg-inference-calculator"]
related_sessions: ["20260704-001612-pi-phase1"]
artifacts: []
learnings: [
  "LLMGateway is no longer an OpenRouter mirror — has 228 models, 39 providers, 83 unique canonicals vs OpenRouter as of 2026-07-03. Previously removed as mirror, now re-added as independent aggregator.",
  "Synthetic's /v1/models returns pricing with $ prefix ($0.0000014) — num() must strip $ and commas, not just parseFloat",
  "Synthetic cache_read is always 20% of input price per spec, not from the API's input_cache_reads field",
  "Synthetic org extracted from hugging_face_id field, not model ID — model IDs are aliases like syn:large:text",
  "Novita pricing unit: integers where 10000=$1/M (verified by cross-referencing GLM-5.2 across providers)",
  "Lilac (api.getlilac.com) is a public no-auth provider with 6 models — discovered via CSV, not in original 6 endpoints",
  "Hyper, Makora, Xiaomimimo, Baseten, Fireworks, GeneralCompute, SiliconFlow all have auth-gated or pricing-less APIs — CSV is the fallback for static pricing",
  "OpenCode Go has no pricing in API but corrected pricing table provided with 16 models including tiered Qwen (≤256K vs >256K as separate entries)",
  "canonToOrg map must be built from m.org (parser-set) not orgFromId(m.id) — otherwise Synthetic's hf: prefixed IDs pollute the map",
  "orgLookupKey() strips quantization suffixes (-fp8, -nvfp4, -int4-mixed-ar) and tier suffixes (-long) for org cross-referencing only, keeping canonicalId() separate for model matching",
  "Zero-price filter: drop models where both input=0 AND output=0 (catches TTS/image/video generation models from LLMGateway)",
  "Cloudflare Pages doesn't auto-deploy on git push — only GitHub Actions cron triggers deploy. Manual deploy with wrangler pages deploy needed after pushing changes.",
  "CSV model IDs with spaces must be normalized to hyphens for cross-provider matching (Hyper CSV uses 'DeepSeek V4 Flash' → 'deepseek-v4-flash')"
]
---

# Phase 2 — Provider Expansion and Dual Search UX

## Phase Summary

Completed Phase 2 canonicalization and dual search UX, then expanded from 469 models across five providers to 726 models across 12 providers by adding seven new providers (LLMGateway, Synthetic, Lilac, Hyper, Makora, Xiaomimimo, OpenCode Go).

## What Was Built

### Canonicalization improvements
- Updated `canonicalId()` in `fetch-pricing.mjs` and `app.js` to strip date suffixes (`-2024-08-06`), preview suffixes (`-preview`, `-preview-05-06`), and `:thinking` suffix
- Nine near-miss clusters now merge correctly (gpt-4o date variants, gemini preview variants, qwen-plus `:thinking`); turbo variants kept separate

### Dual search UX
- Replaced "Compare by: [Model|Provider]" dropdown with two `<datalist>`-powered typeahead inputs: "Search by provider" (lists orgs, not aggregators) and "Search by model" (lists canonical model names)
- Both filters AND-combine; state refactored from `mode`/`selectedModel`/`selectedProvider` → `providerSearch`/`modelSearch` + lookup maps
- Org display names: `z-ai`→`Z.ai`, `openai`→`OpenAI`, etc.

### New providers
| Provider | Source | Notes |
|----------|--------|-------|
| LLMGateway | API | Re-added as independent aggregator; org from `providers[0].providerId`; 33 zero-price models dropped |
| Synthetic | API | 11 models; `$` prefix pricing; cache_read = 20% of input; org from `hugging_face_id` |
| Lilac | API | 6 models; standard $/token; org from ID prefix |
| Hyper, Makora, Xiaomimimo | CSV | `data/manual-pricing.csv` via `parseCsvProviders()` |
| OpenCode Go | Hardcoded | 16 models with tiered Qwen entries |

### Org resolution architecture
Five-level fallback: (1) parser-set org, (2) orgFromId, (3) canonToOrg via orgLookupKey, (4) canonToOrg via canonicalId, (5) orgFromName, (6) fallback to provider. `canonToOrg` map built from `m.org` not `orgFromId(m.id)`.

## Key Decisions

- Phase 2 canonicalization: strip date/preview/`:thinking` suffixes; keep turbo separate
- Re-add LLMGateway as independent aggregator (no longer a mirror)
- Synthetic cache_read = 20% of input (spec overrides API value)
- CSV-sourced providers for auth-gated APIs without public pricing
- OpenCode Go: 16 models hardcoded from corrected pricing table
- Exclude Novita for now (postponed)
- Zero-price filter: drop models where both input=0 AND output=0
- `orgLookupKey()` separate from `canonicalId()` — quantization/tier suffixes stripped for org lookup only

## Technical Discoveries

- **Provider investigation**: Hyper has no pricing in API; Makora/Xiaomimimo/SiliconFlow need auth; Synthetic/LLMGateway/Lilac have public no-auth pricing
- **CSV fallback pattern**: Auth-gated or pricing-less APIs covered via committed `data/manual-pricing.csv`
- **Cloudflare deploy**: CI/CD workflow only deploys on daily cron, not on push — manual `wrangler pages deploy` required for immediate live updates

## Code Changes

| File | Changes |
|------|---------|
| `scripts/fetch-pricing.mjs` | 12 providers, three parser types (API, CSV, hardcoded) |
| `data/manual-pricing.csv` | Static pricing for Hyper/Makora/Xiaomimimo |
| `public/app.js` | Dual search, canonicalization |
| `.github/workflows/refresh-pricing.yml` | Daily cron (no push-triggered deploy) |

**Commits**: `e4c2bf8` (Phase 2: dual search + canonicalization), `c681afb` (7 new providers)

## Follow-up (Planned)

- Novita integration (132 models, pricing unit ÷10000)
- Auth-gated provider APIs with keys stored as GitHub Actions secrets
- Cloudflare Pages auto-deploy on push
- Rate limits display for OpenCode Go
- Periodic `data/manual-pricing.csv` maintenance

## References

- **Repo**: https://github.com/WyrdWerk/payg-inference-calculator
- **Live site**: https://payg-inference-calculator.pages.dev
