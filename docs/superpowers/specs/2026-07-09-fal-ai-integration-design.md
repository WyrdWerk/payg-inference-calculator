# fal.ai integration — design spec

> **SHIPPED** — Historical artifact. Implementation complete as of 2026-07. Do not treat checklist/status below as pending work.


**Date:** 2026-07-09
**Status:** Draft (awaiting user review)
**Author:** brainstormed with user

## Problem

Our image catalog (34 models) and video catalog (13 models) are sourced entirely from OpenRouter. fal.ai is a major dedicated image/video inference provider with a much deeper catalog — 1,398 models total, 1,136 of them image or video. Adding fal as a Tier-1 direct provider would substantially expand both catalogs and add a named provider users actively compare against.

## Opportunity (verified by script)

fal.ai exposes two authenticated endpoints:

1. **`GET /v1/models`** — paginated list (500/page, `cursor` param). Returns `endpoint_id`, `metadata.{display_name, category, description, status, tags, group, license_type}`. 1,398 models across 26 categories. Auth: `Authorization: Key <KEY>`.
2. **`GET /v1/models/pricing?endpoint_id=<id1>,<id2>,...`** — batch pricing (1-50 IDs per call). Returns `[{ endpoint_id, unit_price, unit, currency }]`. Auth: same.

Key stored in GitHub secrets as `FAL_API_KEY`.

### Catalog breakdown (image + video only)

| Category | Endpoints |
|---|---|
| image-to-image | 380 |
| text-to-image | 194 |
| image-to-video | 188 |
| video-to-video | 182 |
| text-to-video | 127 |
| audio-to-video | 20 |
| **Total image+video** | **1,136** |

### Pricing-unit distribution (across 1,136 image+video endpoints)

Only **366 endpoints (32%) have paid pricing**. The other 770 are free, deprecated, or lack published unit pricing. Distribution of the 366 paid:

| Unit | Count | Maps to | Include? |
|---|---|---|---|
| `seconds` | 133 | video `cost_per_second` | ✅ |
| `megapixels` | 86 | image `cost_per_million` (÷1e6) | ✅ |
| `images` | 83 | image `cost_per_unit` | ✅ |
| `compute seconds` | 64 | GPU-time, not output-based | ❌ excluded per user |
| `units` | 46 | ambiguous generic unit | ❌ ambiguous |
| `videos` | 25 | per-video flat | ⚠️ see below |
| `generations` | 19 | per-generation flat | ⚠️ see below |
| `processed megapixels` | 7 | per-MP (processing) | ✅ treat as megapixels |
| `credits` | 7 | internal currency | ❌ ambiguous |
| `1m tokens` / `1000 tokens` | 10 | token-based (LLMs misfiled) | ❌ not image/video |
| `minutes` / `5 seconds` / `video segments` / `16 frames` | 17 | video (time-based variants) | ⚠️ normalize to seconds |
| other | 5 | edge cases | ❌ |

**Clean includable count: 302 endpoints** (133 seconds + 86 MP + 83 images), plus 7 processed-MP = **309**. Per-video/per-generation flat pricing (44 endpoints) is includable if we extend the schema (see Design decision below).

### Overlap with existing catalog

Near-zero overlap: our `canonicalId` (built for text models) collapses fal's deep nested endpoint IDs too aggressively. `fal-ai/kling-video/v3/pro/image-to-video` canonicalizes to just `image-to-video`, losing the model identity entirely. **fal needs its own canonicalization** that preserves the model/version path.

## Design decisions

### DD-1: Canonicalization — preserve model identity from nested paths

fal's endpoint IDs are deeply nested and carry meaning in every segment:
- `fal-ai/kling-video/v3/pro/image-to-video` → model=kling-video, version=v3, tier=pro, modality=image-to-video
- `fal-ai/flux-pro/v1.1-ultra` → model=flux-pro, version=v1.1-ultra
- `bytedance/seedance-2.0/image-to-video` → model=seedance-2.0, modality=image-to-video

**New `falCanonicalId(endpointId)`** in `scripts/lib.mjs` (not `shared/` — fal is a Node-only fetcher, no Worker bundling needed):
1. Strip the `fal-ai/` or org prefix if it's a pure namespace (`fal-ai/flux/...` → `flux/...`, but `bytedance/seedance-2.0/...` keeps `bytedance` since it's the actual model org).
2. Preserve the model name + version segments.
3. Drop the trailing modality segment if it's purely a routing suffix (`image-to-video`, `text-to-video`, `reference-to-video`, `edit`, `upscale`) — but ONLY when the remaining segments uniquely identify the model.

Example canonicalizations:
- `fal-ai/kling-video/v3/pro/image-to-video` → `kling-video-v3-pro` (drop modality)
- `fal-ai/flux/schnell` → `flux-schnell`
- `fal-ai/flux-pro/v1.1-ultra` → `flux-pro-v1.1-ultra` (keep version)
- `bytedance/seedance-2.0/image-to-video` → `bytedance-seedance-2.0`

