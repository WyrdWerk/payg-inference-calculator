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
 * models.dev provider_id → TW provider slug. Derived from PROVIDER_MAP.
 * Note: non-injective maps (multiple TW keys → same md id) are not expected
 * here; every value in PROVIDER_MAP is currently unique, so this reverse
 * lookup is unambiguous.
 */
export const REVERSE_PROVIDER_MAP = Object.fromEntries(
  Object.entries(PROVIDER_MAP).map(([tw, md]) => [md, tw]),
);

/**
 * Normalize a model ID for join-key purposes, applying any provider-specific
 * transform. Default: canonicalId only. Providers with bespoke ID formats
 * (cloudflare, amazon, fireworks, minimax) are handled in PROVIDER_NORMALIZERS.
 */
export function normalizeForMatch(providerKey, modelId) {
  const fn = PROVIDER_NORMALIZERS[providerKey];
  return fn ? fn(modelId) : canonicalId(modelId);
}

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
 *     → strip region        → 'anthropic.claude-haiku-4-5-20251001-v1:0'
 *     → first dot = org sep → 'anthropic/claude-haiku-4-5-20251001-v1:0'
 *     → strip :N stamp      → 'anthropic/claude-haiku-4-5-20251001-v1'
 *     → strip trailing -vN  → 'anthropic/claude-haiku-4-5-20251001'
 *     → canonicalId (-date)→ 'claude-haiku-4-5'
 *
 * The trailing -v<N> segment (e.g. '-v1') is stripped here because canonicalId
 * only strips a bare trailing date; with '-v1' left on the end the date isn't
 * terminal and would otherwise survive canonicalId.
 */
function normalizeAmazon(id) {
  const noRegion = stripBedrockRegion(id);
  const firstDot = noRegion.indexOf('.');
  const withSlash = firstDot > 0
    ? noRegion.slice(0, firstDot) + '/' + noRegion.slice(firstDot + 1)
    : noRegion;
  const noVersion = withSlash.replace(/:\d+$/, '').replace(/-v\d+$/, '');
  return canonicalId(noVersion);
}

/**
 * Strip the Fireworks accounts/fireworks/{models,routers}/ prefix and decode
 * the version encoding where 'p' replaces '.' (e.g. 'k2p6' → 'k2.6', '5p2' → '5.2').
 * ONLY decodes the version pattern — other 'p' occurrences are left alone.
 * SKU suffixes (-turbo, -fast, -highspeed) are preserved as distinct SKUs.
 */
function normalizeFireworks(id) {
  const stripped = id.replace(/^accounts\/fireworks\/(?:models|routers)\//, '');
  // Decode version pattern: a digit followed by 'p' followed by a digit.
  // Applies across multi-segment versions like 'k2p6' (k2.6) and '5p2' (5.2).
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
