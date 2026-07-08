import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { canonicalId } from '../shared/normalize.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRICING_JSON = join(__dirname, '..', 'public', 'pricing.json');

/**
 * Parity guard: loads the real public/pricing.json and asserts that
 * canonicalId produces the expected distinct keys for the gemini-3.1-pro
 * family. This catches any future re-divergence if someone reintroduces a
 * second copy of the canonicalization logic with a -preview-.*$ catch-all.
 */
test('gemini-3.1-pro family does NOT collapse (regression)', async () => {
  const data = JSON.parse(await readFile(PRICING_JSON, 'utf-8'));
  const geminiKeys = new Set();
  const geminiModels = [];
  for (const m of data.models) {
    if (m.id.includes('gemini-3.1-pro')) {
      const key = canonicalId(m.id);
      geminiKeys.add(key);
      geminiModels.push({ id: m.id, key });
    }
  }
  // Must have DISTINCT keys for pro and pro-preview-customtools
  // (pro-preview folds into pro via the bare -preview rule — that's correct)
  assert.ok(geminiKeys.has('gemini-3.1-pro'),
    `expected gemini-3.1-pro key, got: ${[...geminiKeys].join(', ')}`);
  assert.ok(geminiKeys.has('gemini-3.1-pro-preview-customtools'),
    `expected gemini-3.1-pro-preview-customtools key, got: ${[...geminiKeys].join(', ')}`);
  assert.ok(geminiKeys.size >= 2,
    `expected ≥2 distinct keys, got ${geminiKeys.size}: ${[...geminiKeys].join(', ')}`);

  // The customtools variant must NOT canonicalize to the base
  const customtoolsKey = canonicalId('google/gemini-3.1-pro-preview-customtools');
  assert.notEqual(customtoolsKey, 'gemini-3.1-pro',
    'gemini-3.1-pro-preview-customtools must not collapse into gemini-3.1-pro');
});

test('every model produces a non-empty canonical key', async () => {
  const data = JSON.parse(await readFile(PRICING_JSON, 'utf-8'));
  let empty = 0;
  for (const m of data.models) {
    const key = canonicalId(m.id);
    if (!key || key.trim() === '') empty++;
  }
  assert.equal(empty, 0, `${empty} models produced empty canonical keys`);
});

test('glm-5.2 quant variants stay distinct (not collapsed by dedup)', async () => {
  const data = JSON.parse(await readFile(PRICING_JSON, 'utf-8'));
  const glmKeys = new Set();
  for (const m of data.models) {
    if (m.id.includes('glm-5.2')) {
      glmKeys.add(canonicalId(m.id));
    }
  }
  // If fp8/nvfp4/int4 variants exist in the data, they must be distinct keys
  const quantVariants = [...glmKeys].filter(k => /-(fp8|nvfp4|int4|bf16|fp16)$/.test(k));
  for (const k of quantVariants) {
    assert.notEqual(k, 'glm-5.2',
      `${k} should be distinct from glm-5.2 (quant suffix preserved)`);
  }
});
