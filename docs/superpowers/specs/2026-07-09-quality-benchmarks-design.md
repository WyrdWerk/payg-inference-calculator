# Quality benchmark enrichment — design spec

> **SHIPPED** — Historical artifact. Implementation complete as of 2026-07. Do not treat checklist/status below as pending work.


**Date:** 2026-07-09
**Status:** Draft (revised — awaiting user review)
**Author:** brainstormed with user

## Problem

TokenWatch surfaces pricing and reliability but no quality signal. Users cannot answer "is this cheap model actually good?" — they must leave the site to check Artificial Analysis or LMArena manually.

## Opportunity (verified by script)

OpenRouter's `/api/v1/models` endpoint exposes a `benchmarks` field on **158 of 343 models (46%)**. It contains:

1. **`artificial_analysis` indices** — `{ intelligence_index, coding_index, agentic_index }` (0–100 scale, higher = better). On 92 models.
2. **`design_arena`** — array of `{ arena, category, elo, win_rate, rank }` entries. On 148 models.

This is the exact Artificial Analysis data we wanted, proxied through OpenRouter's unauthenticated public API — no key needed. (The `ARTIFICIAL_ANALYSIS_API_KEY` in GitHub secrets is reserved for a future direct-AA integration if their private API becomes usable; we could not find a public endpoint.)

## Scale calibration (verified by script)

The AA indices are graded harshly. On our joined dataset (492 models with AA + pricing):
- **Maximum intelligence_index observed: ~55.** GPT-5.5 = 54.8, Claude Sonnet 5 = 53.4. Zero models reach 60.
- DeepSeek V4 Flash (credible strong-and-affordable) = 40.3.
- Cheap weak models (ling-2.6-flash, gpt-oss-120b) sit at 14–24.

Implication: **no color thresholds in v1.** Show raw numbers only. Any fixed threshold ("green ≥70") would color nothing green; any percentile-relative coloring adds compute cost and editorializes. Raw numbers + a "higher = better" hint lets users interpret against the natural scale. The scale ranges and notable anchors will be documented in the modal card tooltip.

## Coverage (script-verified)

Measured against our 919 text-model rows with **conservative matching** (strip only trailing quant suffixes `-fp8|-nvfp4|-int4|...` and SKU suffixes `-turbo|-fast|-highspeed`; no size-token or version-bit stripping — those create misattribution risk):

| Benchmark type | Coverage | % of 919 |
|---|---|---|
| Any benchmark (AA indices OR design_arena) | **667** | **72.6%** |
| Artificial Analysis indices specifically | 490 | 53.3% |
| Design arena Elo specifically | 541 | ~58.9% |

Meets the 70% coverage bar. The ~27% unscored are legitimately unranked older/community/specialty models (Llama 3.1 era, DeepSeek V3, Seed, Nemotron, community fine-tunes like Lunaris/Euryale/MythoMax). Modal cards for these show a "No benchmark data" line in the Quality section (no empty/confusing UI).

## What we will NOT do (v1)

