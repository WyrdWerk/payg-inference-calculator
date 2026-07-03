#!/usr/bin/env node
/**
 * fetch-pricing.mjs
 *
 * Fetches /v1/models from each public provider, normalizes pricing to a
 * canonical schema (all prices in USD per million tokens), and writes
 * public/pricing.json for the static frontend to consume.
 *
 * Canonical model record:
 * {
 *   id:          "provider/model"        (normalized cross-provider key where possible)
 *   name:        string
 *   org:         "anthropic" | "openai" | "deepseek" | ...  (underlying model creator)
 *   provider:    "openrouter" | "wafer" | "crof" | "deepinfra" | "ember"
 *   context_length: number | null
 *   pricing: {
 *     input:       number | null   ($/M tokens)
 *     output:      number | null   ($/M tokens)
 *     cache_read:  number | null   ($/M tokens)
 *     cache_write: number | null   ($/M tokens)
 *   }
 * }
 *
 * Unit conversions (all → $/M tokens):
 *   openrouter / ember  → $/token      → ×1e6
 *   crof                         → $/M          → as-is
 *   wafer                        → cents/M      → ÷100
 *   deepinfra                    → $/M          → as-is
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';

// ── providers config ──────────────────────────────────────────────────────────

const PROVIDERS = [
  {
    key: 'openrouter',
    name: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1/models',
    parse: parseOpenRouter,
  },
  {
    key: 'deepinfra',
    name: 'DeepInfra',
    url: 'https://api.deepinfra.com/v1/models',
    parse: parseDeepInfra,
  },
  {
    key: 'crof',
    name: 'Crof',
    url: 'https://crof.ai/v1/models',
    parse: parseCrof,
  },
  {
    key: 'ember',
    name: 'EmberCloud',
    url: 'https://api.embercloud.ai/v1/models',
    parse: parseEmber,
  },
  {
    key: 'wafer',
    name: 'Wafer (Pass)',
    url: 'https://pass.wafer.ai/v1/models',
    parse: parseWafer,
  },
  {
    key: 'llmgateway',
    name: 'LLMGateway',
    url: 'https://api.llmgateway.io/v1/models',
    parse: parseLLMGateway,
  },
  {
    key: 'synthetic',
    name: 'Synthetic',
    url: 'https://api.synthetic.new/v1/models',
    parse: parseSynthetic,
  },
  {
    key: 'lilac',
    name: 'Lilac',
    url: 'https://api.getlilac.com/v1/models',
    parse: parseLilac,
  },
];

// ── helpers ───────────────────────────────────────────────────────────────────

/** Parse a pricing value that may be a string ("0.435e-6", "$0.0000014"), number, or null. */
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = typeof v === 'string' ? v.replace(/[$,]/g, '').trim() : v;
  const n = typeof s === 'string' ? parseFloat(s) : s;
  return Number.isFinite(n) ? n : null;
}

/** $/token → $/M tokens */
const perTokToPerM = (v) => { const n = num(v); return n === null ? null : n * 1e6; };
/** cents/M → $/M tokens */
const centsToDollars = (v) => { const n = num(v); return n === null ? null : n / 100; };
const passthrough = (v) => num(v);

// ── org extraction ────────────────────────────────────────────────────────────

/** Canonicalize an org prefix — normalize variants to a single key. */
const ORG_ALIASES = {
  'deepseek-ai': 'deepseek',
  'zai-org': 'z-ai',
  'zai': 'z-ai',
  'minimaxai': 'minimax',
  'xiaomimimo': 'xiaomi',
  'meta-llama': 'meta',
  'mistralai': 'mistral',
  'nousresearch': 'nous',
  'moonshotai': 'moonshot',
  'ibm-granite': 'ibm',
  'bytedance-seed': 'bytedance',
  'stepfun-ai': 'stepfun',
  // LLMGateway provider IDs
  'google-ai-studio': 'google',
  'google-vertex': 'google',
  'vertex-anthropic': 'anthropic',
  'vertex-openai': 'openai',
  'aws-bedrock': 'amazon',
  'together-ai': 'together',
  'inference.net': 'inference-net',
};

/** Extract org from a model ID with a slash prefix. */
function orgFromId(id) {
  if (!id.includes('/')) return null;
  let org = id.split('/')[0].replace(/^[~]/, '').toLowerCase();
  return ORG_ALIASES[org] || org;
}

/** Extract org from model name when ID has no slash.
 *  Names like "DeepSeek: DeepSeek V4 Pro" → "deepseek" */
function orgFromName(name) {
  if (!name) return null;
  const match = name.match(/^(?:~)?([^:]+):/);
  if (!match) return null;
  let org = match[1].trim().toLowerCase();
  return ORG_ALIASES[org] || org;
}

