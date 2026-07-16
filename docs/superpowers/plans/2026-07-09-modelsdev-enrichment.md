# models.dev Enrichment Layer — Implementation Plan

> **SHIPPED** — Historical artifact. Implementation complete as of 2026-07. Do not treat checklist/status below as pending work.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate models.dev as a sidecar enrichment source that decorates TokenWatch's text-model catalog with provider base URLs, native model IDs, capability metadata, and cache-pricing null-fills — then surface that data via a clickable model detail card on the text tab.

**Architecture:** A new pure module (`shared/modelsdev.mjs`) holds the provider map, per-provider ID normalizers, and a two-tier matcher (exact normalized + bounded fuzzy). A new fetcher script (`scripts/fetch-modelsdev.mjs`) pulls the single `api.json` endpoint and returns an enrichment map. `fetch-pricing.mjs` calls it after dedup and merges results with a never-overwrite rule. The frontend gains a new detail modal (mirroring the existing compare modal) opened by whole-row click.

**Tech Stack:** Pure Node ESM, zero new dependencies. `node:test` for testing. Vanilla JS frontend (no build step). Cloudflare Pages Functions API unchanged (enrichment is in the data, not the API logic).

## Global Constraints

- **Zero runtime dependencies** — project hard constraint. No npm additions. Pure Node ESM only.
- **`shared/*.mjs` MUST NOT import `node:` builtins** — it's bundled into the Cloudflare Worker (`functions/api/v1/[[route]].js`). Pure string transforms only.
- **All prices are USD per million tokens ($/M)** — the unit convention across the codebase.
- **Never-overwrite merge** — models.dev only fills `null` values in existing fields. Existing pricing/context/cache fields are never replaced.
- **SKU preservation** — `-turbo`, `-fast`, `-nvfp4`, `-highspeed` suffixes are distinct SKUs, never stripped by normalizers.
- **Text-tab only at launch** — the detail card ships on the text tab only. Image/video tabs are unchanged.
- **Node >= 18** (per `package.json` engines).
- **Test command:** `npm test` (runs `node --test test/*.test.mjs`).
- **Cache-bust:** after any frontend file change, the CI `bust:cache` step handles `?v=` rewriting automatically on deploy. No manual version bumps.

**Reference spec:** `docs/superpowers/specs/2026-07-09-modelsdev-enrichment-design.md`

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `shared/modelsdev.mjs` | Pure module: provider map, per-provider ID normalizers, two-tier matcher. No `node:` imports. Imported by the fetcher and re-exported by `scripts/lib.mjs`. |
| `scripts/fetch-modelsdev.mjs` | Node fetcher: pulls `https://models.dev/api.json`, builds enrichment index, returns map. Uses `node:fs` (Node-only, not Worker-bound). |
| `test/modelsdev-normalizers.test.mjs` | Unit tests for `shared/modelsdev.mjs` (provider map, normalizers, matcher). |
| `test/modelsdev-enrichment.test.mjs` | Integration tests for the merge logic (`applyEnrichment`). |
| `test/fixtures/modelsdev-api.json` | Miniature models.dev API fixture (~10 providers / ~30 models) exercising all normalizer patterns + both tiers. |

### Modified files

| Path | Change |
|---|---|
| `scripts/lib.mjs` | Re-export models.dev public API (`PROVIDER_MAP`, `normalizeForMatch`, `findEnrichment`, `applyEnrichment`). |
| `scripts/fetch-pricing.mjs` | Add two lines in `main()` after subscription tagging (line ~825): call `fetchModelsDevEnrichment` + `applyEnrichment`. |
| `test/parity.test.mjs` | Add 3 regression tests for enrichment coverage on real `pricing.json`. |
| `public/index.html` | Add `.detail-modal` markup after `.compare-modal`. |
| `public/styles.css` | Add `.detail-modal*`, `.approx-badge`, `.copy-btn`, `.detail-section` CSS + `tr[data-idx] { cursor: pointer }`. |
| `public/app.js` | Add `showDetailModal`, row-click delegation, Escape handler, copy-to-clipboard, `role=dialog` on both modals. |

---

## Task 1: Provider map + default normalizer

**Files:**
- Create: `shared/modelsdev.mjs`
- Test: `test/modelsdev-normalizers.test.mjs`

**Interfaces:**
- Produces: `PROVIDER_MAP` (object: TW provider slug → models.dev provider_id), `REVERSE_PROVIDER_MAP` (derived), `normalizeForMatch(providerKey, modelId)` (returns normalized string).

- [ ] **Step 1: Write the failing tests**

Create `test/modelsdev-normalizers.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDER_MAP, normalizeForMatch } from '../shared/modelsdev.mjs';

// ── PROVIDER_MAP ──────────────────────────────────────────────────────────────

test('PROVIDER_MAP maps known TW providers to models.dev provider_ids', () => {
  assert.equal(PROVIDER_MAP['deepinfra'], 'deep-infra');
  assert.equal(PROVIDER_MAP['fireworks'], 'fireworks-ai');
  assert.equal(PROVIDER_MAP['together'], 'togetherai');
  assert.equal(PROVIDER_MAP['novita'], 'novita-ai');
  assert.equal(PROVIDER_MAP['moonshot'], 'moonshotai');
  assert.equal(PROVIDER_MAP['sambanova'], 'nova');
  assert.equal(PROVIDER_MAP['z-ai'], 'zai');
  assert.equal(PROVIDER_MAP['xiaomimimo'], 'xiaomi');
  assert.equal(PROVIDER_MAP['wafer'], 'wafer.ai');
  assert.equal(PROVIDER_MAP['amazon'], 'amazon-bedrock');
  assert.equal(PROVIDER_MAP['cloudflare'], 'cloudflare-workers-ai');
});

test('PROVIDER_MAP has no undefined or self-mapping entries except identity', () => {
  for (const [tw, md] of Object.entries(PROVIDER_MAP)) {
    assert.ok(typeof md === 'string' && md.length > 0, `${tw} maps to empty/invalid`);
  }
});

// ── normalizeForMatch: default path (canonicalId only) ───────────────────────

test('normalizeForMatch default: org-prefix IDs collapse via canonicalId', () => {
  // moonshot has no bespoke normalizer → default canonicalId
  assert.equal(normalizeForMatch('moonshot', 'moonshotai/kimi-k2.7-code'), 'kimi-k2.7-code');
  assert.equal(normalizeForMatch('moonshot', 'kimi-k2.7-code'), 'kimi-k2.7-code');
});

test('normalizeForMatch default: case-folded and trimmed', () => {
  assert.equal(normalizeForMatch('openai', 'openai/GPT-5 '), 'gpt-5');
});

test('normalizeForMatch default: unknown provider falls back to canonicalId', () => {
  assert.equal(normalizeForMatch('unknownprov', 'org/model-name'), 'model-name');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../shared/modelsdev.mjs'`

- [ ] **Step 3: Create the module with provider map + default normalizer**

Create `shared/modelsdev.mjs`:

```js
/**
 * shared/modelsdev.mjs — pure reconciliation helpers for the models.dev
 * enrichment source.
 *
 * This module MUST NOT import any node: builtins (same constraint as
 * shared/normalize.mjs). It is pure string-transform logic.
 *
 * Imported by:
 *   - scripts/lib.mjs (re-exports the public surface)
 *   - scripts/fetch-modelsdev.mjs (builds the enrichment index)
 */

import { canonicalId } from './normalize.mjs';

/**
 * TW provider slug → models.dev provider_id.
 * Entries where the slug differs are explicit; identity mappings are
 * included for providers that exist on both sides with the same key
 * (for lookup clarity and so the reverse map derives correctly).
 */
export const PROVIDER_MAP = {
  // slug-format differences (bespoke)
  deepinfra: 'deep-infra',
  fireworks: 'fireworks-ai',
  together: 'togetherai',
  novita: 'novita-ai',
  moonshot: 'moonshotai',
  sambanova: 'nova',
  'z-ai': 'zai',
  xiaomimimo: 'xiaomi',
  wafer: 'wafer.ai',
  amazon: 'amazon-bedrock',
  cloudflare: 'cloudflare-workers-ai',
  // identity mappings (same slug on both sides)
  alibaba: 'alibaba',
  anthropic: 'anthropic',
  azure: 'azure',
  baseten: 'baseten',
  cerebras: 'cerebras',
  chutes: 'chutes',
  clarifai: 'clarifai',
  cohere: 'cohere',
  crof: 'crof',
  deepseek: 'deepseek',
  digitalocean: 'digitalocean',
  friendli: 'friendli',
  gmicloud: 'gmicloud',
  google: 'google',
  groq: 'groq',
  inception: 'inception',
  'io-net': 'io-net',
  lilac: 'lilac',
  minimax: 'minimax',
  mistral: 'mistral',
  morph: 'morph',
  nebius: 'nebius',
  openai: 'openai',
  opencode: 'opencode-go',
  perplexity: 'perplexity',
  poolside: 'poolside',
  sakana: 'sakana',
  stepfun: 'stepfun',
  synthetic: 'synthetic',
  upstage: 'upstage',
  venice: 'venice',
  wandb: 'wandb',
  xai: 'xai',
};

/**
 * Normalize a model ID for join-key purposes, applying any provider-specific
 * transform. Default: canonicalId only. Providers with bespoke ID formats
 * (cloudflare, amazon, fireworks, minimax) are handled in PROVIDER_NORMALIZERS.
 */
export function normalizeForMatch(providerKey, modelId) {
  const fn = PROVIDER_NORMALIZERS[providerKey];
  return fn ? fn(modelId) : canonicalId(modelId);
}

// Filled in by later tasks. Default fallback uses canonicalId.
const PROVIDER_NORMALIZERS = {};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all 5 new tests, plus existing 61 tests still pass = 66 total)

- [ ] **Step 5: Commit**

```bash
git add shared/modelsdev.mjs test/modelsdev-normalizers.test.mjs
git commit -m "feat(modelsdev): add provider map + default normalizer module"
```

---

## Task 2: Cloudflare, Amazon Bedrock, Fireworks, Minimax normalizers

**Files:**
- Modify: `shared/modelsdev.mjs`
- Modify: `test/modelsdev-normalizers.test.mjs`

**Interfaces:**
- Consumes: `canonicalId` from `./normalize.mjs`
- Produces: bespoke normalizers registered in `PROVIDER_NORMALIZERS` (cloudflare, amazon, fireworks, minimax)

- [ ] **Step 1: Write the failing tests**

Append to `test/modelsdev-normalizers.test.mjs` (before any trailing newline):

```js

