import { test } from 'node:test';
import assert from 'node:assert/strict';
import { falCanonicalId, FAL_ORG_MAP } from '../scripts/lib.mjs';

// ── Model identity preserved from nested paths ──

test('falCanonicalId preserves kling-video version+tier, drops modality', () => {
  assert.equal(falCanonicalId('fal-ai/kling-video/v3/pro/image-to-video'), 'kling-video-v3-pro');
});

test('falCanonicalId preserves kling-video standard tier', () => {
  assert.equal(falCanonicalId('fal-ai/kling-video/v3/standard/image-to-video'), 'kling-video-v3-standard');
});

test('falCanonicalId preserves flux version', () => {
  assert.equal(falCanonicalId('fal-ai/flux-pro/v1.1-ultra'), 'flux-pro-v1.1-ultra');
});

test('falCanonicalId handles simple flat endpoint', () => {
  assert.equal(falCanonicalId('fal-ai/flux/schnell'), 'flux-schnell');
});

test('falCanonicalId keeps org prefix for non-fal-ai namespaces', () => {
  assert.equal(falCanonicalId('bytedance/seedance-2.0/image-to-video'), 'bytedance-seedance-2.0');
});

test('falCanonicalId drops trailing edit suffix', () => {
  assert.equal(falCanonicalId('fal-ai/nano-banana-pro/edit'), 'nano-banana-pro');
});

test('falCanonicalId drops trailing upscale suffix', () => {
  assert.equal(falCanonicalId('fal-ai/seedvr/upscale/image'), 'seedvr');
});

test('falCanonicalId drops text-to-video modality', () => {
  assert.equal(falCanonicalId('fal-ai/kling-video/v3/pro/text-to-video'), 'kling-video-v3-pro');
});

test('falCanonicalId does NOT drop non-modality last segments', () => {
  // 'turbo' is a variant, not a modality — must be preserved
  assert.equal(falCanonicalId('fal-ai/wan/v2.2-a14b/image-to-video/turbo'), 'wan-v2.2-a14b-turbo');
});

// ── FAL_ORG_MAP ──

test('FAL_ORG_MAP maps flux to black-forest-labs', () => {
  assert.equal(FAL_ORG_MAP['flux'], 'black-forest-labs');
});

test('FAL_ORG_MAP maps kling-video to kuaishou', () => {
  assert.equal(FAL_ORG_MAP['kling-video'], 'kuaishou');
});

test('FAL_ORG_MAP has entries for top families', () => {
  // At least 15 families mapped
  assert.ok(Object.keys(FAL_ORG_MAP).length >= 15, `only ${Object.keys(FAL_ORG_MAP).length} entries`);
});
