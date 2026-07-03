# AGENTS.md — PAYG Inference Calculator

## Project overview

Static site comparing pay-as-you-go LLM API pricing across 5 providers (OpenRouter, DeepInfra, Crof, EmberCloud, Wafer). Zero dependencies, pure Node ESM. Deployed to Cloudflare Pages with daily CI/CD refresh.

## Architecture

- **Data pipeline**: `scripts/fetch-pricing.mjs` fetches `/v1/models` from each provider, normalizes pricing to $/M tokens, extracts `org` (underlying model creator) from model IDs, writes `public/pricing.json`.
- **Frontend**: `public/` static site loads `pricing.json` client-side. Cost computation happens entirely in-browser.
- **CI/CD**: `.github/workflows/refresh-pricing.yml` runs daily at 00:00 UTC — fetch → commit → deploy to Cloudflare Pages.

## Key conventions

### Pricing normalization

All prices are stored as **USD per million tokens ($/M)**. Conversion by provider:
- OpenRouter / EmberCloud: $/token → ×1e6
- DeepInfra / Crof: $/M (passthrough)
- Wafer: cents/M → ÷100

### Org extraction

OpenRouter is an aggregator, not a provider. The `org` field extracts the underlying model creator:
1. From model ID prefix: `anthropic/claude-sonnet-5` → `anthropic`
2. Cross-reference: models without `/` (e.g., Crof's `glm-5.2`) matched against canonical IDs from models that have org prefixes
3. From model name: `DeepSeek: DeepSeek V4 Pro` → `deepseek`
4. Fallback: provider name (e.g., Crof's `greg-2-ultra` → `crof`)

Org aliases normalized: `deepseek-ai`→`deepseek`, `zai-org`→`z-ai`, `meta-llama`→`meta`, `minimaxai`→`minimax`, etc.

### Data filtering

- `:free` entries are dropped (nobody cares about free tier)
- Negative placeholder prices are dropped (OpenRouter meta-routers use -1000000)
- LLMGateway was removed entirely (mirror of OpenRouter at identical prices)

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

1. **OpenRouter MCP server**: Could use `https://mcp.openrouter.ai/mcp` for enriched model metadata, but current org extraction from model ID prefixes already covers all 56 orgs.
2. **Turbo/preview pricing comparison**: Currently turbo and preview variants are kept separate. Could add UI to group them with their base model for side-by-side comparison.