// ── cloudflare: strip @cf/ prefix ────────────────────────────────────────────

test('normalizeForMatch cloudflare: strips @cf/ prefix then canonicalId', () => {
  assert.equal(
    normalizeForMatch('cloudflare', '@cf/moonshotai/kimi-k2.7-code'),
    'kimi-k2.7-code'
  );
  assert.equal(
    normalizeForMatch('cloudflare', '@cf/google/gemma-4-26b-a4b-it'),
    'gemma-4-26b-a4b-it'
  );
});

// ── amazon-bedrock: strip region prefix + :N versionstamp ────────────────────

test('normalizeForMatch amazon: strips region prefix and :N versionstamp', () => {
  assert.equal(
    normalizeForMatch('amazon', 'global.anthropic.claude-haiku-4-5-20251001-v1:0'),
    'claude-haiku-4-5'
  );
  assert.equal(
    normalizeForMatch('amazon', 'us.meta.llama4-scout-17b-instruct-v1:0'),
    'llama4-scout-17b-instruct'
  );
  assert.equal(
    normalizeForMatch('amazon', 'jp.anthropic.claude-sonnet-4-5-20250929-v1:0'),
    'claude-sonnet-4-5'
  );
});

// ── fireworks: strip accounts/fireworks/{models,routers}/ + decode p→. ───────
// SKU suffixes (-turbo, -fast) are PRESERVED.

test('normalizeForMatch fireworks: strips path prefix and decodes p→. in version', () => {
  assert.equal(
    normalizeForMatch('fireworks', 'accounts/fireworks/models/glm-5p2'),
    'glm-5.2'
  );
  assert.equal(
    normalizeForMatch('fireworks', 'accounts/fireworks/models/glm-5p1'),
    'glm-5.1'
  );
});

test('normalizeForMatch fireworks: PRESERVES -turbo SKU suffix (regression)', () => {
  assert.equal(
    normalizeForMatch('fireworks', 'accounts/fireworks/routers/kimi-k2p6-turbo'),
    'kimi-k2.6-turbo'
  );
});

test('normalizeForMatch fireworks: PRESERVES -fast SKU suffix (regression)', () => {
  assert.equal(
    normalizeForMatch('fireworks', 'accounts/fireworks/models/glm-5p2-fast'),
    'glm-5.2-fast'
  );
  assert.equal(
    normalizeForMatch('fireworks', 'accounts/fireworks/routers/kimi-k2p7-code-fast'),
    'kimi-k2.7-code-fast'
  );
});

// ── minimax: strip duplicated MiniMax- brand prefix ──────────────────────────
// SKU suffixes (-highspeed) are PRESERVED.

