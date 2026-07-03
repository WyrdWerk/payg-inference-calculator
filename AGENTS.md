# AGENTS.md — PAYG Inference Calculator

## Project overview

Static site comparing pay-as-you-go LLM API pricing across 12 providers (8 API-fetched, 3 CSV-sourced, 1 hardcoded). Zero dependencies, pure Node ESM. Deployed to Cloudflare Pages with daily CI/CD refresh.

## Architecture

- **Data pipeline**: `scripts/fetch-pricing.mjs` fetches `/v1/models` from 8 API providers, reads `data/manual-pricing.csv` for 3 CSV-sourced providers, and uses a hardcoded array for OpenCode Go. Normalizes all pricing to $/M tokens, extracts `org` (underlying model creator), writes `public/pricing.json`.
- **Frontend**: `public/` static site loads `pricing.json` client-side. Dual typeahead search (by provider/org and by model). Cost computation happens entirely in-browser.
- **CI/CD**: `.github/workflows/refresh-pricing.yml` runs daily at 00:00 UTC — fetch → commit → deploy to Cloudflare Pages.

## Key conventions

### Pricing normalization

All prices are stored as **USD per million tokens ($/M)**. Conversion by provider:
- OpenRouter / EmberCloud / LLMGateway / Lilac: $/token → ×1e6
- DeepInfra / Crof / Hyper / Makora / Xiaomimimo / OpenCode Go: $/M (passthrough)
- Wafer: cents/M → ÷100
- Synthetic: $/token → ×1e6, cache_read = input × 0.20 (per spec, not from API)

### Org extraction
Multiple providers are aggregators, not direct model creators. The `org` field extracts the underlying model creator:
1. From model ID prefix: `anthropic/claude-sonnet-5` → `anthropic`
2. From parser-set org: LLMGateway sets org from `providers[0].providerId` field; Synthetic sets org from `hugging_face_id` field
3. Cross-reference via `orgLookupKey()`: models with quantization suffixes (`-fp8`, `-nvfp4`, `-int4`) or tier suffixes (`-long`) stripped for org lookup
4. From model name: `DeepSeek: DeepSeek V4 Pro` → `deepseek`
5. Fallback: provider name (e.g., Crof's `greg-2-ultra` → `crof`)
Org aliases normalized: `deepseek-ai`→`deepseek`, `zai-org`→`z-ai`, `meta-llama`→`meta`, `minimaxai`→`minimax`, etc.

### Data filtering
- Zero-price entries (both input=0 AND output=0) are dropped (TTS, image, video generation models)
- Negative placeholder prices are dropped (OpenRouter meta-routers use -1000000)
- CSV-sourced provider model IDs are normalized (spaces → hyphens) for cross-provider matching

### Canonical model ID

Used for cross-provider matching: strips provider prefix, removes suffixes (`:free`, date suffixes like `-2024-08-06`, `-preview`, `-preview-05-06`, `:thinking`), and lowercases. Turbo variants are kept separate (genuinely different SKUs). Example: `z-ai/glm-5.2`, `zai-org/GLM-5.2`, `GLM-5.2` (Wafer) all canonicalize to `glm-5.2`.

### Cost computation

Percentage-based: user enters total tokens (in millions) + percentage breakdown (input %, cached input %, output %). Cost = `(tokens × $/M) / 1e6` per component, summed. If a provider doesn't support a requested token type (>0 tokens), that offering is excluded.

## Files to know

| File | Purpose |
|---|---|
| `scripts/fetch-pricing.mjs` | Provider fetch, org extraction, pricing normalization |
| `public/app.js` | Frontend state, selectors, cost computation, rendering |
| `public/index.html` | UI layout: controls, usage-grid, results table |
| `public/styles.css` | Dark/light theme, org-badge, provider-badge, pct-ok/pct-warn |
| `public/pricing.json` | Generated data (do not hand-edit — CI refreshes daily) |
| `.github/workflows/refresh-pricing.yml` | Daily cron + Cloudflare deploy |
| `data/manual-pricing.csv` | Static pricing for CSV-sourced providers (Hyper, Makora, Xiaomimimo) |

## Development

```bash
npm run fetch     # Fetch and regenerate pricing.json
npm run serve     # Serve public/ on localhost:3000
```

## Deployment

Cloudflare Pages project: `payg-inference-calculator`
- Production branch: `main`
- Build output: `public/`
- GitHub secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`

Manual deploy: `npx wrangler pages deploy public --branch main --commit-dirty true`

## Next steps

1. **Additional providers**: Novita (132 models, pricing unit ÷10000), Synthetic (already added), and others from the CSV could be added via API. Makora/Xiaomimimo/SiliconFlow/Baseten/Fireworks/GeneralCompute have auth-gated APIs — would need API keys.
2. **OpenRouter MCP server**: Could use `https://mcp.openrouter.ai/mcp` for enriched model metadata, but current org extraction from model ID prefixes already covers all orgs.
3. **Turbo/preview pricing comparison**: Currently turbo and preview variants are kept separate. Could add UI to group them with their base model for side-by-side comparison.