This means each (model, version, tier) is one row, and the modality (image-to-video vs text-to-video) becomes a variant within the row — matching our existing video-pricing schema where one model has multiple `pricing` variants.

### DD-2: Pricing-unit handling — what to include

**Include (clean per-output-unit pricing):**
- `images` → image `cost_per_unit` (flat per-image)
- `megapixels` + `processed megapixels` → image `cost_per_million` ($/MP, store as `unit: "megapixel"`)
- `seconds` + `5 seconds` (÷5) + `minutes` (×60) → video `cost_per_second`

**Exclude per user direction:**
- `compute seconds` — GPU-time-based, not output-based (64 endpoints)

**Exclude (ambiguous / out-of-scope):**
- `units`, `credits`, `1m tokens`, `1000 tokens`, empty unit, `1`, `16 frames`, `video segments` — not image/video output pricing

**Exclude (decided this session):**
- `videos` (flat per-video, 24 video endpoints) — our video tab is per-second only; fal provides no duration data to convert $/video → $/sec. Only 2 of 24 mention "5 second" in marketing copy, which is not a reliable spec. Converting would require an invented divisor. **Excluded rather than hallucinate.**
- `generations` (19 endpoints) — investigation showed these are almost all `image-to-3d` (excluded category) and `image-to-image` try-on/edit endpoints, not video. The few image-category ones use ambiguous "per-generation" semantics that don't cleanly map. **Excluded.**

**Final includable counts (script-verified):**
- Video: **143 models** (132 `seconds` + 5 `5 seconds`÷5 + 6 `minutes`÷60)
- Image: **167 models** (83 `images` + 77 `megapixels` + 7 `processed megapixels`)
- **Total: ~310 models** before canonical-ID dedup

### DD-3: Endpoint filtering — status and category

**Include endpoints where:**
- `metadata.status === 'active'` (drops deprecated)
- Category is one of: `text-to-image`, `image-to-image`, `text-to-video`, `image-to-video`, `video-to-video`, `audio-to-video`
- Has a paid pricing entry in an includable unit (per DD-2)

**Exclude:**
- Non-active status
- Categories outside image/video (LLMs, audio, 3D, training, etc.)
- Endpoints with no pricing (free/unpriced — 770 endpoints)
- `compute seconds`, `units`, `credits`, token-based units

**Estimated final catalog addition:** ~300-350 image+video rows (from 302 clean-priced + ~44 flat-video/generation if included), before variant-collapse by canonical ID.

### DD-4: Schema mapping — how fal rows fit our existing image/video JSON

**Image (`public/image-pricing.json`):**
```js
{
  id: "flux-schnell",                    // falCanonicalId
  name: "Flux Schnell",                  // metadata.display_name
  org: "black-forest-labs",              // extracted from endpoint or manual map
  provider: "fal",                       // new provider key
  output_modalities: ["image"],
  supported_parameters: [...],           // from metadata.tags if useful
  pricing: [{
    unit: "image" | "megapixel",
    variant: "fal-default",
    cost_per_unit: 0.003,                // $/image for unit=image
    cost_per_million: 3.0,               // $/M-pixels for unit=megapixel
  }]
}
```

**Video (`public/video-pricing.json`):**
```js
{
  id: "kling-video-v3-pro",
  name: "Kling Video V3 Pro",
  org: "kuaishou",
  provider: "fal",
  supported_durations: [...],            // not available from fal API — omit or infer
  supported_resolutions: [...],          // not available — omit
  pricing: [{
    resolution: null,                    // fal doesn't expose this at pricing level
    audio: null,
    cost_per_second: 0.28
  }]
}
```

### DD-5: Dedup precedence — where fal sits in tiers

Current 3-tier system (text models):
- Tier 1: Direct providers (DeepInfra, Crof, etc.)
- Tier 2: OpenRouter de-aggregated
- Tier 3: CSV/hardcoded

**fal becomes Tier 1 for image/video.** Since overlap with OpenRouter image/video is near-zero (per DD-1 measurement: 1% image, 0% video), dedup collisions will be rare. When they happen, fal (Tier 1) wins over OpenRouter (Tier 2) — matching the existing precedence rule.

### DD-6: Org extraction — fal endpoint → model creator

fal endpoints don't cleanly expose the model creator. Heuristics:
1. `bytedance/...`, `openai/...`, `xai/...` prefixes → org from prefix
2. `fal-ai/<model>/...` → model-specific org lookup (flux→black-forest-labs, kling-video→kuaishou, ideogram→ideogram, minimax→minimax, etc.) via a `FAL_ORG_MAP` constant
3. Fallback: `fal` (the provider as org — less informative but honest)

