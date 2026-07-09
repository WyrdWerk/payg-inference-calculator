import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDER_MAP, REVERSE_PROVIDER_MAP, normalizeForMatch } from '../shared/modelsdev.mjs';

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

// ── REVERSE_PROVIDER_MAP ──────────────────────────────────────────────────────

test('REVERSE_PROVIDER_MAP round-trips every PROVIDER_MAP entry', () => {
  // The map must stay injective so the reverse lookup is unambiguous.
  for (const [tw, md] of Object.entries(PROVIDER_MAP)) {
    assert.equal(REVERSE_PROVIDER_MAP[md], tw, `reverse[${md}] does not round-trip to ${tw}`);
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