test('normalizeForMatch minimax: strips duplicated brand prefix', () => {
  assert.equal(normalizeForMatch('minimax', 'MiniMax-M2.1'), 'm2.1');
  assert.equal(normalizeForMatch('minimax', 'MiniMax-M2.5-highspeed'), 'm2.5-highspeed');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL on the new tests (cloudflare/amazon/fireworks/minimax still using default canonicalId, so e.g. `'@cf/moonshotai/kimi-k2.7-code'` canonicalizes to something containing the `@cf/` artifact, not `'kimi-k2.7-code'`).

- [ ] **Step 3: Implement the four normalizers**

In `shared/modelsdev.mjs`, replace the empty `PROVIDER_NORMALIZERS` declaration at the bottom:

```js
const PROVIDER_NORMALIZERS = {};
```

…with:

```js
/**
 * Strip a leading region segment from a Bedrock model ID.
 *   'global.anthropic.claude-haiku-4-5-20251001-v1:0' → 'anthropic.claude-haiku-4-5-20251001-v1:0'
 *   'us.meta.llama4-scout-17b-instruct-v1:0'          → 'meta.llama4-scout-17b-instruct-v1:0'
 * Regions seen in real data: global, us, eu, jp, ap, sa, ca.
 */
function stripBedrockRegion(id) {
  return id.replace(/^(global|us|eu|jp|ap|sa|ca)\./i, '');
}

/**
 * Normalize an Amazon Bedrock model ID for matching.
 *   'global.anthropic.claude-haiku-4-5-20251001-v1:0'
 *     → strip region → 'anthropic.claude-haiku-4-5-20251001-v1:0'
 *     → first dot = org separator → 'anthropic/claude-haiku-4-5-20251001-v1:0'
 *     → strip :N versionstamp → 'anthropic/claude-haiku-4-5-20251001-v1'
 *     → canonicalId strips date → 'claude-haiku-4-5'
 */
function normalizeAmazon(id) {
  const noRegion = stripBedrockRegion(id);
  const firstDot = noRegion.indexOf('.');
  const withSlash = firstDot > 0
    ? noRegion.slice(0, firstDot) + '/' + noRegion.slice(firstDot + 1)
    : noRegion;
  const noVersion = withSlash.replace(/:\d+$/, '');
  return canonicalId(noVersion);
}

/**
 * Strip the Fireworks accounts/fireworks/{models,routers}/ prefix and decode
 * the version encoding where 'p' replaces '.' (e.g. 'k2p6' → 'k2.6', '5p2' → '5.2').
 * ONLY decodes the version pattern — other 'p' occurrences are left alone.
 * SKU suffixes (-turbo, -fast) are preserved as distinct.
 */
function normalizeFireworks(id) {
  const stripped = id.replace(/^accounts\/fireworks\/(?:models|routers)\//, '');
  // Decode version pattern: a digit followed by 'p' followed by a digit.
  // Applies greedily across multi-segment versions like 'k2p6' (k2.6) and '5p2' (5.2).
  const decoded = stripped.replace(/(\d)p(\d)/g, '$1.$2');
  return canonicalId(decoded);
}

/**
 * Strip the duplicated brand prefix on Minimax models.dev IDs.
 *   'MiniMax-M2.5-highspeed' → 'M2.5-highspeed' → canonicalId → 'm2.5-highspeed'
 * SKU suffixes preserved.
 */
function normalizeMinimax(id) {
  const noBrand = id.replace(/^MiniMax-/i, '');
  return canonicalId(noBrand);
}

const PROVIDER_NORMALIZERS = {
  cloudflare: (id) => canonicalId(id.replace(/^@cf\//, '')),
  amazon: normalizeAmazon,
  fireworks: normalizeFireworks,
  minimax: normalizeMinimax,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all normalizer tests green; existing tests still green)

- [ ] **Step 5: Commit**

```bash
git add shared/modelsdev.mjs test/modelsdev-normalizers.test.mjs
git commit -m "feat(modelsdev): add cloudflare/bedrock/fireworks/minimax normalizers

SKU-preserving (-turbo, -fast, -highspeed kept distinct). Fireworks
decodes version encoding (k2p6 → k2.6). Bedrock strips region prefix +
:N versionstamp. Includes regression tests for SKU preservation."
```

---

## Task 3: Two-tier matcher (exact + bounded fuzzy)

**Files:**
- Modify: `shared/modelsdev.mjs`
- Modify: `test/modelsdev-normalizers.test.mjs`

**Interfaces:**
- Consumes: `normalizeForMatch(providerKey, modelId)` from Task 1
- Produces: `findEnrichment(twProvider, twModelId, providerIndex)` where `providerIndex` is `Map<twProviderKey, Map<normalizedId, enrichmentRecord>>`. Returns `null` or `{ ...record, confidence: 'high'|'medium' }`.

- [ ] **Step 1: Write the failing tests**

Append to `test/modelsdev-normalizers.test.mjs`:

```js

// ── findEnrichment: two-tier matcher ─────────────────────────────────────────

import { findEnrichment } from '../shared/modelsdev.mjs';

function buildIdx(entries) {
  // entries: [[twProvider, normalizedId, record], ...]
  const idx = new Map();
  for (const [prov, nid, rec] of entries) {
    if (!idx.has(prov)) idx.set(prov, new Map());
    idx.get(prov).set(nid, rec);
  }
  return idx;
}

test('findEnrichment Tier A: exact normalized match returns confidence high', () => {
  const idx = buildIdx([
    ['moonshot', 'kimi-k2.7-code', { base_url: 'https://a', model_id: 'kimi-k2.7-code' }],
  ]);
  const r = findEnrichment('moonshot', 'moonshotai/kimi-k2.7-code', idx);
  assert.equal(r.confidence, 'high');
  assert.equal(r.base_url, 'https://a');
});

test('findEnrichment Tier A: no provider in index returns null', () => {
  const idx = buildIdx([]);
  const r = findEnrichment('moonshot', 'moonshotai/kimi-k2.7-code', idx);
  assert.equal(r, null);
});

test('findEnrichment Tier B: fuzzy subset match returns confidence medium', () => {
  // TW 'kimi-k2.7-code' tokens [kimi, k2.7, code] ⊂ MD 'kimi-k2.7-code-fast' tokens
  const idx = buildIdx([
    ['fireworks', 'kimi-k2.7-code-fast', { base_url: 'https://fw', model_id: 'acc/fw/routers/kimi-k2p7-code-fast' }],
  ]);
  const r = findEnrichment('fireworks', 'kimi-k2.7-code', idx);
  assert.equal(r.confidence, 'medium');
  assert.equal(r.base_url, 'https://fw');
});

test('findEnrichment Tier B: refuses if needle has fewer than 2 tokens (length floor)', () => {
  const idx = buildIdx([
    ['openai', 'o3-mini', { base_url: 'https://o' }],
  ]);
  // 'openai/o3' → normalized 'o3' → 1 token → refuse fuzzy
  const r = findEnrichment('openai', 'o3', idx);
  assert.equal(r, null);
});

test('findEnrichment Tier B: refuses on ambiguity (2 candidates)', () => {
  const idx = buildIdx([
    ['fireworks', 'kimi-k2.7-code-fast', { base_url: 'https://a' }],
    ['fireworks', 'kimi-k2.7-code-turbo', { base_url: 'https://b' }],
  ]);
  // 'kimi-k2.7-code' is subset of both → ambiguous → refuse
  const r = findEnrichment('fireworks', 'kimi-k2.7-code', idx);
  assert.equal(r, null);
});

test('findEnrichment Tier B: refuses on non-subset (different tokens)', () => {
  const idx = buildIdx([
    ['openai', 'gpt-5.5', { base_url: 'https://o' }],
  ]);
  // 'gpt-5' tokens [gpt, 5] vs 'gpt-5.5' tokens [gpt, 5.5] — NOT a subset
  const r = findEnrichment('openai', 'gpt-5', idx);
  assert.equal(r, null);
});

test('findEnrichment never crosses providers', () => {
  // TW 'fireworks' needle should NOT match 'togetherai' haystack entries
  const idx = buildIdx([
    ['together', 'kimi-k2.7-code', { base_url: 'https://together' }],
  ]);
  const r = findEnrichment('fireworks', 'kimi-k2.7-code', idx);
  assert.equal(r, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `findEnrichment` is not exported

- [ ] **Step 3: Implement the matcher**

In `shared/modelsdev.mjs`, append before the `PROVIDER_NORMALIZERS` const:

```js
/**
 * Tokenize an ID for fuzzy matching. Splits on . / - _ and drops empty segments.
 */
function tokenize(id) {
  return id.split(/[./\-_]/).filter(Boolean);
}

/**
 * Bounded fuzzy fallback. Returns a single matching key from the haystack, or
 * null if no safe match exists.
 *
 * Rules:
 *  - Same-provider only (caller passes only that provider's keys).
 *  - 2-token floor on both sides.
 *  - Strict subset: shorter token set must be fully contained in longer.
 *  - Single-candidate: if more than one key matches, refuse (ambiguity).
 */
function boundedFuzzyMatch(needle, haystack) {
  const needleTokens = tokenize(needle);
  if (needleTokens.length < 2) return null;
  const candidates = [];
  for (const candidate of haystack) {
    const candTokens = tokenize(candidate);
    if (candTokens.length < 2) continue;
    const [shorter, longer] = needleTokens.length <= candTokens.length
      ? [needleTokens, candTokens]
      : [candTokens, needleTokens];
    const longerSet = new Set(longer);
    const isSubset = shorter.every((t) => longerSet.has(t));
    if (isSubset) candidates.push(candidate);
  }
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * Two-tier matcher. Returns the enrichment record with a `confidence` field
 * ('high' for exact normalized, 'medium' for bounded fuzzy), or null if no match.
 *
 * `providerIndex` is a Map<twProviderKey, Map<normalizedId, enrichmentRecord>>,
 * built by the fetcher script. Cross-provider matching is impossible by
 * construction (each provider has its own inner Map).
 */
export function findEnrichment(twProvider, twModelId, providerIndex) {
  const providerMap = providerIndex.get(twProvider);
  if (!providerMap) return null;
  const exactNorm = normalizeForMatch(twProvider, twModelId);
  if (providerMap.has(exactNorm)) {
    return { ...providerMap.get(exactNorm), confidence: 'high' };
  }
  const fuzzy = boundedFuzzyMatch(exactNorm, [...providerMap.keys()]);
  if (fuzzy) {
    return { ...providerMap.get(fuzzy), confidence: 'medium' };
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all matcher tests green; existing tests still green)

- [ ] **Step 5: Commit**

```bash
git add shared/modelsdev.mjs test/modelsdev-normalizers.test.mjs
git commit -m "feat(modelsdev): add two-tier matcher (exact + bounded fuzzy)

Tier A: exact normalized match (confidence: 'high').
Tier B: bounded fuzzy — subset-only, 2-token floor, single-candidate
requirement, same-provider only (confidence: 'medium'). Cross-provider
matching is structurally impossible."
```

---

## Task 4: Enrichment merge logic (never-overwrite)

**Files:**
- Modify: `shared/modelsdev.mjs`
- Create: `test/modelsdev-enrichment.test.mjs`

**Interfaces:**
- Consumes: `findEnrichment` from Task 3
- Produces: `applyEnrichment(models, providerIndex, log)` — mutates `models` in place, attaching `modelsdev` block and filling nulls per the merge rule. `log` is an array that collects warning strings for disagreements.

- [ ] **Step 1: Write the failing tests**

Create `test/modelsdev-enrichment.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEnrichment } from '../shared/modelsdev.mjs';

function buildIdx(entries) {
  const idx = new Map();
  for (const [prov, nid, rec] of entries) {
    if (!idx.has(prov)) idx.set(prov, new Map());
    idx.get(prov).set(nid, rec);
  }
  return idx;
}

test('applyEnrichment: fills cache_read when TW is null', () => {
  const models = [{ id: 'moonshotai/kimi-k2.7-code', provider: 'moonshot', pricing: { input: 0.95, output: 4.0, cache_read: null, cache_write: null } }];
  const idx = buildIdx([
    ['moonshot', 'kimi-k2.7-code', { base_url: 'https://m', model_id: 'kimi-k2.7-code', cache_read: 0.19, cache_write: null, context_length: null, max_output: null }],
  ]);
  const log = [];
  applyEnrichment(models, idx, log);
  assert.equal(models[0].pricing.cache_read, 0.19);
  assert.equal(models[0].pricing.cache_write, null);
});

test('applyEnrichment: KEEPS TW value when both present (never overwrite)', () => {
  const models = [{ id: 'moonshotai/kimi-k2.7-code', provider: 'moonshot', pricing: { input: 0.95, output: 4.0, cache_read: 0.20, cache_write: null } }];
  const idx = buildIdx([
    ['moonshot', 'kimi-k2.7-code', { base_url: 'https://m', model_id: 'kimi-k2.7-code', cache_read: 0.19, cache_write: 0.5, context_length: null, max_output: null }],
  ]);
  const log = [];
  applyEnrichment(models, idx, log);
  assert.equal(models[0].pricing.cache_read, 0.20, 'TW value kept');
  assert.equal(models[0].pricing.cache_write, 0.5, 'null filled from MD');
  assert.ok(log.some((l) => l.includes('cache_read') && l.includes('disagreement')), 'disagreement logged');
});

test('applyEnrichment: fills context_length when TW is null', () => {
  const models = [{ id: 'moonshotai/kimi-k2.7-code', provider: 'moonshot', context_length: null, pricing: { input: 0.95, output: 4.0, cache_read: null, cache_write: null } }];
  const idx = buildIdx([
    ['moonshot', 'kimi-k2.7-code', { base_url: 'https://m', model_id: 'kimi-k2.7-code', cache_read: null, cache_write: null, context_length: 262144, max_output: 262144 }],
  ]);
  applyEnrichment(models, idx, []);
  assert.equal(models[0].context_length, 262144);
});

test('applyEnrichment: attaches modelsdev block on Tier A match', () => {
  const models = [{ id: 'moonshotai/kimi-k2.7-code', provider: 'moonshot', pricing: { input: 0.95, output: 4.0, cache_read: null, cache_write: null } }];
  const idx = buildIdx([
    ['moonshot', 'kimi-k2.7-code', { base_url: 'https://api.moonshot.com/v1', model_id: 'kimi-k2.7-code', doc_url: 'https://docs.m', cache_read: 0.19, cache_write: null, context_length: 262144, max_output: 262144, release_date: '2026-06-12', knowledge_cutoff: '2025-01', description: 'desc', capabilities: { reasoning: true }, modalities: { input: ['text'], output: ['text'] }, open_weights: true }],
  ]);
  applyEnrichment(models, idx, []);
  assert.equal(models[0].modelsdev.base_url, 'https://api.moonshot.com/v1');
  assert.equal(models[0].modelsdev.model_id, 'kimi-k2.7-code');
  assert.equal(models[0].modelsdev.confidence, 'high');
  assert.equal(models[0].modelsdev.source, 'models.dev');
});

test('applyEnrichment: confidence medium on Tier B match', () => {
  const models = [{ id: 'fireworks/moonshotai/kimi-k2.7-code', provider: 'fireworks', pricing: { input: 0.95, output: 4.0, cache_read: null, cache_write: null } }];
  // Note: 'fireworks/moonshotai/kimi-k2.7-code' canonicalizes via the fireworks
  // normalizer to 'kimi-k2.7-code'. The MD side has 'kimi-k2.7-code-fast'.
  const idx = buildIdx([
    ['fireworks', 'kimi-k2.7-code-fast', { base_url: 'https://fw', model_id: 'acc/fw/x', cache_read: null, cache_write: null, context_length: null, max_output: null }],
  ]);
  applyEnrichment(models, idx, []);
  assert.equal(models[0].modelsdev.confidence, 'medium');
});

test('applyEnrichment: no match leaves modelsdev undefined', () => {
  const models = [{ id: 'unknown/model-x', provider: 'unknownprov', pricing: { input: 1, output: 2, cache_read: null, cache_write: null } }];
  applyEnrichment(models, buildIdx([]), []);
  assert.equal(models[0].modelsdev, undefined);
});

test('applyEnrichment: cache_write=0 from MD is a real value, filled into TW null', () => {
  const models = [{ id: 'z-ai/glm-5.2', provider: 'z-ai', pricing: { input: 1.4, output: 4.4, cache_read: 0.26, cache_write: null } }];
  const idx = buildIdx([
    ['z-ai', 'glm-5.2', { base_url: 'https://z', model_id: 'glm-5.2', cache_read: 0.26, cache_write: 0, context_length: null, max_output: null }],
  ]);
  applyEnrichment(models, idx, []);
  assert.equal(models[0].pricing.cache_write, 0, '0 filled (distinct from null)');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `applyEnrichment` is not exported

- [ ] **Step 3: Implement `applyEnrichment`**

In `shared/modelsdev.mjs`, append after `findEnrichment`:

```js
/**
 * Apply models.dev enrichment to a list of TW models (mutates in place).
 *
 * Merge rule (NEVER overwrite):
 *   - pricing.cache_read, pricing.cache_write, context_length, max_output
 *     are filled from MD ONLY when the TW value is null/undefined.
 *   - When both are non-null and differ, the TW value is kept and a warning
 *     string is pushed to `log`.
 *   - The `modelsdev` block is attached whenever any match (Tier A or B)
 *     is found, regardless of whether cache fields were filled.
 *
 * `providerIndex` is the Map<twProviderKey, Map<normalizedId, record>> from
 * the fetcher. `log` is an array that collects disagreement warnings.
 */
export function applyEnrichment(models, providerIndex, log = []) {
  for (const m of models) {
    const hit = findEnrichment(m.provider, m.id, providerIndex);
    if (!hit) continue;

    // Cache + context fills (never overwrite).
    if (!m.pricing) m.pricing = {};
    for (const [twField, mdField] of [
      ['cache_read', 'cache_read'],
      ['cache_write', 'cache_write'],
    ]) {
      const mdVal = hit[mdField];
      if (mdVal === null || mdVal === undefined) continue;
      if (m.pricing[twField] === null || m.pricing[twField] === undefined) {
        m.pricing[twField] = mdVal;
      } else if (m.pricing[twField] !== mdVal) {
        log.push(`${m.provider}/${m.id} ${twField} disagreement: TW=${m.pricing[twField]} MD=${mdVal} (kept TW)`);
      }
    }
    if (hit.context_length != null) {
      if (m.context_length === null || m.context_length === undefined) {
        m.context_length = hit.context_length;
      } else if (m.context_length !== hit.context_length) {
        log.push(`${m.provider}/${m.id} context_length disagreement: TW=${m.context_length} MD=${hit.context_length} (kept TW)`);
      }
    }
    if (hit.max_output != null) {
      if (m.max_completion_tokens === null || m.max_completion_tokens === undefined) {
        m.max_completion_tokens = hit.max_output;
      } else if (m.max_completion_tokens !== hit.max_output) {
        log.push(`${m.provider}/${m.id} max_output disagreement: TW=${m.max_completion_tokens} MD=${hit.max_output} (kept TW)`);
      }
    }

    // Attach the modelsdev metadata block.
    m.modelsdev = {
      base_url: hit.base_url,
      model_id: hit.model_id,
      doc_url: hit.doc_url ?? null,
      confidence: hit.confidence,
      source: 'models.dev',
      release_date: hit.release_date ?? null,
      knowledge_cutoff: hit.knowledge_cutoff ?? null,
      description: hit.description ?? null,
      capabilities: hit.capabilities ?? null,
      modalities: hit.modalities ?? null,
      open_weights: hit.open_weights ?? null,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all enrichment tests green; existing tests still green)

- [ ] **Step 5: Commit**

```bash
git add shared/modelsdev.mjs test/modelsdev-enrichment.test.mjs
git commit -m "feat(modelsdev): add applyEnrichment with never-overwrite merge

Fills cache_read/cache_write/context_length/max_output nulls from MD.
Attaches modelsdev metadata block on every match (Tier A or B). Logs
disagreements without overwriting. cache_write=0 is a real value,
distinct from null."
```

---

## Task 5: Re-export public API from `scripts/lib.mjs`

**Files:**
- Modify: `scripts/lib.mjs`

**Interfaces:**
- Produces: `scripts/lib.mjs` now re-exports `PROVIDER_MAP`, `normalizeForMatch`, `findEnrichment`, `applyEnrichment` for Node-pipeline consumers.

- [ ] **Step 1: Add the re-export**

In `scripts/lib.mjs`, after the existing `canonicalId`/`orgLookupKey` re-export block (around line 74-75), add:

```js

// models.dev reconciliation helpers live in shared/modelsdev.mjs (pure, no
// node: imports) so they could in principle be bundled into the Worker too.
// Re-exported here for fetch-modelsdev.mjs to consume.
export { PROVIDER_MAP, normalizeForMatch, findEnrichment, applyEnrichment } from '../shared/modelsdev.mjs';
```

- [ ] **Step 2: Verify nothing broke**

Run: `npm test`
Expected: PASS (all 74+ tests still green — this is a pure re-export, no behavior change)

- [ ] **Step 3: Commit**

```bash
git add scripts/lib.mjs
git commit -m "feat(modelsdev): re-export modelsdev public API from lib.mjs"
```

---

## Task 6: models.dev fixture + fetcher script

**Files:**
- Create: `test/fixtures/modelsdev-api.json`
- Create: `scripts/fetch-modelsdev.mjs`

**Interfaces:**
- Consumes: `PROVIDER_MAP`, `normalizeForMatch` from `shared/modelsdev.mjs` (via `./lib.mjs`)
- Produces: `fetchModelsDevEnrichment()` — async function returning a `Map<twProviderKey, Map<normalizedId, enrichmentRecord>>`. Reads from the live `https://models.dev/api.json` endpoint.

- [ ] **Step 1: Create the fixture**

Create `test/fixtures/modelsdev-api.json`:

```json
{
  "moonshotai": {
    "name": "Moonshot AI",
    "api": "https://api.moonshot.ai/v1",
    "doc": "https://platform.moonshot.ai/docs/api/chat",
    "models": {
      "kimi-k2.7-code": {
        "name": "Kimi K2.7 Code",
        "description": "Coding-focused Kimi model",
        "release_date": "2026-06-12",
        "knowledge": "2025-01",
        "modalities": { "input": ["text", "image"], "output": ["text"] },
        "open_weights": true,
        "tool_call": true,
        "reasoning": true,
        "structured_output": true,
        "attachment": true,
        "temperature": true,
        "limit": { "context": 262144, "output": 262144 },
        "cost": { "input": 0.95, "output": 4, "cache_read": 0.19 }
      }
    }
  },
  "fireworks-ai": {
    "name": "Fireworks AI",
    "api": "https://api.fireworks.ai/inference/v1",
    "doc": "https://docs.fireworks.ai/quickstarts",
    "models": {
      "accounts/fireworks/models/glm-5p2": {
        "name": "GLM-5.2",
        "description": "GLM 5.2 on Fireworks",
        "release_date": "2026-06-13",
        "knowledge": "2025-06",
        "modalities": { "input": ["text"], "output": ["text"] },
        "open_weights": true,
        "tool_call": true,
        "reasoning": true,
        "structured_output": false,
        "attachment": false,
        "temperature": true,
        "limit": { "context": 1000000, "output": 131072 },
        "cost": { "input": 1.4, "output": 4.4, "cache_read": 0.26 }
      },
      "accounts/fireworks/routers/kimi-k2p7-code-fast": {
        "name": "Kimi K2.7 Code Fast",
        "description": "Fast variant",
        "release_date": "2026-06-12",
        "knowledge": "2025-01",
        "modalities": { "input": ["text"], "output": ["text"] },
        "open_weights": true,
        "tool_call": true,
        "reasoning": true,
        "structured_output": true,
        "attachment": true,
        "temperature": false,
        "limit": { "context": 262144, "output": 262144 },
        "cost": { "input": 1.9, "output": 8 }
      }
    }
  },
  "amazon-bedrock": {
    "name": "Amazon Bedrock",
    "api": "https://bedrock-runtime.us-east-1.amazonaws.com",
    "doc": "https://docs.aws.amazon.com/bedrock",
    "models": {
      "global.anthropic.claude-haiku-4-5-20251001-v1:0": {
        "name": "Claude Haiku 4.5",
        "description": "Claude Haiku on Bedrock",
        "release_date": "2025-10-15",
        "knowledge": "2025-04",
        "modalities": { "input": ["text", "image"], "output": ["text"] },
        "open_weights": false,
        "tool_call": true,
        "reasoning": true,
        "structured_output": true,
        "attachment": true,
        "temperature": true,
        "limit": { "context": 200000, "output": 64000 },
        "cost": { "input": 1, "output": 5, "cache_read": 0.1, "cache_write": 1.25 }
      }
    }
  },
  "cloudflare-workers-ai": {
    "name": "Cloudflare Workers AI",
    "api": "https://api.cloudflare.com/client/v4/accounts/${CF_ID}/ai/v1",
    "doc": "https://developers.cloudflare.com/workers-ai/",
    "models": {
      "@cf/moonshotai/kimi-k2.7-code": {
        "name": "Kimi K2.7 Code",
        "description": "On Cloudflare",
        "release_date": "2026-06-12",
        "knowledge": "2025-01",
        "modalities": { "input": ["text"], "output": ["text"] },
        "open_weights": true,
        "tool_call": true,
        "reasoning": true,
        "structured_output": false,
        "attachment": false,
        "temperature": true,
        "limit": { "context": 262144, "output": 65536 },
        "cost": { "input": 0.95, "output": 4 }
      }
    }
  },
  "minimax": {
    "name": "MiniMax",
    "api": "https://api.minimax.io/v1",
    "doc": "https://platform.minimax.io/docs",
    "models": {
      "MiniMax-M2.5-highspeed": {
        "name": "MiniMax M2.5 Highspeed",
        "description": "Highspeed variant",
        "release_date": "2026-03-18",
        "knowledge": "2025-01",
        "modalities": { "input": ["text"], "output": ["text"] },
        "open_weights": true,
        "tool_call": true,
        "reasoning": true,
        "structured_output": true,
        "attachment": false,
        "temperature": true,
        "limit": { "context": 204800, "output": 131072 },
        "cost": { "input": 0.3, "output": 1.2 }
      }
    }
  }
}
```

This fixture covers: default normalizer (moonshot), Fireworks path-prefix + version decode + SKU preservation (fireworks), Bedrock region+versionstamp strip (amazon), Cloudflare `@cf/` strip (cloudflare), Minimax brand-strip + SKU preservation (minimax). Five providers, five normalizer patterns.

- [ ] **Step 2: Create the fetcher script**

Create `scripts/fetch-modelsdev.mjs`:

```js
/**
 * fetch-modelsdev.mjs — pulls https://models.dev/api.json and builds the
 * enrichment index consumed by applyEnrichment().
 *
 * Returns: Map<twProviderKey, Map<normalizedId, enrichmentRecord>>
 *
 * The index is built by iterating models.dev providers, finding the matching
 * TW provider key via the reverse map, and keying each model by its
 * normalizeForMatch() output. Unmatched providers (no TW counterpart) are
 * skipped silently.
 *
 * On fetch failure (network, non-OK, malformed JSON), logs a warning and
 * returns an empty Map — the pipeline continues without enrichment.
 */

// Import shared helpers from lib.mjs (the Node-pipeline convention — it re-exports
// the pure shared/*.mjs modules). fetchJson is node:fs-backed and lives here.
import { fetchJson, PROVIDER_MAP, normalizeForMatch } from './lib.mjs';

const MODELSDEV_URL = 'https://models.dev/api.json';

// Reverse map: models.dev provider_id → TW provider slug.
const REVERSE_MAP = new Map();
for (const [twKey, mdId] of Object.entries(PROVIDER_MAP)) {
  REVERSE_MAP.set(mdId, twKey);
}

/**
 * Build the enrichment index from a parsed models.dev API response.
 * Exported for testability (tests pass fixture data instead of fetching).
 */
export function buildIndexFromApi(apiData) {
  const index = new Map(); // twProviderKey → Map<normalizedId, record>
  let modelCount = 0;
  let indexedCount = 0;
  for (const [mdPid, p] of Object.entries(apiData)) {
    const twKey = REVERSE_MAP.get(mdPid);
    if (!twKey) continue; // provider not in TW — skip
    if (!p.models) continue;
    for (const [mdMid, m] of Object.entries(p.models)) {
      modelCount++;
      const normalized = normalizeForMatch(twKey, mdMid);
      if (!normalized) continue;
      if (!index.has(twKey)) index.set(twKey, new Map());
      // First occurrence wins (matches dedup precedence philosophy).
      if (index.get(twKey).has(normalized)) continue;
      const cost = m.cost || {};
      const limit = m.limit || {};
      index.get(twKey).set(normalized, {
        base_url: p.api || null,
        model_id: mdMid,
        doc_url: p.doc || null,
        cache_read: cost.cache_read ?? null,
        cache_write: cost.cache_write ?? null,
        context_length: limit.context ?? null,
        max_output: limit.output ?? null,
        release_date: m.release_date || null,
        knowledge_cutoff: m.knowledge || null,
        description: m.description || null,
        capabilities: {
          reasoning: m.reasoning === true,
          tool_call: m.tool_call === true,
          structured_output: m.structured_output === true,
          attachment: m.attachment === true,
          temperature: m.temperature === true,
        },
        modalities: m.modalities || null,
        open_weights: m.open_weights === true,
      });
      indexedCount++;
    }
  }
  console.log(`  [modelsdev] Indexed ${indexedCount} of ${modelCount} models across ${index.size} TW providers`);
  return index;
}

/**
 * Fetch the live models.dev API and build the enrichment index.
 * Non-fatal: returns an empty Map on any failure.
 */
export async function fetchModelsDevEnrichment() {
  try {
    const t0 = Date.now();
    const data = await fetchJson(MODELSDEV_URL);
    const ms = Date.now() - t0;
    const providerCount = Object.keys(data).length;
    console.log(`✓ models.dev: ${providerCount} providers fetched (${ms}ms)`);
    return buildIndexFromApi(data);
  } catch (err) {
    console.warn(`⚠ models.dev fetch failed — continuing without enrichment: ${err.message}`);
    return new Map();
  }
}
```

- [ ] **Step 3: Verify the module loads cleanly**

Run: `node -e "import('./scripts/fetch-modelsdev.mjs').then(m => console.log('exports:', Object.keys(m)))"`
Expected output: `exports: [ 'buildIndexFromApi', 'fetchModelsDevEnrichment' ]`

- [ ] **Step 4: Commit**

```bash
git add test/fixtures/modelsdev-api.json scripts/fetch-modelsdev.mjs
git commit -m "feat(modelsdev): add fetcher script + test fixture

buildIndexFromApi() builds the (twProvider → normalizedId → record) index
from a parsed api.json. fetchModelsDevEnrichment() wraps it with the live
fetch + non-fatal error handling. Fixture covers all 5 normalizer patterns."
```

---

## Task 7: Wire enrichment into `fetch-pricing.mjs`

**Files:**
- Modify: `scripts/fetch-pricing.mjs`

**Interfaces:**
- Consumes: `fetchModelsDevEnrichment`, `applyEnrichment` (imported from `./lib.mjs` or directly)
- Produces: the main pipeline now attaches `modelsdev` blocks and fills cache/context nulls after subscription tagging.

- [ ] **Step 1: Add the imports**

In `scripts/fetch-pricing.mjs`, find the import block at the top (lines ~33-43). After the existing `import { ... } from './lib.mjs'` statement, add:

```js
import { fetchModelsDevEnrichment, applyEnrichment } from './fetch-modelsdev.mjs';
```

- [ ] **Step 2: Add the enrichment call in main()**

In `main()`, find the subscription-tagging block (ends around line 824 with the `if (subCount > 0) console.log(...)` line). Immediately after that line and before the `if (dryRun) {` block (line 826), insert:

```js

  // ── models.dev enrichment (sidecar) ──
  // Attaches base_url, native model_id, capability metadata, and fills
  // cache/context nulls. Never overwrites existing values. Non-fatal.
  const mdIndex = await fetchModelsDevEnrichment();
  if (mdIndex.size > 0) {
    const disagreements = [];
    applyEnrichment(out.models, mdIndex, disagreements);
    const enriched = out.models.filter((m) => m.modelsdev).length;
    const tierA = out.models.filter((m) => m.modelsdev?.confidence === 'high').length;
    const tierB = out.models.filter((m) => m.modelsdev?.confidence === 'medium').length;
    console.log(`  models.dev enrichment: ${enriched}/${out.models.length} (Tier A: ${tierA}, Tier B: ${tierB})`);
    if (disagreements.length > 0) {
      console.log(`  models.dev disagreements (TW value kept): ${disagreements.length}`);
      for (const d of disagreements.slice(0, 5)) console.log(`    ${d}`);
      if (disagreements.length > 5) console.log(`    ... ${disagreements.length - 5} more`);
    }
    // Unmatched-by-provider breakdown for future normalizer tuning.
    const unmatchedByProvider = {};
    for (const m of out.models) {
      if (!m.modelsdev) unmatchedByProvider[m.provider] = (unmatchedByProvider[m.provider] || 0) + 1;
    }
    const topUnmatched = Object.entries(unmatchedByProvider).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (topUnmatched.length > 0) {
      console.log('  Unmatched by provider (top 5): ' + topUnmatched.map(([p, c]) => `${p}=${c}`).join(', '));
    }
  }
```

- [ ] **Step 3: Verify the pipeline runs end-to-end (dry run)**

Run: `npm run fetch -- --dry-run 2>&1 | tail -25`
Expected: the existing dry-run summary, now including lines like:
```
✓ models.dev: 152 providers fetched (XXXms)
  [modelsdev] Indexed N of M models across K TW providers
  models.dev enrichment: ~700/920 (Tier A: ~660, Tier B: ~40)
  models.dev disagreements (TW value kept): NN
    ...
  Unmatched by provider (top 5): deepinfra=100, siliconflow=35, ...
```
The enrichment count should be roughly 600-760. If it's 0, the fetcher failed silently — check the `⚠ models.dev fetch failed` line.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS (all existing tests still green; no behavior regressions)

- [ ] **Step 5: Commit**

```bash
git add scripts/fetch-pricing.mjs
git commit -m "feat(modelsdev): wire enrichment into the main pipeline

Runs after subscription tagging, before the dry-run check. Logs Tier A/B
counts, disagreement count (with samples), and unmatched-by-provider
breakdown to guide future normalizer tuning."
```

---

## Task 8: Fetch live data + add parity regression tests

**Files:**
- Modify: `test/parity.test.mjs`

**Interfaces:**
- Consumes: real `public/pricing.json` (produced by the pipeline with enrichment enabled)

- [ ] **Step 1: Fetch real enriched data**

Run: `npm run fetch`
Expected: writes `public/pricing.json` with `modelsdev` blocks on ~700 models. Pipeline log shows the enrichment summary.

- [ ] **Step 2: Verify the enrichment landed**

Run: `node -e "const d = JSON.parse(require('fs').readFileSync('public/pricing.json','utf-8')); const e = d.models.filter(m => m.modelsdev); console.log('enriched:', e.length, '/', d.models.length); console.log('Tier A:', e.filter(m => m.modelsdev.confidence==='high').length); console.log('Tier B:', e.filter(m => m.modelsdev.confidence==='medium').length);"`
Expected: enriched count > 550 (Tier A + Tier B combined). If lower, a normalizer may need tuning — but do not block the plan on this; log it for Phase 3 iteration.

- [ ] **Step 3: Add parity regression tests**

Append to `test/parity.test.mjs`:

```js

// ── models.dev enrichment regression guards ──────────────────────────────────

test('models.dev enrichment coverage floor (≥60% of catalog)', async () => {
  const data = JSON.parse(await readFile(PRICING_JSON, 'utf-8'));
  const enriched = data.models.filter((m) => m.modelsdev).length;
  const pct = enriched / data.models.length;
  assert.ok(pct >= 0.60,
    `enrichment coverage ${(pct * 100).toFixed(1)}% below 60% floor — a normalizer may have regressed`);
});

test('models.dev confidence values are always "high" or "medium"', async () => {
  const data = JSON.parse(await readFile(PRICING_JSON, 'utf-8'));
  for (const m of data.models) {
    if (!m.modelsdev) continue;
    assert.ok(
      m.modelsdev.confidence === 'high' || m.modelsdev.confidence === 'medium',
      `${m.provider}/${m.id} has invalid confidence: ${m.modelsdev.confidence}`
    );
  }
});

test('models.dev base_url is always an https URL', async () => {
  const data = JSON.parse(await readFile(PRICING_JSON, 'utf-8'));
  for (const m of data.models) {
    if (!m.modelsdev) continue;
    assert.ok(
      typeof m.modelsdev.base_url === 'string' && m.modelsdev.base_url.startsWith('https://'),
      `${m.provider}/${m.id} has invalid base_url: ${m.modelsdev.base_url}`
    );
  }
});
```

- [ ] **Step 4: Run the test suite**

Run: `npm test`
Expected: PASS (all tests green including the 3 new parity tests). If the coverage-floor test fails, the fetcher is underperforming — investigate the unmatched-by-provider log from the pipeline run and add normalizers as needed (Phase 3 work, but at minimum confirm Tier A is working).

- [ ] **Step 5: Commit**

```bash
git add public/pricing.json test/parity.test.mjs
git commit -m "feat(modelsdev): fetch live enriched data + parity regression tests

Coverage floor ≥60%, confidence ∈ {high, medium}, base_url is https.
Pricing.json now carries modelsdev blocks on ~700 text models."
```

---

## Task 9: Frontend detail modal markup + CSS

**Files:**
- Modify: `public/index.html`
- Modify: `public/styles.css`

**Interfaces:**
- Produces: `#detailModal`, `#detailClose`, `#detailBody` DOM nodes (mirrors the existing `#compareModal` structure).

- [ ] **Step 1: Add the modal markup**

In `public/index.html`, find the existing compare modal block (search for `id="compareModal"`). Immediately after its closing `</div>` (the outermost one), add:

```html

    <!-- Detail modal (per-model enrichment view) -->
    <div class="detail-modal" id="detailModal" style="display:none;">
      <div class="detail-modal-content">
        <div class="detail-modal-header">
          <h2 id="detailTitle">—</h2>
          <button id="detailClose" type="button">✕</button>
        </div>
        <div id="detailBody"></div>
      </div>
    </div>
```

- [ ] **Step 2: Add the CSS**

In `public/styles.css`, find the existing `.compare-modal` block. Immediately after the `.compare-cheapest` rule (the last compare-related rule), add:

```css

/* ── Detail modal (per-model enrichment) ──────────────────────────────────── */
.detail-modal {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex; align-items: center; justify-content: center;
  z-index: 200;
}
.detail-modal-content {
  background: var(--surface, #fff);
  color: var(--text, #1a1a1a);
  border-radius: var(--radius, 8px);
  max-width: 560px; width: 90vw;
  max-height: 85vh; overflow: auto;
  padding: 1.5rem;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
}
@media (max-width: 640px) {
  .detail-modal-content { max-width: 90vw; padding: 1rem; }
}
.detail-modal-header {
  display: flex; justify-content: space-between; align-items: flex-start;
  margin-bottom: 1rem; gap: 1rem;
}
.detail-modal-header h2 {
  margin: 0; font-size: 1.25rem; font-weight: 700; line-height: 1.3;
}
.detail-modal-header button {
  border: none; background: none; cursor: pointer;
  font-size: 1.25rem; color: var(--text-dim, #888); padding: 0;
}
.detail-modal-header button:hover { color: var(--text, #1a1a1a); }
.detail-subtitle {
  font-size: 0.85rem; color: var(--text-dim, #888);
  margin: 0.25rem 0 0 0;
}
.detail-section {
  border-top: 1px solid var(--border, #e5e5e5);
  padding-top: 0.75rem; margin-top: 1rem;
}
.detail-section-title {
  font-size: 0.7rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.05em; color: var(--text-dim, #888);
  margin-bottom: 0.5rem;
}
.detail-field {
  display: flex; align-items: center; justify-content: space-between;
  gap: 0.75rem; padding: 0.35rem 0;
  font-size: 0.9rem;
}
.detail-field-label { color: var(--text-dim, #888); min-width: 80px; }
.detail-field-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.82rem; text-align: right; word-break: break-all; flex: 1;
}
.detail-field-value a { color: var(--accent, #1E6E8E); text-decoration: none; }
.detail-field-value a:hover { text-decoration: underline; }
.detail-pricing-grid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.5rem;
  margin-top: 0.5rem;
}
.detail-pricing-cell {
  text-align: center; padding: 0.5rem; background: var(--surface-2, #f5f5f5);
  border-radius: var(--radius-sm, 4px);
}
.detail-pricing-cell-label {
  font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.03em;
  color: var(--text-dim, #888); margin-bottom: 0.2rem;
}
.detail-pricing-cell-value { font-weight: 600; font-size: 0.95rem; }
.detail-capabilities {
  display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.5rem;
}
.detail-capability {
  font-size: 0.75rem; padding: 0.2rem 0.5rem; border-radius: var(--radius-sm, 4px);
  background: var(--surface-2, #f5f5f5); color: var(--text, #1a1a1a);
}
.detail-modalality-line { font-size: 0.85rem; margin-top: 0.5rem; color: var(--text-dim, #888); }
.detail-description { font-size: 0.88rem; line-height: 1.5; margin-top: 0.5rem; }
.detail-provenance { font-size: 0.78rem; color: var(--text-dim, #888); margin-top: 0.5rem; }
.detail-actions {
  display: flex; gap: 0.5rem; margin-top: 1.5rem; flex-wrap: wrap;
}
.detail-actions button, .detail-actions a {
  font-size: 0.85rem; padding: 0.5rem 1rem; border-radius: var(--radius-sm, 4px);
  border: 1px solid var(--border, #e5e5e5); background: var(--surface, #fff);
  color: var(--text, #1a1a1a); cursor: pointer; text-decoration: none;
  display: inline-block;
}
.detail-actions button:hover, .detail-actions a:hover {
  background: var(--surface-2, #f5f5f5);
}
.detail-no-enrich {
  font-size: 0.85rem; color: var(--text-dim, #888); font-style: italic;
  padding: 0.5rem 0;
}
.approx-badge {
  display: inline-block; font-size: 0.65rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.03em;
  padding: 0.1rem 0.3rem; border-radius: var(--radius-sm, 4px);
  background: color-mix(in srgb, var(--yellow, #e8a838) 20%, transparent);
  color: var(--yellow, #e8a838);
  border: 1px solid color-mix(in srgb, var(--yellow, #e8a838) 40%, transparent);
  margin-left: 0.5rem; vertical-align: middle;
}
.copy-btn {
  border: none; background: none; cursor: pointer; padding: 0 0.25rem;
  font-size: 0.9rem; color: var(--text-dim, #888);
}
.copy-btn:hover { color: var(--text, #1a1a1a); }
tbody tr[data-idx] { cursor: pointer; }
tbody tr[data-idx]:hover { background: var(--surface-2, #f5f5f5); }
```

- [ ] **Step 3: Verify the page still loads**

Run: `npm run serve &` then `sleep 2 && curl -s http://localhost:3000 | grep -c 'detailModal'`
Expected: `1` (the new modal markup is present). Kill the server: `kill %1`

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/styles.css
git commit -m "feat(card): add detail modal markup + CSS

Mirrors the existing compare modal structure. New .approx-badge,
.copy-btn, .detail-section, responsive 640px breakpoint. Rows now
show cursor:pointer + hover affordance for clickability."
```

---

## Task 10: Frontend detail modal logic + row click + Escape + clipboard

**Files:**
- Modify: `public/app.js`

**Interfaces:**
- Consumes: existing `state.currentRows`, `els` cache, `esc()`, `orgDisplay()`, `providerName()` helpers, the existing compare-add logic.
- Produces: `showDetailModal(idx)`, extended `els.resultsBody` click delegation, global Escape handler, copy-to-clipboard helper.

- [ ] **Step 1: Add DOM cache entries for the detail modal**

In `public/app.js`, find the `els` object initialization (search for `compareModal:` to find the pattern). Add three new entries to the same object literal:

```js
    detailModal: document.getElementById('detailModal'),
    detailClose: document.getElementById('detailClose'),
    detailBody: document.getElementById('detailBody'),
```

- [ ] **Step 2: Add the detail-modal rendering function**

In `public/app.js`, find `showCompareModal` (search for `function showCompareModal`). Immediately before it, add:

```js
function closeDetailModal() {
  els.detailModal.style.display = 'none';
}

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(
    () => { btn.textContent = '✓'; setTimeout(() => { btn.textContent = '📋'; }, 1200); },
    () => { btn.textContent = '✗'; setTimeout(() => { btn.textContent = '📋'; }, 1200); }
  );
}

function showDetailModal(idx) {
  const r = state.currentRows[idx];
  if (!r) return;
  const md = r.modelsdev;
  const parts = [];

  // Header
  parts.push(`<div class="detail-subtitle">${esc(orgDisplay(r.org))} · via ${esc(providerName(r.provider))}` +
    (md && md.confidence === 'medium' ? ' <span class="approx-badge" title="Matched by fuzzy logic against models.dev — verify before configuring">⚠ approx</span>' : '') +
    `</div>`);

  // Section: Connect (only if enrichment exists)
  if (md) {
    parts.push('<div class="detail-section"><div class="detail-section-title">Connect</div>');
    parts.push(`<div class="detail-field"><span class="detail-field-label">Base URL</span>` +
      `<span class="detail-field-value">${esc(md.base_url || '—')} <button class="copy-btn" data-copy="${esc(md.base_url || '')}">📋</button></span></div>`);
    parts.push(`<div class="detail-field"><span class="detail-field-label">Model ID</span>` +
      `<span class="detail-field-value">${esc(md.model_id || '—')} <button class="copy-btn" data-copy="${esc(md.model_id || '')}">📋</button></span></div>`);
    if (md.doc_url) {
      parts.push(`<div class="detail-field"><span class="detail-field-label">Docs</span>` +
        `<span class="detail-field-value"><a href="${esc(md.doc_url)}" target="_blank" rel="noopener">${esc(md.doc_url)} ↗</a></span></div>`);
    }
    parts.push('</div>');
  } else {
    parts.push('<div class="detail-section"><div class="detail-no-enrich">Direct configuration not available for this provider — use OpenRouter.</div></div>');
  }

  // Section: Pricing
  const p = r.pricing || {};
  parts.push('<div class="detail-section"><div class="detail-section-title">Pricing ($/M tokens)</div>');
  parts.push('<div class="detail-pricing-grid">');
  parts.push(`<div class="detail-pricing-cell"><div class="detail-pricing-cell-label">Input</div><div class="detail-pricing-cell-value">${p.input != null ? '$' + p.input : '—'}</div></div>`);
  parts.push(`<div class="detail-pricing-cell"><div class="detail-pricing-cell-label">Output</div><div class="detail-pricing-cell-value">${p.output != null ? '$' + p.output : '—'}</div></div>`);
  parts.push(`<div class="detail-pricing-cell"><div class="detail-pricing-cell-label">Cache read</div><div class="detail-pricing-cell-value">${p.cache_read != null ? '$' + p.cache_read : '—'}</div></div>`);
  parts.push(`<div class="detail-pricing-cell"><div class="detail-pricing-cell-label">Cache write</div><div class="detail-pricing-cell-value">${p.cache_write != null ? '$' + p.cache_write : '—'}</div></div>`);
  parts.push('</div></div>');

  // Section: Capabilities (only if enrichment exists)
  if (md && md.capabilities) {
    const caps = md.capabilities;
    const trueCaps = [];
    if (caps.reasoning) trueCaps.push('Reasoning');
    if (caps.tool_call) trueCaps.push('Tool call');
    if (caps.structured_output) trueCaps.push('Structured output');
    if (caps.attachment) trueCaps.push('Attachment');
    if (caps.temperature) trueCaps.push('Temperature');
    parts.push('<div class="detail-section"><div class="detail-section-title">Capabilities</div>');
    if (trueCaps.length > 0) {
      parts.push('<div class="detail-capabilities">' + trueCaps.map((c) => `<span class="detail-capability">✓ ${esc(c)}</span>`).join('') + '</div>');
    }
    if (md.modalities) {
      const inp = (md.modalities.input || []).join(', ');
      const out = (md.modalities.output || []).join(', ');
      parts.push(`<div class="detail-modalality-line">Input: ${esc(inp)} → Output: ${esc(out)}</div>`);
    }
    parts.push('</div>');

    // Section: About
    parts.push('<div class="detail-section"><div class="detail-section-title">About</div>');
    if (md.description) {
      const desc = md.description.length > 200 ? md.description.slice(0, 200) + '…' : md.description;
      parts.push(`<div class="detail-description" title="${esc(md.description)}">${esc(desc)}</div>`);
    }
    const provBits = [];
    if (md.release_date) provBits.push('Released ' + esc(md.release_date));
    if (md.knowledge_cutoff) provBits.push('Knowledge cutoff ' + esc(md.knowledge_cutoff));
    if (md.open_weights === true) provBits.push('Open weights ✓');
    if (provBits.length > 0) parts.push(`<div class="detail-provenance">${provBits.join(' · ')}</div>`);
    parts.push('</div>');
  }

  // Footer actions
  parts.push('<div class="detail-actions">');
  parts.push(`<button type="button" id="detailAddCompare">Add to compare</button>`);
  parts.push(`<a href="https://openrouter.ai/model/${encodeURIComponent(r.id)}" target="_blank" rel="noopener">Open in OpenRouter ↗</a>`);
  parts.push('</div>');

  els.detailTitle.textContent = r.name || r.id;
  els.detailBody.innerHTML = parts.join('');
  els.detailModal.style.display = '';

  // Wire footer actions + copy buttons
  const addBtn = document.getElementById('detailAddCompare');
  if (addBtn) addBtn.addEventListener('click', () => { closeDetailModal(); addToCompare(idx); });
  for (const btn of els.detailBody.querySelectorAll('.copy-btn')) {
    btn.addEventListener('click', () => copyToClipboard(btn.dataset.copy, btn));
  }
}
```

Note: `addToCompare` is the existing function referenced at `app.js` in the compare logic — verify the exact name by grepping `function addToCompare` or `addToCompare(`; if it's named differently (e.g. `addCompare`), adjust the call to match.

- [ ] **Step 3: Extend the row-click delegation**

In `public/app.js`, find the existing `els.resultsBody.addEventListener('click', ...)` handler (around line 359-368). Replace the entire listener with:

```js
  els.resultsBody.addEventListener('click', (e) => {
    // Compare checkbox — handled by change event, ignore here.
    if (e.target.closest('.compare-check')) return;
    // Group header toggle.
    const header = e.target.closest('.group-header');
    if (header) {
      header.classList.toggle('collapsed');
      return;
    }
    // Detail card open (any other click on a body row).
    const tr = e.target.closest('tr[data-idx]');
    if (tr) {
      const idx = Number(tr.dataset.idx);
      if (Number.isInteger(idx)) showDetailModal(idx);
    }
  });
```

- [ ] **Step 4: Add close handlers for the detail modal + global Escape**

In `public/app.js`, find the existing compare-modal close handler block (search for `els.compareClose`). Immediately after that block, add:

```js
  els.detailClose.addEventListener('click', closeDetailModal);
  els.detailModal.addEventListener('click', (e) => {
    if (e.target === els.detailModal) closeDetailModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (els.detailModal.style.display !== 'none') closeDetailModal();
    if (els.compareModal.style.display !== 'none') closeCompareModal();
  });
```

- [ ] **Step 5: Add accessibility attributes to both modals**

In `public/index.html`, add these attributes to the existing `<div class="compare-modal" id="compareModal" ...>` opening tag:

```html
role="dialog" aria-modal="true" aria-labelledby="compareModalTitle"
```

And to the new `<div class="detail-modal" id="detailModal" ...>` opening tag:

```html
role="dialog" aria-modal="true" aria-labelledby="detailTitle"
```

(The compare modal's `<h2>` should get `id="compareModalTitle"` if it doesn't already — verify and add if missing.)

- [ ] **Step 6: Manual verification**

Run: `npm run serve`
Open `http://localhost:3000` in a browser. Verify:
1. Clicking any model row opens the detail card.
2. The card shows Connect / Pricing / (Capabilities/About when enriched) sections.
3. The 📋 buttons copy base_url and model_id to clipboard (check by pasting elsewhere).
4. The ⚠ approx pill appears on Tier B matches (find one by inspecting `pricing.json` for `"confidence": "medium"`).
5. Escape closes the card. Backdrop click closes the card. ✕ closes the card.
6. The compare checkbox still works (clicking it does NOT open the card).
7. Mobile: resize to ≤640px, click a card-row, card opens and is readable.
8. The "Add to compare" button in the card adds the model to the compare tray.

Kill the server when done.

- [ ] **Step 7: Commit**

```bash
git add public/app.js public/index.html
git commit -m "feat(card): detail modal logic + row-click + Escape + clipboard

showDetailModal renders 4 conditional sections (header/connect/pricing/
capabilities). Whole-row clickable via delegated handler; compare checkbox
isolated. Copy-to-clipboard on base_url + model_id. Escape closes both
modals (bonus fix for compare). role=dialog + aria-modal on both."
```

---

## Task 11: Final verification + docs update

**Files:**
- Modify: `AGENTS.md`
- Modify: `TODO.md`

- [ ] **Step 1: Run the full test suite one more time**

Run: `npm test`
Expected: PASS — all tests green (existing + all new). Test count should be ~100 (61 baseline + ~30 normalizers + ~15 enrichment + 3 parity).

- [ ] **Step 2: Run the pipeline end-to-end one more time**

Run: `npm run fetch`
Expected: completes successfully, writes `public/pricing.json` with enrichment blocks, no fatal errors.

- [ ] **Step 3: Update AGENTS.md**

In `AGENTS.md`, find the "Files to know" table. Add a new row after the `shared/normalize.mjs` row:

```markdown
| `shared/modelsdev.mjs` | Pure reconciliation helpers for the models.dev enrichment source — provider map, per-provider ID normalizers (cloudflare/amazon/fireworks/minimax), two-tier matcher (exact + bounded fuzzy). Imported by the pipeline via `scripts/lib.mjs`. |
```

And add a new row after the `scripts/fetch-pricing.mjs` row:

```markdown
| `scripts/fetch-modelsdev.mjs` | Sidecar fetcher for models.dev enrichment — pulls `https://models.dev/api.json` (single call, non-fatal), builds the `(twProvider → normalizedId → record)` index. Called by `fetch-pricing.mjs` after subscription tagging. |
```

Then, in the "Architecture" section near the top, add a new bullet after the Data pipeline bullet:

```markdown
- **models.dev enrichment**: after the 3-tier fetch + dedup, `fetch-pricing.mjs` calls `fetchModelsDevEnrichment()` (sidecar, non-fatal) which pulls `https://models.dev/api.json` and builds a `(provider, normalizedModelId)` index. `applyEnrichment()` decorates each model with a `modelsdev` block (base URL, native model ID, capability metadata) and fills `null` cache_read/cache_write/context_length/max_output values. Never overwrites existing values. Two-tier matching: Tier A (exact normalized, confidence `'high'`) + Tier B (bounded fuzzy subset, confidence `'medium'`, surfaces a ⚠ pill in the UI).
```

- [ ] **Step 4: Update TODO.md**

In `TODO.md`, add a new section after the "API enhancements" section:

```markdown
### models.dev enrichment — ✅ IMPLEMENTED
**Status**: Implemented. ~700 of 920 text models enriched with base URL, native model ID, capability metadata, and cache-pricing null-fills.

**What's done**:
- `shared/modelsdev.mjs`: provider map (48 entries), 4 bespoke ID normalizers (cloudflare, amazon-bedrock, fireworks, minimax), two-tier matcher (exact + bounded fuzzy)
- `scripts/fetch-modelsdev.mjs`: sidecar fetcher, non-fatal on failure
- Pipeline integration in `fetch-pricing.mjs` (runs after subscription tagging)
- Frontend detail modal: whole-row clickable, 4 conditional sections (connect/pricing/capabilities/about), copy-to-clipboard, ⚠ pill for Tier B matches
- Test suite: `test/modelsdev-normalizers.test.mjs`, `test/modelsdev-enrichment.test.mjs`, 3 new parity regression tests

**Remaining**:
- Image/video tab detail cards (deferred — models.dev has no image/video pricing)
- Tuning normalizers for providers with high unmatched counts (DeepInfra has 0 models on MD; others may need format-specific normalizers as miss patterns emerge from logs)
```

- [ ] **Step 5: Final commit**

```bash
git add AGENTS.md TODO.md
git commit -m "docs: document models.dev enrichment layer in AGENTS.md + TODO.md"
```

- [ ] **Step 6: Verify git status is clean**

Run: `git status`
Expected: `nothing to commit, working tree clean`

---

## Done criteria

All of the following must be true:

- [ ] `npm test` passes with ~100 tests (was 61, added ~39)
- [ ] `npm run fetch` succeeds and produces `public/pricing.json` with `modelsdev` blocks on ≥60% of models
- [ ] `npm run serve` + manual click-test confirms the detail card opens on row click, shows all sections, copy buttons work, Escape closes, ⚠ pill appears on Tier B matches
- [ ] No existing tests regressed
- [ ] No new runtime dependencies added (`package.json` unchanged)
- [ ] `AGENTS.md` and `TODO.md` reflect the new feature
- [ ] Git working tree clean

## Notes for the implementer

- **`addToCompare` function name**: verify the exact name in `public/app.js` before referencing it in `showDetailModal`. The codebase uses both `addToCompare` and similar names in different places — grep first.
- **`esc()` helper**: already defined at `app.js:774-776`. Reuse it for all user-visible string interpolation in the card.
- **`orgDisplay()` and `providerName()`**: already defined; reuse them for the card subtitle.
- **CSS variables**: the new CSS uses `var(--surface)`, `var(--text)`, `var(--accent)`, etc. These are defined in `styles.css` `:root`. Verify they exist; if any are named differently in this codebase, adjust. The fallback values (e.g. `var(--surface, #fff)`) protect against missing vars.
- **`color-mix` browser support**: used for `.approx-badge`. Supported in all modern browsers (Chrome 111+, Firefox 113+, Safari 16.2+). Already used throughout the existing badge styles — no new risk.
- **`navigator.clipboard`**: requires HTTPS or localhost. The production site (Cloudflare Pages) is HTTPS; local `npm run serve` is localhost. Both work. The `try/catch` in `copyToClipboard` handles unsupported browsers gracefully.
- **Test count**: the exact final count depends on how many test cases you write per `test()` block. The targets (~30 normalizer, ~15 enrichment, 3 parity) are approximate — aim for thorough coverage, not an exact number.
- **If Tier A yield is below 60%** after Task 8: do not block the plan. The parity test will fail, which is the correct signal — investigate the unmatched-by-provider log, add a normalizer for the biggest miss bucket, re-run. This is the incremental-tuning workflow the design explicitly supports.