/** Build canonical model ID for cross-referencing.
 *  Strips provider prefix, suffixes (:free, dates like -2024-08-06,
 *  -preview, -preview-05-06, :thinking), and lowercases.
 *  Used for MATCHING only — display ID stays as-is.
 *  Turbo variants are kept separate (genuinely different SKUs). */
function canonicalId(id) {
  let k = id.includes('/') ? id.split('/').slice(-1)[0] : id;
  k = k.replace(/:free$/, '')
       .replace(/:thinking$/, '')
       .replace(/-(\d{4})-\d{2}-\d{2}$/, '')           // date-suffixed: gpt-4o-2024-08-06 → gpt-4o
       .replace(/-preview-\d{2}-\d{2}$/, '')            // gemini-2.5-pro-preview-05-06 → gemini-2.5-pro
       .replace(/-preview$/, '')                        // gpt-4-turbo-preview → gpt-4-turbo
       .toLowerCase().trim();
  return k;
}

/** Build a key for org cross-referencing.
 *  Like canonicalId but also strips quantization suffixes (-fp8, -nvfp4, etc.)
 *  so that glm-5.2-fp8 can resolve org from glm-5.2. */
function orgLookupKey(id) {
  return canonicalId(id)
    .replace(/-(fp8|nvfp4|int4-mixed-ar|int4)$/, '')
    .replace(/-long$/, ''); // opencode tiered variant
}

// ── provider parsers ──────────────────────────────────────────────────────────

function parseOpenRouter(data) {
  return (data.data || []).map((m) => ({
    id: m.id,
    name: m.name || m.id,
    provider: 'openrouter',
    context_length: m.context_length ?? null,
    pricing: {
      input: perTokToPerM(m.pricing?.prompt),
      output: perTokToPerM(m.pricing?.completion),
      cache_read: perTokToPerM(m.pricing?.input_cache_read),
      cache_write: perTokToPerM(m.pricing?.input_cache_write),
    },
  }));
}

function parseDeepInfra(data) {
  return (data.data || [])
    .filter((m) => m.metadata?.pricing && Object.keys(m.metadata.pricing).length > 0)
    .map((m) => ({
      id: m.id,
      name: m.id,
      provider: 'deepinfra',
      context_length: m.metadata?.context_length ?? null,
      pricing: {
        input: passthrough(m.metadata.pricing?.input_tokens),
        output: passthrough(m.metadata.pricing?.output_tokens),
        cache_read: passthrough(m.metadata.pricing?.cache_read_tokens),
        cache_write: passthrough(m.metadata.pricing?.cache_write_tokens),
      },
    }));
}

function parseCrof(data) {
  return (data.data || []).map((m) => ({
    id: m.id,
    name: m.name || m.id,
    provider: 'crof',
    context_length: m.context_length ?? null,
    pricing: {
      input: passthrough(m.pricing?.prompt),
      output: passthrough(m.pricing?.completion),
      cache_read: passthrough(m.pricing?.cache_prompt),
      cache_write: passthrough(m.pricing?.cache_write),
    },
  }));
}

function parseEmber(data) {
  return (data.data || []).map((m) => ({
    id: m.id,
    name: m.name || m.id,
    provider: 'ember',
    context_length: m.context_length ?? null,
    pricing: {
      input: perTokToPerM(m.pricing?.prompt),
      output: perTokToPerM(m.pricing?.completion),
      cache_read: perTokToPerM(m.pricing?.cache_read),
      cache_write: perTokToPerM(m.pricing?.cache_write),
    },
  }));
}

function parseWafer(data) {
  return (data.data || [])
    .filter((m) => m.wafer?.pricing)
    .map((m) => {
      const p = m.wafer.pricing;
      return {
        id: m.id,
        name: m.wafer?.display_name || m.id,
        provider: 'wafer',
        context_length: m.wafer?.context_length ?? m.max_model_len ?? null,
        pricing: {
          input: centsToDollars(p.input_cents_per_million),
          output: centsToDollars(p.output_cents_per_million),
          cache_read: centsToDollars(p.cache_read_cents_per_million),
          cache_write: centsToDollars(p.cache_write_cents_per_million),
        },
      };
    });
}

function parseLLMGateway(data) {
  return (data.data || []).map((m) => {
    const org = m.providers?.[0]?.providerId || null;
    return {
      id: m.id,
      name: m.name || m.id,
      provider: 'llmgateway',
      context_length: m.context_length ?? null,
      org: org ? (ORG_ALIASES[org] || org) : null,
      pricing: {
        input: perTokToPerM(m.pricing?.prompt),
        output: perTokToPerM(m.pricing?.completion),
        cache_read: perTokToPerM(m.pricing?.input_cache_read),
        cache_write: perTokToPerM(m.pricing?.input_cache_write),
      },
    };
  });
}

