// PAYG Inference Calculator — app.js
// Loads pricing.json, lets the user pick a model or provider, enter token volumes,
// and computes per-offering cost. Results are sorted cheapest-first.

const state = {
  data: null,        // { generated_at, providers, models }
  mode: 'model',     // 'model' | 'provider'
  selectedModel: '', // canonical model key
  selectedProvider: 'all', // provider key or 'all'
};

// ── DOM ───────────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const els = {
  mode: $('mode'),
  modelSelect: $('modelSelect'),
  providerSelect: $('providerSelect'),
  modelGroup: $('model-group'),
  providerGroup: $('provider-group'),
  search: $('search'),
  inputTokens: $('inputTokens'),
  outputTokens: $('outputTokens'),
  cacheReadTokens: $('cacheReadTokens'),
  cacheWriteTokens: $('cacheWriteTokens'),
  resultsBody: $('resultsBody'),
  resultsTitle: $('resultsTitle'),
  lastUpdated: $('lastUpdated'),
};

// ── Init ───────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const res = await fetch('pricing.json');
    state.data = await res.json();
  } catch (err) {
    els.resultsBody.innerHTML = `<tr><td colspan="8" class="empty">Could not load pricing.json. Run <code>node scripts/fetch-pricing.mjs</code> first.</td></tr>`;
    return;
  }

  els.lastUpdated.textContent = `Data updated: ${new Date(state.data.generated_at).toLocaleString()}`;
  populateSelectors();
  attachListeners();
  computeAndRender();
}

// ── Canonicalization ──────────────────────────────────────────────────────────

/** Build a canonical model key for cross-provider matching.
 *  Strips provider prefixes, lowercases, removes version suffixes like :free. */
function canonicalModelId(id) {
  let k = id.includes('/') ? id.split('/').slice(-1)[0] : id;
  k = k.replace(/:free$/, '').toLowerCase().trim();
  return k;
}

// ── Selectors ──────────────────────────────────────────────────────────────────

function populateSelectors() {
  // Model dropdown: unique canonical model keys, sorted alphabetically
  const modelKeys = new Map(); // canonical -> display name
  for (const m of state.data.models) {
    const c = canonicalModelId(m.id);
    if (!modelKeys.has(c)) modelKeys.set(c, m.id);
  }
  const sortedKeys = [...modelKeys.keys()].sort();
  els.modelSelect.innerHTML = sortedKeys
    .map((k) => `<option value="${k}">${modelKeys.get(k)}</option>`)
    .join('');
  if (sortedKeys.length) state.selectedModel = sortedKeys[0];

  // Provider dropdown
  els.providerSelect.innerHTML =
    `<option value="all">All providers</option>` +
    state.data.providers
      .filter((p) => p.status === 'ok')
      .map((p) => `<option value="${p.key}">${p.name} (${p.model_count})</option>`)
      .join('');
}

// ── Event listeners ────────────────────────────────────────────────────────────

function attachListeners() {
  els.mode.addEventListener('change', () => {
    state.mode = els.mode.value;
    els.modelGroup.classList.toggle('hidden', state.mode !== 'model');
    els.providerGroup.classList.toggle('hidden', state.mode !== 'provider');
    els.search.parentElement.classList.toggle('hidden', state.mode !== 'model');
    computeAndRender();
  });

  els.modelSelect.addEventListener('change', () => {
    state.selectedModel = els.modelSelect.value;
    computeAndRender();
  });

  els.providerSelect.addEventListener('change', () => {
    state.selectedProvider = els.providerSelect.value;
    computeAndRender();
  });

  els.search.addEventListener('input', () => computeAndRender());

  for (const id of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']) {
    els[id].addEventListener('input', () => computeAndRender());
  }

  document.querySelectorAll('.presets button').forEach((btn) => {
    btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
  });
}

function applyPreset(name) {
  const presets = {
    light:  { inputTokens: 1_000_000,  outputTokens: 100_000, cacheReadTokens: 0,       cacheWriteTokens: 0 },
    medium: { inputTokens: 5_000_000,  outputTokens: 1_000_000, cacheReadTokens: 0,   cacheWriteTokens: 0 },
    heavy:  { inputTokens: 20_000_000, outputTokens: 5_000_000, cacheReadTokens: 0,   cacheWriteTokens: 0 },
    cached: { inputTokens: 10_000_000, outputTokens: 2_000_000, cacheReadTokens: 8_000_000, cacheWriteTokens: 0 },
  };
  const p = presets[name];
  if (!p) return;
  for (const [k, v] of Object.entries(p)) els[k].value = v;
  computeAndRender();
}

