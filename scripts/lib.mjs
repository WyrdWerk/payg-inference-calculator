/**
 * lib.mjs — shared utilities for TokenWatch pricing pipelines.
 * Used by fetch-pricing.mjs, fetch-images.mjs, fetch-videos.mjs.
 */

import { readFile } from 'node:fs/promises';

// ── helpers ───────────────────────────────────────────────────────────────────

/** Parse a pricing value that may be a string ("0.435e-6", "$0.0000014"), number, or null. */
export function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = typeof v === 'string' ? v.replace(/[$,]/g, '').trim() : v;
  const n = typeof s === 'string' ? parseFloat(s) : s;
  return Number.isFinite(n) ? n : null;
}

/** $/token → $/M tokens */
export const perTokToPerM = (v) => { const n = num(v); return n === null ? null : n * 1e6; };
/** cents/M → $/M tokens */
export const centsToDollars = (v) => { const n = num(v); return n === null ? null : n / 100; };
export const passthrough = (v) => num(v);

/** Filter out non-text models by ID pattern. */
export const NON_TEXT_ID = /(?:^|[-/])(embed|embedding|embeddinggemma|clip|bge|tts|bark|parler|kokoro|openvoice)(?:[-/]|$)/i;
export function isTextModel(id) {
  return !NON_TEXT_ID.test(id);
}

// ── org extraction ────────────────────────────────────────────────────────────

/** Canonicalize an org prefix — normalize variants to a single key. */
export const ORG_ALIASES = {
  'deepseek-ai': 'deepseek',
  'zai-org': 'z-ai',
  'meta-llama': 'meta',
  'mistralai': 'mistral',
  'nousresearch': 'nous',
  'moonshotai': 'moonshot',
  'ibm-granite': 'ibm',
  'bytedance-seed': 'bytedance',
  'stepfun-ai': 'stepfun',
  'minimaxai': 'minimax',
  'xiaomimimo': 'xiaomi',
  // Additional orgs for image/video providers
  'black-forest-labs': 'black-forest-labs',
  'kwaivgi': 'kling',
  'sourceful': 'sourceful',
  'recraft': 'recraft',
  'x-ai': 'xai',
  'alibaba': 'alibaba',
};

/** Extract org from a model ID with a slash prefix. */
export function orgFromId(id) {
  if (!id.includes('/')) return null;
  let org = id.split('/')[0].replace(/^[~]/, '').toLowerCase();
  return ORG_ALIASES[org] || org;
}

/** Extract org from model name when ID has no slash.
 *  Names like "DeepSeek: DeepSeek V4 Pro" → "deepseek" */
export function orgFromName(name) {
  if (!name) return null;
  const match = name.match(/^(?:~)?([^:]+):/);
  if (!match) return null;
  let org = match[1].trim().toLowerCase();
  return ORG_ALIASES[org] || org;
}

/** Build canonical model ID for cross-referencing and dedup.
 *  Strips provider prefix, suffixes (:free, dates, -preview, :thinking), lowercases.
 *  Turbo variants kept separate (different SKUs).
 *  Quantization suffixes baked into the ID are left as-is. */
export function canonicalId(id) {
  let k = id.includes('/') ? id.split('/').slice(-1)[0] : id;
  k = k.replace(/:free$/, '')
       .replace(/:thinking$/, '')
       .replace(/-(\d{4})-(\d{2})-(\d{2})$/, '')   // -2024-08-06
       .replace(/-preview-(\d{2})-(\d{4})$/, '')    // -preview-09-2025
       .replace(/-preview-(\d{4})-(\d{2})-(\d{2})$/, '') // -preview-2024-08-06
       .replace(/-preview-(\d{2})-(\d{2})$/, '')    // -preview-05-06
       .replace(/-preview$/, '')
       .replace(/-(\d{8})$/, '')                    // -20260420
       .replace(/-(\d{6})$/, '')                    // -250712
       .toLowerCase().trim();
  return k;
}

/** Build a key for org cross-referencing.
 *  Like canonicalId but also strips quantization and tier suffixes.
 *  Used ONLY for org resolution — not for dedup or model display. */
export function orgLookupKey(id) {
  return canonicalId(id)
    .replace(/-(fp8|nvfp4|int4-mixed-ar|int4|bf16|fp16|fp6|mxfp4)$/, '')
    .replace(/-long$/, '');
}

// ── provider-name normalization ───────────────────────────────────────────────