### DD-7: Fetcher resilience

Mirror existing patterns:
- `fetchJsonWithRetry` for 429/5xx (2s backoff, 1 retry)
- Non-fatal on failure: log warning, continue without fal data (don't break the image/video refresh)
- Pagination loop with safety cap (max 10 pages)
- Batch pricing calls (50 IDs each) with per-batch error isolation

## What we will NOT do

- **Text models.** fal has 8 LLMs — far less coverage than OpenRouter/DeepInfra, and they'd add little value to the text tab. Out of scope.
- **Audio/3D/training models.** Same — out of scope, different categories.
- **`compute seconds` models.** Excluded per user direction — GPU-time pricing isn't output-based.
- **Free/unpriced endpoints (770).** No pricing → no value to a pricing-comparison site.
- **Historical/quality benchmark enrichment.** fal models don't carry AA/LMArena data via the OR benchmarks field (they're not on OR's text-model catalog). The Quality section will be absent for fal rows — consistent with how non-OR image/video models already render.

## Components

| Component | File | Purpose |
|---|---|---|
| Fetcher | `scripts/fetch-fal.mjs` (NEW) | Paginated `/v1/models` + batched `/v1/models/pricing`, filter to image/video active endpoints, map to our schema |
| Canonicalizer | `scripts/lib.mjs` (MODIFY) | Add `falCanonicalId(endpointId)` — preserve model/version from nested paths |
| Org map | `scripts/fetch-fal.mjs` (NEW) | `FAL_ORG_MAP` constant for fal-ai/ prefixed models → real org |
| Pipeline hook | `scripts/fetch-images.mjs` (MODIFY) | Merge fal image models with OpenRouter image models (Tier 1 precedence) |
| Pipeline hook | `scripts/fetch-videos.mjs` (MODIFY) | Merge fal video models with OpenRouter video models (Tier 1 precedence) |
| CI workflow | `.github/workflows/refresh-pricing.yml` (MODIFY) | Add `FAL_API_KEY` env to refresh job, add `npm run fetch:fal` to the fetch sequence |
| package.json | (MODIFY) | Add `"fetch:fal": "node scripts/fetch-fal.mjs"` script |
| Frontend | (NONE) | No changes — existing image/video tabs render new provider rows automatically |
| Tests | `test/fal-canonicalization.test.mjs` (NEW) | `falCanonicalId` regressions |
| Docs | `AGENTS.md` (MODIFY) | Document fal as Tier-1 image/video provider |

## Testing strategy

1. **Unit tests** (`test/fal-canonicalization.test.mjs`):
   - `falCanonicalId('fal-ai/kling-video/v3/pro/image-to-video')` → `kling-video-v3-pro`
   - `falCanonicalId('fal-ai/flux/schnell')` → `flux-schnell`
   - `falCanonicalId('fal-ai/flux-pro/v1.1-ultra')` → `flux-pro-v1.1-ultra`
   - `falCanonicalId('bytedance/seedance-2.0/image-to-video')` → `bytedance-seedance-2.0`
   - Modality suffix dropped only when model identity preserved
2. **Integration:** run `npm run fetch:fal`, assert ≥250 image+video rows with valid pricing
3. **Parity guard:** add fal coverage floor to `test/parity.test.mjs` (e.g. ≥200 fal image+video models after dedup)
4. **Manual:** local serve, verify image + video tabs show fal rows, pricing computes correctly, mobile layout intact

## Resolved decisions (from this session)

| Question | Decision | Rationale |
|---|---|---|
| Per-video / per-generation pricing | **Exclude** | Per-video: 24 endpoints with no duration data → can't convert to per-second without inventing a divisor. Per-generation: mostly 3D/edit endpoints, not video. |
| Org extraction fallback | **`fal` for long tail** | Build `FAL_ORG_MAP` for top ~20 families; accept `fal` as org for the rest. |
| `supported_durations` / `supported_resolutions` | **Omit** | fal doesn't expose these; existing UI handles null. |
| Focus | **Latest models with pricing only** | Exclude deprecated (`status !== 'active'`), exclude unpriced (770 endpoints). Per user: "focus on the latest models where pricing is actually available." |
| Catalog scope | **Full image + video** | Both tabs get fal as Tier-1 provider. |
| compute-seconds | **Exclude** | GPU-time pricing, not output-based. Per user. |

## Build sequence (high-level — detailed plan comes from writing-plans skill)

1. `falCanonicalId` + `FAL_ORG_MAP` + tests
2. `scripts/fetch-fal.mjs` — fetch, filter, map to schema
3. Merge into `fetch-images.mjs` + `fetch-videos.mjs` (Tier-1 precedence)
4. CI workflow + package.json
5. Parity guard
6. Docs
7. Local verify, push, deploy
