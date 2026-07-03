# Phase 2 Plan: Provider Segregation, Model Aggregation, Dual Search

## Problem Statement

Three issues remain:

1. **OpenRouter is an aggregator, not a provider.** Models like `mistralai/ministral-3b-2512` are served by Mistral AI (the org), not "OpenRouter". The frontend currently treats OpenRouter as a provider in the dropdown — it should show the underlying org instead.

2. **Model IDs don't aggregate cleanly.** The same model appears with different casing/hyphenation: `Kimi-K2.6`, `kimi-k2.6`, `moonshotai/kimi-k2.6`, `Kimi-K2.6` (Wafer). Current `canonicalModelId` lowercases but doesn't strip hyphens or normalize case variants. 52 models have multiple ID formats that should merge.

3. **Compare-by dropdown is clunky.** User wants two typeahead search fields: "Search by provider" and "Search by model". Typing in either filters results. Both can be used together.

## Data Analysis

### OpenRouter org distribution (313 models, 50 orgs)
- openai: 62, qwen: 47, google: 29, anthropic: 19, mistral: 19
- z-ai: 12, deepseek: 11, meta: 10, minimax: 8, moonshot: 7
- ... 50 total orgs

### Canonicalization gaps (17 near-miss clusters)
- Date suffixed: `gpt-4o-2024-08-06` should merge with `gpt-4o`
- Preview variants: `gemini-2.5-pro-preview-05-06` should merge with `gemini-2.5-pro`
- Turbo variants: `gemma-4-31b-it-turbo` should merge with `gemma-4-31b-it` (or stay separate — turbo is a different SKU)
- Thinking variants: `qwen-plus-2025-07-28:thinking` should merge with `qwen-plus`

### Cross-provider ID format mismatches (52 models)
- `GLM-5.2` / `glm-5.2` / `z-ai/glm-5.2` / `zai-org/GLM-5.2`
- `Kimi-K2.7-Code` / `kimi-k2.7-code` / `moonshotai/kimi-k2.7-code`
- `MiniMax-M3` / `minimax/minimax-m3`

## Implementation Plan

### Step 1: Improve canonicalization in fetch-pricing.mjs

Update `canonicalId()` to aggressively normalize:
- Strip date suffixes: `-2024-08-06`, `-2025-07-28`
- Strip `-preview`, `-preview-05-06` suffixes
- Strip `:thinking` suffix
- Keep turbo variants separate (they're genuinely different SKUs with different pricing)
- This canonical ID is used for MATCHING only — the display ID stays as-is

### Step 2: Restructure provider data model

The key insight: **provider** in the data should mean the actual API endpoint the user calls (OpenRouter, DeepInfra, etc.), but the **provider dropdown in the UI** should list ORGS (Anthropic, OpenAI, Mistral...), not aggregators.

Approach:
- Keep `provider` field as-is (the API platform: openrouter, deepinfra, etc.)
- The `org` field is already extracted and normalized
- In the frontend, the "provider" dropdown lists unique orgs, not platform providers
- When user selects an org, filter `models.filter(m => m.org === selectedOrg)`
- The results table already shows both org and provider badges

### Step 3: Replace compare-by dropdown with dual search

Replace the current mode/select pattern:
```
[Search by provider: type "open"... ] [Search by model: type "glm"... ]
```

- Two text inputs with datalist-powered typeahead
- Provider search lists orgs (anthropic, openai, google, deepseek, etc.)
- Model search lists canonical model names (glm-5.2, kimi-k2.6, gpt-4o, etc.)
- Both can be used together (AND filter)
- If both empty: show all

### Step 4: Update index.html

- Remove `mode` select, `model-group`, `provider-group` divs
- Add `provider-search` input with `<datalist id="orgList">`
- Add `model-search` input with `<datalist id="modelList">`
- Remove "compare by" label

### Step 5: Update app.js

- Remove `state.mode`, `state.selectedModel`, `state.selectedProvider`
- Add `state.providerSearch` and `state.modelSearch`
- `populateSelectors()` → `populateDatalists()` — fills both datalists
- `computeAndRender()` filters by both search fields (AND logic)
- Results title updates dynamically: "Results for 'glm' from 'z-ai'"

### Step 6: Update styles.css

- Style the two search inputs to sit side by side
- Remove hidden/visible toggle classes for model/provider groups

## Acceptance Criteria

- [ ] Typing "open" in provider search shows OpenAI models (not "OpenRouter")
- [ ] Typing "glm" in model search shows all GLM variants across providers
- [ ] Both searches work together (type "z-ai" + "glm" → only GLM models from z-ai org)
- [ ] `gpt-4o-2024-08-06` merges with `gpt-4o` in model selection
- [ ] `Kimi-K2.6` (Wafer) merges with `kimi-k2.6` (Crof/OpenRouter/DeepInfra)
- [ ] No "OpenRouter" or "DeepInfra" in the provider dropdown — only orgs
- [ ] Provider dropdown shows orgs: Anthropic, OpenAI, Google, DeepSeek, Z.ai, Qwen, Meta, Mistral...
- [ ] Results table still shows both org badge and provider badge (so user knows which platform serves it)

## Non-goals

- Not adding OpenRouter MCP server integration for V1 of this phase
- Not removing the provider badge from results table (user needs to know which API platform serves the model)
- Not keeping turbo/preview variants as separate entries where they have genuinely different pricing