export const PROVIDER_NAME_MAP = {
  'deepinfra': 'deepinfra',
  'embercloud': 'ember',
  'wafer': 'wafer',
  'crof': 'crof',
  'synthetic': 'synthetic',
  'lilac': 'lilac',
  'xiaomimimo': 'xiaomi',
  'fireworks': 'fireworks',
  'together': 'together',
  'novita': 'novita',
  'siliconflow': 'siliconflow',
  'gmicloud': 'gmicloud',
  'digitalocean': 'digitalocean',
  'parasail': 'parasail',
  'akashml': 'akashml',
  'venice': 'venice',
  'morph': 'morph',
  'dekallm': 'dekallm',
  'cohere': 'cohere',
  'groq': 'groq',
  'nebius': 'nebius',
  'sambanova': 'sambanova',
  'streamlake': 'streamlake',
  'atlascloud': 'atlascloud',
  'baidu': 'baidu',
  'alibaba': 'alibaba',
  'minimax': 'minimax',
  'mistral': 'mistral',
  'anthropic': 'anthropic',
  'openai': 'openai',
  'azure': 'azure',
  'google': 'google',
  'google ai studio': 'google',
  'amazon bedrock': 'amazon',
  'z.ai': 'z-ai',
  'xai': 'xai',
  'deepseek': 'deepseek',
  'moonshot ai': 'moonshot',
  'sakana ai': 'sakana',
  'arcee ai': 'arcee',
  'inception': 'inception',
  'infermatic': 'infermatic',
  'mara': 'mara',
  'nextbit': 'nextbit',
  'nex agi': 'nex-agi',
  'poolside': 'poolside',
  'phala': 'phala',
  'friendli': 'friendli',
  'chutes': 'chutes',
  'wandb': 'wandb',
  // Image/video providers
  'black-forest-labs': 'black-forest-labs',
  'bytedance-seed': 'bytedance',
  'bytedance': 'bytedance',
  'kwaivgi': 'kling',
  'recraft': 'recraft',
  'sourceful': 'sourceful',
  'x-ai': 'xai',
  'microsoft': 'microsoft',
};

/** Normalize a provider display name to a lowercase key. */
export function normalizeProvider(displayName) {
  const key = displayName.toLowerCase().trim();
  return PROVIDER_NAME_MAP[key] || key.replace(/[\s.]/g, '-');
}

// ── dedup ─────────────────────────────────────────────────────────────────────

/** Build a dedup key: (canonical_model, normalized_provider). */
export function dedupKey(m) {
  return `${canonicalId(m.id)}|${normalizeProvider(m.provider)}`;
}

/** Apply precedence: first occurrence of a key wins (insertion order = authority). */
export function dedupModels(tieredModels) {
  const seen = new Set();
  const result = [];
  for (const m of tieredModels) {
    const key = dedupKey(m);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(m);
  }
  return result;
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

/** Fetch JSON with no retry (for simple endpoints). */
export async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

/** Fetch JSON with retry on 429/5xx. */
export async function fetchJsonWithRetry(url, retries = 1, delayMs = 2000) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(45_000),
      });
      if (res.ok) return res.json();
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw new Error(`HTTP ${res.status} for ${url}`);
    } catch (err) {
      if (attempt < retries && err.name !== 'AbortError') {
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw err;
    }
  }
}

// ── resilience ────────────────────────────────────────────────────────────────

/**
 * Check coverage drop vs previous JSON file. Throws if drop exceeds threshold.
 * Returns previous model count (null if no previous file).
 */
export async function checkCoverageDrop(outputPath, currentCount, threshold = 0.15) {
  let prevCount = null;
  try {
    const prev = JSON.parse(await readFile(outputPath, 'utf-8'));
    prevCount = prev.models?.length || 0;
    const drop = prevCount > 0 ? (prevCount - currentCount) / prevCount : 0;
    if (prevCount > 0 && drop > threshold) {
      throw new Error(
        `Coverage drop: ${currentCount} models vs previous ${prevCount} ` +
        `(${(drop * 100).toFixed(1)}% drop) exceeds ${(threshold * 100).toFixed(0)}% threshold — aborting to preserve last-good data`
      );
    }
    console.log(`  Previous: ${prevCount} models | Current: ${currentCount} models`);
  } catch (err) {
    if (err.code === 'ENOENT') {
      // No previous file — first run, proceed
    } else {
      throw err; // re-throw coverage-drop or read errors
    }
  }
  return prevCount;
}

/**
 * Parse --dry-run flag from process.argv.
 * Also supports --help / -h for usage info.
 */
export function parseArgs(usage) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(usage);
    return { dryRun: false, help: true };
  }
  return { dryRun: process.argv.includes('--dry-run'), help: false };
}