function parseSynthetic(data) {
  return (data.data || []).map((m) => {
    const inputPerM = perTokToPerM(m.pricing?.prompt);
    // Cache read is always 20% of input price (per user spec)
    const cacheRead = inputPerM !== null ? inputPerM * 0.20 : null;
    // Extract org from hugging_face_id field (e.g., zai-org/GLM-5.2 → z-ai)
    const org = m.hugging_face_id ? orgFromId(m.hugging_face_id) : null;
    return {
      id: m.id,
      name: m.name || m.id,
      provider: 'synthetic',
      context_length: m.context_length ?? null,
      org,
      pricing: {
        input: inputPerM,
        output: perTokToPerM(m.pricing?.completion),
        cache_read: cacheRead,
        cache_write: null,
      },
    };
  });
}

function parseLilac(data) {
  return (data.data || []).map((m) => ({
    id: m.id,
    name: m.name || m.id,
    provider: 'lilac',
    context_length: m.context_length ?? null,
    pricing: {
      input: perTokToPerM(m.pricing?.prompt),
      output: perTokToPerM(m.pricing?.completion),
      cache_read: perTokToPerM(m.pricing?.input_cache_read),
      cache_write: null,
    },
  }));
}

// ── CSV-sourced providers (Hyper, Makora, Xiaomimimo) ───────────────────────────
// CSV format: col0=model_name, col1=input_$/M, col2=output_$/M, col3=cache_$/M
// Sections start with a URL line. We extract only the 3 requested providers.

const CSV_PROVIDER_SECTIONS = {
  'https://hyper.charm.land/v1': 'hyper',
  'https://inference.makora.com/v1': 'makora',
  'https://api.xiaomimimo.com/v1': 'xiaomimimo',
};

const CSV_PROVIDER_NAMES = {
  hyper: 'Hyper',
  makora: 'Makora',
  xiaomimimo: 'Xiaomimimo',
};

function parseCsvProviders(csvText) {
  const lines = csvText.split('\n');
  const providers = [];
  let currentUrl = null;
  let currentProvider = null;

  for (const line of lines) {
    const col0 = (line.split(',')[0] || '').trim();

    // Check if this line is a section header (URL)
    if (col0.startsWith('https://')) {
      // Match URL to our known providers (normalize trailing slashes and paths)
      const normalized = col0.replace(/\/+$/, '').replace('/chat/completions', '');
      currentProvider = CSV_PROVIDER_SECTIONS[normalized] || null;
      if (currentProvider) {
        providers.push({ key: currentProvider, name: CSV_PROVIDER_NAMES[currentProvider], models: [] });
      } else {
        currentProvider = null;
      }
      continue;
    }

    // Parse model row if we're inside a tracked provider section
    if (currentProvider && providers.length > 0) {
      const parts = line.split(',');
      const name = (parts[0] || '').trim();
      if (name && !name.startsWith('http')) {
        try {
          const input = parts[1] ? parseFloat(parts[1]) : null;
          const output = parts[2] ? parseFloat(parts[2]) : null;
          const cacheRead = parts[3] ? parseFloat(parts[3]) : null;
          if (input !== null || output !== null) {
            providers[providers.length - 1].models.push({
              id: name.toLowerCase().replace(/\s+/g, '-'),
              name,
              provider: currentProvider,
              context_length: null,
              pricing: { input, output, cache_read: cacheRead, cache_write: null },
            });
          }
        } catch { /* skip malformed lines */ }
      }
    }
  }

  return providers;
}

// ── OpenCode Go (hardcoded pricing from user-provided table) ───────────────────