- **Table column.** Per user direction, benchmarks live in the modal detail card, not the main table. The table stays focused on pricing/cost; quality is a drill-down concern.
- **Value-per-dollar.** Raw `intelligence / price` makes cheap-weak models rank above flagships (GPT-5.5 ranks #472 of 492; ling-2.6-flash with intel=14 ranks #1). The math works but the semantics mislead. Deferred to v2 — revisit once users can see the indices in context.
- **Color coding.** Scale tops out at ~55 so fixed thresholds mislead; percentile coloring editorializes. Raw numbers only.
- **Speed/performance data** — measured at 0% coverage across 112 endpoints. OR exposes the fields but populates them on no endpoints. Parked.
- **Aggressive base-model inference** — strips size/version tokens, reaches 75% but creates false matches (e.g. `Qwen3-30B-A3B → qwen3` misattributes). Not worth the correctness risk.
- **Direct Artificial Analysis API integration** — their public API endpoint could not be found. The OR proxy covers the need.
- **Reasoning config display** — queued as a separate future enhancement (205 models have reasoning metadata; pure display, no math).

## Design

### Data capture

New fields in `pricing.json`, added during the fetch pipeline:

```js
// Per text model row:
{
  id: "z-ai/glm-5.2",
  // ...existing fields...
  benchmarks: {
    intelligence_index: 51.1,   // 0–100, or null/absent if unscored
    coding_index: 67.0,
    agentic_index: 44.2,
    design_arena_best: {         // highest-Elo design_arena entry, or absent
      category: "codecategories",
      elo: 1329,
      win_rate: 58,
      rank: 5
    }
  }   // or omitted entirely if no benchmark data matched
}
```

**Flattened structure** (not nested OR blobs) for three reasons: (a) smaller JSON, (b) trivially queryable by the API layer, (c) frontend modal renders without reshaping. We pick the single best design_arena entry (highest Elo) to avoid array proliferation.

### Matching algorithm (conservative)

Implemented in a new `shared/benchmarks.mjs` pure module (mirrors the `shared/normalize.mjs` + `shared/modelsdev.mjs` pattern):

1. Build index `Map<canonicalBase, benchmarks>` from OR `/models` where `benchmarks` is non-empty.
2. For each of our text models: compute `conservativeBase(id)` = `canonicalId(id)` then strip trailing `-(fp8|fp16|bf16|int8|int4|nvfp4|awq|gptq|mxfp4|f16)` and trailing `-(turbo|fast|highspeed)`.
3. Look up the index. If hit, attach `benchmarks` block.
4. On collision (two OR models map to same base), prefer the entry with `artificial_analysis` indices (richer signal).
5. Log matches at fetch time: `Benchmark enrichment: X models matched (Y with AA indices, Z with design_arena only)`.

**Collision edge case:** `glm-5.2` and `glm-5.2-fp8` both canonicalize to `glm-5.2` after quant-strip. Both get the same benchmark. This is correct — same base model, same quality.

### Pipeline integration

In `scripts/fetch-pricing.mjs`, after the models.dev enrichment pass (existing pattern at ~line 834):

```js
import { applyBenchmarkEnrichment } from './lib.mjs';  // re-export from shared/benchmarks.mjs

// ...in main(), after applyEnrichment():
const benchIndex = await fetchBenchmarkIndex();  // built from the already-fetched OR /models response
applyBenchmarkEnrichment(out.models, benchIndex);
```

The OR `/models` response is already fetched by the pipeline (for text-model filtering). We extract `benchmarks` from it without an extra HTTP call.

### API

New sort keys on `/api/v1/models`:
- `?sort=intelligence` — by `benchmarks.intelligence_index` desc, nulls last
- `?sort=coding` — by `benchmarks.coding_index` desc, nulls last
- `?sort=agentic` — by `benchmarks.agentic_index` desc, nulls last

New filter:
- `?benchmarked=true` — only rows with a non-empty `benchmarks` block

Model objects in the API response include the `benchmarks` block when present. The API gains these even though the frontend doesn't surface a table column — programmatic users (and our own widget) get the sort/filter power.

### Frontend — modal card only

**No table column. No new sort header.** The existing detail modal (`showDetailModal()` in `app.js`) gains a new **Quality** section. Placement: after the existing Capabilities section, before the About section.

Section contents:
- **If AA indices present:** three labeled lines:
  ```
  Intelligence Index    53.4
  Coding Index          72.4
  Agentic Index         45.7
  ```
  No color, no badges — raw numbers, right-aligned, tabular-nums. Tooltip on the section header: "Artificial Analysis indices (0–100, higher is better). Max observed in catalog: ~55."
- **Else if design_arena present:** a single line:
  ```
  Design Arena Elo      1329  (codecategories, rank 5, 58% win rate)
  ```
- **Else:** the section is omitted entirely (no "No benchmark data" placeholder — cleaner). Modal card readers only see Quality when there's something to show.

**Source attribution in the modal:** a small muted line at the bottom of the Quality section: `Source: Artificial Analysis via OpenRouter` — links to the footer's benchmark-sources block (see below).

### Frontend — footer benchmark links

A new section in the page footer on all three pages (text/image/video share the footer). Placement: after the existing "Data refreshed daily" / last-updated line.

```html
<div class="footer-benchmarks">
  Quality benchmarks via
  <a href="https://artificialanalysis.ai/" rel="noopener">Artificial Analysis</a>
  ·
  <a href="https://lmarena.ai/" rel="noopener">LMArena</a>
  (design arena)
  · proxied through
  <a href="https://openrouter.ai/" rel="noopener">OpenRouter</a>
</div>
```

Styled muted (existing `.footer` text-dim color), small font. The links go to the benchmark providers' homepages — direct to their model-leaderboard pages where possible (e.g. `artificialanalysis.ai/text/leaderboards/...` if a stable URL exists; otherwise homepage).

**Why footer, not modal:** the modal is per-model and transient; attribution belongs at the page level so it's always visible and authoritative. Users who want to verify a score click the footer link, land on AA/LMArena, and look up the model themselves.

### Mobile

Modal already adapts to mobile (existing pattern). The new Quality section inherits the same responsive layout — no special mobile handling needed. Footer benchmark links wrap naturally on narrow screens.

## Components

| Component | File | Purpose |
|---|---|---|
| Pure matcher | `shared/benchmarks.mjs` (NEW) | `conservativeBase()`, `buildBenchmarkIndex()`, `applyBenchmarkEnrichment()`. No `node:` imports (Worker-safe). |
| Pipeline hook | `scripts/fetch-pricing.mjs` (MODIFIED) | Call `applyBenchmarkEnrichment()` after models.dev pass. Log coverage. |
| Lib re-export | `scripts/lib.mjs` (MODIFIED) | Re-export benchmark helpers (mirrors normalize/modelsdev pattern). |
| API | `functions/api/v1/[[route]].js` (MODIFIED) | New sort keys (`intelligence`, `coding`, `agentic`), new filter (`benchmarked`), include `benchmarks` in response. |
| Modal card | `public/app.js` (MODIFIED) | New Quality section in `showDetailModal()`. Omitted when no benchmark data. |
| Footer | `public/index.html`, `public/image.html`, `public/video.html` (MODIFIED) | New `.footer-benchmarks` block. |
| Styles | `public/styles.css` (MODIFIED) | `.detail-quality` section styles (tabular-nums, label/value rows), `.footer-benchmarks` styling. |
| Tests | `test/benchmarks.test.mjs` (NEW) | Conservative matching regressions: quant-strip, turbo-strip, no-over-strip (Qwen3-30B stays distinct), collision preference (AA-wins). |
| Parity guard | `test/parity.test.mjs` (MODIFIED) | Add regression: benchmark coverage floor (e.g. ≥65% any-benchmark, ≥48% AA — leaves headroom for catalog drift). |
| Docs | `AGENTS.md` (MODIFIED) | Document benchmarks field, matching algorithm, conservative-strip rationale, modal-card placement. |

## Error handling

- **OR `/models` fetch fails:** benchmark enrichment is non-fatal (existing resilience pattern). Models ship without benchmarks; log a warning.
- **Malformed `benchmarks` blob:** per-model try/catch in `applyBenchmarkEnrichment()`. Skip the model, continue.
- **Coverage drop:** log but don't abort (unlike pricing data, benchmarks are optional enrichment). Parity test catches gross regressions.

## Testing strategy

1. **Unit tests** (`test/benchmarks.test.mjs`):
   - `conservativeBase('z-ai/glm-5.2-fp8')` → `'glm-5.2'` (quant strip)
   - `conservativeBase('anthropic/claude-sonnet-5-turbo')` → `'claude-sonnet-5'` (SKU strip)
   - `conservativeBase('qwen/qwen3-30b-a3b')` → `'qwen3-30b-a3b'` (NO size strip — stays distinct)
   - `conservativeBase('qwen/qwen3-coder-480b-a35b-instruct-turbo')` → `'qwen3-coder-480b-a35b-instruct'` (only trailing turbo stripped)
   - Collision preference: when base `glm-5.2` has entries with and without AA, the AA one wins
   - Empty benchmarks blob → no match, no crash
2. **Integration:** run the fetcher, assert ≥65% coverage on the resulting `pricing.json`.
3. **Parity guard:** `test/parity.test.mjs` asserts coverage floor against real `pricing.json`.
4. **API tests:** extend `test/api.test.mjs` with `?sort=intelligence` and `?benchmarked=true` cases.
5. **Manual:** local serve, click a few rows, verify modal Quality section renders correctly (AA indices / design_arena / omitted), footer links work, mobile modal layout intact.

## Resolved decisions (from brainstorm)

| Question | Decision | Rationale |
|---|---|---|
| Benchmark scope | AA indices + design_arena, per-card | Max coverage; users see whatever data exists per model |
| Match aggressiveness | Conservative (suffix-only) | 72.6% coverage with zero misattribution risk |
| Unscored render | Section omitted | Cleaner modal — no empty placeholders |
| Value-per-dollar | Deferred to v2 | Raw math misleads (cheap-weak ranks above flagships) |
| Badge coloring | None — raw numbers | AA scale tops out ~55; fixed thresholds mislead, percentile editorializes |
| Surfacing | Modal card + footer links | Quality is a drill-down concern, not a table column |

## Build sequence (high-level — detailed plan comes from writing-plans skill)

1. `shared/benchmarks.mjs` + tests (pure module, fully testable in isolation)
2. Pipeline integration + coverage logging
3. API sort/filter
4. Modal Quality section
5. Footer benchmark links
6. Parity guard
7. Docs
8. Local verify, push, deploy