// ── Cost computation ──────────────────────────────────────────────────────────

function getTokens() {
  return {
    input: Math.max(0, parseInt(els.inputTokens.value) || 0),
    output: Math.max(0, parseInt(els.outputTokens.value) || 0),
    cacheRead: Math.max(0, parseInt(els.cacheReadTokens.value) || 0),
    cacheWrite: Math.max(0, parseInt(els.cacheWriteTokens.value) || 0),
  };
}

/** cost = (tokens × $/M) / 1e6  — prices are $/M tokens */
function costFor(pricing, tokens) {
  const c = (price, tok) => (price !== null ? (price * tok) / 1e6 : null);
  const parts = [
    c(pricing.input, tokens.input),
    c(pricing.output, tokens.output),
    c(pricing.cache_read, tokens.cacheRead),
    c(pricing.cache_write, tokens.cacheWrite),
  ];
  // If a component is null (unsupported), treat as 0 IF tokens for it are 0;
  // otherwise the offering can't serve that usage → exclude.
  if (parts.some((p, i) => p === null && [tokens.input, tokens.output, tokens.cacheRead, tokens.cacheWrite][i] > 0)) {
    return null; // this offering doesn't support requested token types
  }
  return parts.reduce((a, b) => a + (b || 0), 0);
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function computeAndRender() {
  if (!state.data) return;
  const tokens = getTokens();
  const search = els.search.value.trim().toLowerCase();

  // Filter offerings based on mode
  let offerings;
  if (state.mode === 'model') {
    const canon = state.selectedModel;
    offerings = state.data.models.filter((m) => canonicalModelId(m.id) === canon);
    if (search) offerings = offerings.filter((m) => m.id.toLowerCase().includes(search));
    els.resultsTitle.textContent = `Results for "${modelDisplayName(canon)}" across providers`;
  } else {
    offerings = state.selectedProvider === 'all'
      ? [...state.data.models]
      : state.data.models.filter((m) => m.provider === state.selectedProvider);
    els.resultsTitle.textContent = `All models from ${
      state.selectedProvider === 'all' ? 'all providers' : providerName(state.selectedProvider)
    }`;
  }

  // Compute costs
  const rows = offerings
    .map((m) => ({ model: m, cost: costFor(m.pricing, tokens) }))
    .filter((r) => r.cost !== null);

  // Sort cheapest first
  rows.sort((a, b) => a.cost - b.cost);

  renderTable(rows, tokens);
}

function providerName(key) {
  const p = state.data.providers.find((p) => p.key === key);
  return p ? p.name : key;
}

function modelDisplayName(canon) {
  const opt = [...els.modelSelect.options].find((o) => o.value === canon);
  return opt ? opt.textContent : canon;
}

function fmtPrice(p) {
  if (p === null || p === undefined) return `<span class="missing">—</span>`;
  if (p === 0) return `<span class="cost-zero">Free</span>`;
  if (p < 0.01) return `$${p.toFixed(4)}`;
  return `$${p.toFixed(2)}`;
}

function fmtCost(c) {
  if (c === null) return `<span class="missing">N/A</span>`;
  if (c === 0) return `<span class="cost-zero">$0.00</span>`;
  if (c < 0.01) return `$${c.toFixed(4)}`;
  if (c < 1) return `$${c.toFixed(4)}`;
  return `$${c.toFixed(2)}`;
}

function renderTable(rows, tokens) {
  if (rows.length === 0) {
    els.resultsBody.innerHTML = `<tr><td colspan="8" class="empty">No offerings match your criteria. Some providers may not support the token types you entered.</td></tr>`;
    return;
  }

  els.resultsBody.innerHTML = rows
    .map((r, i) => {
      const p = r.model.pricing;
      const cheapest = i === 0 && r.cost > 0;
      return `<tr>
        <td class="rank">${i + 1}${cheapest ? ' 🏆' : ''}</td>
        <td><span class="provider-badge">${providerName(r.model.provider)}</span></td>
        <td>${r.model.id}</td>
        <td class="num">${fmtPrice(p.input)}</td>
        <td class="num">${fmtPrice(p.output)}</td>
        <td class="num">${fmtPrice(p.cache_read)}</td>
        <td class="num">${fmtPrice(p.cache_write)}</td>
        <td class="num cost">${fmtCost(r.cost)}</td>
      </tr>`;
    })
    .join('');
}

// ── Boot ───────────────────────────────────────────────────────────────────────
init();
