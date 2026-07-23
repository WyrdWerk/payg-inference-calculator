/**
 * test/aa-enrichment.test.mjs — Tests for AA benchmark enrichment.
 *
 * Run: node --test test/aa-enrichment.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndexFromModels } from '../scripts/fetch-aa.mjs';
import { applyAAEnrichment } from '../shared/benchmarks.mjs';

// ── Test 1: Slug conversion ──────────────────────────────────────────────────

test('slugToDotted converts AA slugs to dotted canonical IDs', () => {
  const slugToDotted = (slug) => slug.replace(/(\d)-(\d)/g, '$1.$2');

  const fixtures = [
    ['glm-5-2', 'glm-5.2'],
    ['qwen3-5-35b-a3b', 'qwen3.5-35b-a3b'],
    ['kimi-k2-7-code', 'kimi-k2.7-code'],
    // Note: dates also get converted by the regex (AA slugs don't have dates)
    ['gpt-4o-2024-08-06', 'gpt-4o-2024.08.06'],
    ['claude-sonnet-5-turbo', 'claude-sonnet-5-turbo'], // no digit-digit pattern
  ];

  for (const [slug, expected] of fixtures) {
    const result = slugToDotted(slug);
    assert.equal(result, expected, `slug "${slug}" should convert to "${expected}"`);
  }
});

// ── Test 2: No-overwrite behavior ────────────────────────────────────────────

test('applyAAEnrichment does not overwrite existing non-null intelligence_index', () => {
  const aaIndex = buildIndexFromModels([
    { slug: 'glm-5-2', intelligence_index: 60, coding_index: 70, agentic_index: 50 },
  ]);

  const models = [
    { id: 'zai/glm-5.2-fp8', benchmarks: { intelligence_index: 50, coding_index: null, agentic_index: null } },
  ];

  const result = applyAAEnrichment(models, aaIndex);

  // Should not have overwritten the existing value
  assert.equal(models[0].benchmarks.intelligence_index, 50, 'intelligence_index should remain 50, not be overwritten by AA 60');
  // But coding and agentic should be filled from null
  assert.equal(models[0].benchmarks.coding_index, 70, 'coding_index should be filled');
  assert.equal(models[0].benchmarks.agentic_index, 50, 'agentic_index should be filled');
  assert.equal(result.filledCount, 2, 'should have filled 2 indices (coding + agentic)');
});

// ── Test 3: Fill null indices ────────────────────────────────────────────────

test('applyAAEnrichment fills null intelligence_index from AA', () => {
  const aaIndex = buildIndexFromModels([
    { slug: 'glm-5-2', intelligence_index: 51.1, coding_index: 68.8, agentic_index: 43.1 },
  ]);

  const models = [
    { id: 'zai/glm-5.2-fp8', benchmarks: { intelligence_index: null, coding_index: null, agentic_index: null, design_arena_best: null } },
  ];

  const result = applyAAEnrichment(models, aaIndex);

  assert.equal(models[0].benchmarks.intelligence_index, 51.1);
  assert.equal(models[0].benchmarks.coding_index, 68.8);
  assert.equal(models[0].benchmarks.agentic_index, 43.1);
  assert.equal(result.filledCount, 3, 'should have filled 3 indices');
});

// ── Test 4: Fill undefined benchmarks block ──────────────────────────────────

test('applyAAEnrichment creates benchmarks block when missing', () => {
  const aaIndex = buildIndexFromModels([
    { slug: 'gpt-4o', intelligence_index: 55.0, coding_index: 60.0, agentic_index: 50.0 },
  ]);

  const models = [
    { id: 'openai/gpt-4o' }, // no benchmarks block
  ];

  const result = applyAAEnrichment(models, aaIndex);

  assert.ok(models[0].benchmarks, 'should create benchmarks block');
  assert.equal(models[0].benchmarks.intelligence_index, 55.0);
  assert.equal(models[0].benchmarks.coding_index, 60.0);
  assert.equal(models[0].benchmarks.agentic_index, 50.0);
  assert.equal(models[0].benchmarks.design_arena_best, null, 'design_arena_best should remain null');
  assert.equal(result.filledCount, 3);
});

// ── Test 5: Collision resolution — prefer non-turbo ──────────────────────────

test('Collision resolution: prefer non-turbo entry', () => {
  // AA has both glm-5 (intel=39.5) and glm-5-turbo (intel=38.1)
  const aaIndex = buildIndexFromModels([
    { slug: 'glm-5', intelligence_index: 39.5, coding_index: 50.0, agentic_index: 40.0 },
    { slug: 'glm-5-turbo', intelligence_index: 38.1, coding_index: 45.0, agentic_index: 35.0 },
  ]);

  // Should have only one entry (glm-5, the non-turbo one)
  assert.equal(aaIndex.size, 1, 'should have one entry after collision resolution');
  assert.ok(aaIndex.has('glm-5'), 'should have glm-5 key');
  assert.equal(aaIndex.get('glm-5').intelligence_index, 39.5, 'should prefer non-turbo (39.5)');

  // All TW models matching baseKey 'glm-5' should get 39.5
  const models = [{ id: 'zai/glm-5' }];
  applyAAEnrichment(models, aaIndex);
  assert.equal(models[0].benchmarks.intelligence_index, 39.5);

  const models2 = [{ id: 'zai/glm-5-turbo' }];
  applyAAEnrichment(models2, aaIndex);
  assert.equal(models2[0].benchmarks.intelligence_index, 39.5, 'glm-5-turbo should also get 39.5 (family score)');
});

// ── Test 6: Collision resolution — prefer non-preview ────────────────────────

test('Collision resolution: prefer non-preview entry', () => {
  const aaIndex = buildIndexFromModels([
    { slug: 'o1', intelligence_index: 55.0, coding_index: 60.0, agentic_index: 50.0 },
    { slug: 'o1-preview', intelligence_index: 52.0, coding_index: 55.0, agentic_index: 45.0 },
  ]);

  // Should have only one entry (o1, the non-preview one)
  assert.equal(aaIndex.size, 1, 'should have one entry after collision resolution');
  assert.ok(aaIndex.has('o1'), 'should have o1 key');
  assert.equal(aaIndex.get('o1').intelligence_index, 55.0, 'should prefer non-preview (55.0)');

  // TW model o1 should get 55.0
  const models = [{ id: 'openai/o1' }];
  applyAAEnrichment(models, aaIndex);
  assert.equal(models[0].benchmarks.intelligence_index, 55.0);
});

// ── Test 7: design_arena_best not touched ────────────────────────────────────

test('applyAAEnrichment does not overwrite design_arena_best', () => {
  const aaIndex = buildIndexFromModels([
    { slug: 'gpt-4o', intelligence_index: 55.0, coding_index: 60.0, agentic_index: 50.0 },
  ]);

  const models = [
    {
      id: 'openai/gpt-4o',
      benchmarks: {
        intelligence_index: null,
        coding_index: null,
        agentic_index: null,
        design_arena_best: { category: 'coding', elo: 1500, win_rate: 0.85, rank: 1 },
      },
    },
  ];

  const result = applyAAEnrichment(models, aaIndex);

  assert.equal(result.filledCount, 3, 'should fill 3 indices');
  assert.ok(models[0].benchmarks.design_arena_best, 'design_arena_best should still exist');
  assert.equal(models[0].benchmarks.design_arena_best.elo, 1500, 'design_arena_best should not be overwritten');
});

// ── Test 8: glm5.2 alias ─────────────────────────────────────────────────────

test('glm5.2-fast alias resolves to glm-5.2 in AA index', () => {
  const aaIndex = buildIndexFromModels([
    { slug: 'glm-5-2', intelligence_index: 51.1, coding_index: 68.8, agentic_index: 43.1 },
  ]);

  // Wafer model with id 'glm5.2-fast' should match via alias
  // conservativeBase('glm5.2-fast') = 'glm5.2' (strips -fast)
  // BENCHMARK_ALIAS_MAP['glm5.2'] = 'glm-5.2'
  const models = [
    { id: 'wafer/glm5.2-fast' },
  ];

  const result = applyAAEnrichment(models, aaIndex);

  assert.ok(models[0].benchmarks, 'should create benchmarks block');
  assert.equal(models[0].benchmarks.intelligence_index, 51.1, 'should get AA score via alias');
  assert.equal(models[0].benchmarks.coding_index, 68.8);
  assert.equal(models[0].benchmarks.agentic_index, 43.1);
  assert.equal(result.filledCount, 3, 'all 3 indices filled from null');
});

// ── Test 9: BuildIndexFromModels handles missing fields ──────────────────────

test('buildIndexFromModels skips models without intelligence_index', () => {
  const models = [
    { slug: 'some-model', intelligence_index: null, coding_index: 50.0, agentic_index: 40.0 },
    { slug: 'other-model', intelligence_index: 45.0, coding_index: 50.0, agentic_index: 40.0 },
  ];

  const index = buildIndexFromModels(models);

  // First model should be skipped (no intelligence_index)
  assert.equal(index.size, 1, 'should only have one entry');
  assert.ok(index.has('other-model'));
});

// ── Test 10: Index structure ─────────────────────────────────────────────────

test('AA index has correct structure (Map<conservativeBase, benchmarks>)', () => {
  const aaIndex = buildIndexFromModels([
    { slug: 'glm-5-2', intelligence_index: 51.1, coding_index: 68.8, agentic_index: 43.1 },
  ]);

  assert.ok(aaIndex instanceof Map, 'should be a Map');
  assert.equal(aaIndex.size, 1);

  const entry = aaIndex.get('glm-5.2');
  assert.ok(entry, 'should have glm-5.2 entry');
  assert.equal(entry.intelligence_index, 51.1);
  assert.equal(entry.coding_index, 68.8);
  assert.equal(entry.agentic_index, 43.1);
});

// ── Test 11: Multiple collision pairs ────────────────────────────────────────

test('Multiple collision pairs resolved independently', () => {
  const aaIndex = buildIndexFromModels([
    { slug: 'glm-5', intelligence_index: 39.5, coding_index: 50.0, agentic_index: 40.0 },
    { slug: 'glm-5-turbo', intelligence_index: 38.1, coding_index: 45.0, agentic_index: 35.0 },
    { slug: 'gpt-4', intelligence_index: 55.0, coding_index: 60.0, agentic_index: 50.0 },
    { slug: 'gpt-4-turbo', intelligence_index: 52.0, coding_index: 55.0, agentic_index: 45.0 },
    { slug: 'qwen3-max', intelligence_index: 60.0, coding_index: 65.0, agentic_index: 55.0 },
    { slug: 'qwen3-max-preview', intelligence_index: 58.0, coding_index: 62.0, agentic_index: 52.0 },
  ]);

  // Should have 3 entries (one per collision pair)
  assert.equal(aaIndex.size, 3, 'should have 3 entries after collision resolution');

  assert.equal(aaIndex.get('glm-5').intelligence_index, 39.5, 'glm-5: prefer non-turbo');
  assert.equal(aaIndex.get('gpt-4').intelligence_index, 55.0, 'gpt-4: prefer non-turbo');
  assert.equal(aaIndex.get('qwen3-max').intelligence_index, 60.0, 'qwen3-max: prefer non-preview');
});

// ── Test 12: First-seen wins when both have variant suffix ───────────────────

test('First-seen wins when both entries have variant suffix', () => {
  const aaIndex = buildIndexFromModels([
    { slug: 'o1-preview', intelligence_index: 52.0, coding_index: 55.0, agentic_index: 45.0 },
    { slug: 'o1-turbo', intelligence_index: 50.0, coding_index: 52.0, agentic_index: 42.0 },
  ]);

  // Both have variant suffixes, so first-seen wins
  assert.equal(aaIndex.size, 1, 'should have one entry');
  // The first-seen entry (o1-preview) is kept
  assert.ok(aaIndex.has('o1'), 'should have o1 key');
});

// ── Test 13: Reversed-order collision — variant first, real model second ─────

test('Collision resolution: prefer non-turbo even when turbo comes first in API order', () => {
  // Same as Test 5 but with REVERSED order — turbo variant appears first
  const aaIndex = buildIndexFromModels([
    { slug: 'glm-5-turbo', intelligence_index: 38.1, coding_index: 45.0, agentic_index: 35.0 },
    { slug: 'glm-5', intelligence_index: 39.5, coding_index: 50.0, agentic_index: 40.0 },
  ]);

  assert.equal(aaIndex.size, 1, 'should have one entry after collision resolution');
  assert.ok(aaIndex.has('glm-5'), 'should have glm-5 key');
  assert.equal(aaIndex.get('glm-5').intelligence_index, 39.5, 'should prefer non-turbo (39.5) even when turbo comes first');
});

// ── Test 14: Reversed-order collision — preview first, real model second ─────

test('Collision resolution: prefer non-preview even when preview comes first in API order', () => {
  const aaIndex = buildIndexFromModels([
    { slug: 'o1-preview', intelligence_index: 52.0, coding_index: 55.0, agentic_index: 45.0 },
    { slug: 'o1', intelligence_index: 55.0, coding_index: 60.0, agentic_index: 50.0 },
  ]);

  assert.equal(aaIndex.size, 1, 'should have one entry after collision resolution');
  assert.ok(aaIndex.has('o1'), 'should have o1 key');
  assert.equal(aaIndex.get('o1').intelligence_index, 55.0, 'should prefer non-preview (55.0) even when preview comes first');
});