const OPENCODE_GO_MODELS = [
  { id: 'glm-5.2', name: 'GLM-5.2', input: 1.40, output: 4.40, cache_read: 0.26 },
  { id: 'glm-5.1', name: 'GLM-5.1', input: 1.40, output: 4.40, cache_read: 0.26 },
  { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', input: 0.95, output: 4.00, cache_read: 0.19 },
  { id: 'kimi-k2.6', name: 'Kimi K2.6', input: 0.95, output: 4.00, cache_read: 0.16 },
  { id: 'mimo-v2.5', name: 'MiMo V2.5', input: 0.14, output: 0.28, cache_read: 0.0028 },
  { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro', input: 1.74, output: 3.48, cache_read: 0.0145 },
  { id: 'minimax-m3', name: 'MiniMax M3', input: 0.30, output: 1.20, cache_read: 0.06 },
  { id: 'minimax-m2.7', name: 'MiniMax M2.7', input: 0.30, output: 1.20, cache_read: 0.06 },
  { id: 'minimax-m2.5', name: 'MiniMax M2.5', input: 0.30, output: 1.20, cache_read: 0.06 },
  { id: 'qwen3.7-max', name: 'Qwen3.7 Max', input: 2.50, output: 7.50, cache_read: 0.50 },
  { id: 'qwen3.7-plus', name: 'Qwen3.7 Plus (≤256K)', input: 0.40, output: 1.60, cache_read: 0.04 },
  { id: 'qwen3.7-plus-long', name: 'Qwen3.7 Plus (>256K)', input: 1.20, output: 4.80, cache_read: 0.12 },
  { id: 'qwen3.6-plus', name: 'Qwen3.6 Plus (≤256K)', input: 0.50, output: 3.00, cache_read: 0.05 },
  { id: 'qwen3.6-plus-long', name: 'Qwen3.6 Plus (>256K)', input: 2.00, output: 6.00, cache_read: 0.20 },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', input: 1.74, output: 3.48, cache_read: 0.0145 },
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', input: 0.14, output: 0.28, cache_read: 0.0028 },
];

function parseOpenCodeGo() {
  return OPENCODE_GO_MODELS.map((m) => ({
    id: m.id,
    name: m.name,
    provider: 'opencode',
    context_length: null,
    pricing: { input: m.input, output: m.output, cache_read: m.cache_read, cache_write: null },
  }));
}

// ── main ───────────────────────────────────────────────────────────────────────

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function main() {
  const out = { generated_at: new Date().toISOString(), providers: [], models: [] };

  for (const prov of PROVIDERS) {
    try {
      const data = await fetchJson(prov.url);
      const models = prov.parse(data).filter((m) =>
        !m.id.endsWith(':free') &&
        (m.pricing.input !== null || m.pricing.output !== null) &&
        (m.pricing.input ?? 0) >= 0 &&
        (m.pricing.output ?? 0) >= 0 &&
        ((m.pricing.input ?? 0) > 0 || (m.pricing.output ?? 0) > 0)
      );
      out.providers.push({ key: prov.key, name: prov.name, model_count: models.length, status: 'ok' });
      out.models.push(...models);
      console.log(`✓ ${prov.name}: ${models.length} models`);
    } catch (err) {
      out.providers.push({ key: prov.key, name: prov.name, model_count: 0, status: `error: ${err.message}` });
      console.error(`✗ ${prov.name}: ${err.message}`);
    }
  }

  // CSV-sourced providers (Hyper, Makora, Xiaomimimo)
  try {
    const csvText = await readFile('data/manual-pricing.csv', 'utf-8');
    const csvProviders = parseCsvProviders(csvText);
    for (const prov of csvProviders) {
      out.providers.push({ key: prov.key, name: prov.name, model_count: prov.models.length, status: 'ok' });
      out.models.push(...prov.models);
      console.log(`✓ ${prov.name} (CSV): ${prov.models.length} models`);
    }
  } catch (err) {
    console.error(`✗ CSV providers: ${err.message}`);
  }

  // OpenCode Go (hardcoded pricing)
  try {
    const ocModels = parseOpenCodeGo();
    out.providers.push({ key: 'opencode', name: 'OpenCode Go', model_count: ocModels.length, status: 'ok' });
    out.models.push(...ocModels);
    console.log(`✓ OpenCode Go: ${ocModels.length} models`);
  } catch (err) {
    out.providers.push({ key: 'opencode', name: 'OpenCode Go', model_count: 0, status: `error: ${err.message}` });
    console.error(`✗ OpenCode Go: ${err.message}`);
  }

  // Enrich models with org field (underlying model creator, not the API provider)
  // 1. Build canonical → org map from models with slash in ID
  const canonToOrg = {};
  for (const m of out.models) {
    const org = m.org || orgFromId(m.id);
    if (org) {
      canonToOrg[canonicalId(m.id)] = org;
      canonToOrg[orgLookupKey(m.id)] = org;
    }
  }
  // 2. Assign org to each model: direct from ID, cross-ref, or from name
  let unresolved = 0;
  for (const m of out.models) {
    m.org = m.org || orgFromId(m.id) || canonToOrg[orgLookupKey(m.id)] || canonToOrg[canonicalId(m.id)] || orgFromName(m.name);
    if (!m.org) { m.org = m.provider; unresolved++; }
  }
  if (unresolved) console.warn(`⚠ ${unresolved} models could not resolve org — using provider name as fallback`);
  await mkdir('public', { recursive: true });
  await writeFile('public/pricing.json', JSON.stringify(out, null, 2));
  console.log(`\n→ Wrote public/pricing.json (${out.models.length} models from ${out.providers.length} providers)`);
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
