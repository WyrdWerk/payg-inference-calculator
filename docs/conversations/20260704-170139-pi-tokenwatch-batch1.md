---
timestamp: "2026-07-04T17:01:39+05:30"
session_id: "tokenwatch-batch1-20260704"
duration_minutes: 240
topics: ["tokenwatch", "payg-inference-calculator", "provider-search-fix", "dedup-quantization", "canonical-id-regex", "context-length", "sortable-headers", "promo-filter", "model-name-display", "provider-count-badge", "github-repo-rename", "secret-audit", "gitignore-hardening", "cloudflare-pages"]
related_repos: ["WyrdWerk/tokenwatch"]
related_sessions: ["20260704-001612-pi-phase1", "20260704-021100-pi-phase2-providers", "20260704-140700-pi-openrouter-deaggregation"]
artifacts: []
learnings: [
  "Text edit operations can silently drop adjacent keeper lines at boundaries — re-read after every edit to verify no lines lost",
  "canonicalId regex must cover ALL date formats providers use — original only matched -preview-MM-YY (2-digit year) but Google uses -preview-MM-YYYY and Qwen uses YYYYMMDD; missing formats cause silent duplicate rows",
  "When removing a dimension from dedup key (quantization), first-seen-wins is correct — tier order guarantees highest-authority tier wins; don't add cheapest-replacement logic that could downgrade to a lower tier",
  "HTML datalist option count: put count in text content not value attribute — <option value='DeepInfra'>DeepInfra (108)</option> — value fills the input, text shows in dropdown",
  "Null prices must sort to END in both directions when sorting price columns — never coerce to 0 (would falsely rank no-cache providers as cheapest)",
  "When fixing one provider's duplicate issue, run a comprehensive scan across all providers — not just the reported examples",
  "Don't fabricate context lengths for models without source data — set to null and show — rather than guessing",
  "API keys used for local fetch must NEVER appear in committed artifacts — hardcode resulting integers only, add source comment with date"
]
---

# Phase 4 — TokenWatch Batch 1 (Rename, Dedup, UI Enhancements)

## Phase Summary

Project renamed from PAYG Inference Calculator to TokenWatch. Fixed provider-search mismatch (was filtering on org instead of inference provider), removed quantization from dedup key, fixed canonicalId regex gaps, widened layout, performed secret audit, hardened `.gitignore`, added context length data (99.7% coverage), sortable headers, promo filter, model name display, and provider count badges.

## What Was Built

### Provider search fix
- "Search by provider" was filtering on `m.org` (model creator) instead of `m.provider` (inference host)
- Datalist now populates from 75 provider display names; filter matches on `m.provider` / `m.provider_display`

### Dedup improvements
- Removed quantization from dedup key → `(canonical_model, normalized_provider)` only
- First-seen/highest-tier wins: 944→892 models (52 quant-duplicates removed)
- Quant-in-ID entries (e.g., `glm-5.2-fp8`, `glm-5.2-nvfp4`) left as distinct entries per spec
- Fixed canonicalId regex: added `-preview-MM-YYYY`, `-preview-YYYY-MM-DD`, `YYYYMMDD`, `YYYYMM` patterns; 892→891 models

### Rename to TokenWatch
- Updated HTML title/header, `package.json`, README, AGENTS.md
- GitHub repo renamed `WyrdWerk/payg-inference-calculator` → `WyrdWerk/tokenwatch`
- GitHub repo link added in header

### Layout and responsive design
- `main` max-width: 1100px → 1400px
- Table cell padding reduced; 768px mobile breakpoint (controls stack, text wrapping)

### Security hardening
- Scanned working tree + full git history for secrets
- Removed `.reasonix/` from git tracking
- Hardened `.gitignore`: `.env`, `.env.*`, `.wrangler/`, `.dev.vars`, `*.pem`, `*.key`, `*.p12`, `*.pfx`

### Batch 1 UI features
- **Context column**: 99.7% coverage (888/891); Hyper from pricing table, Makora/OpenCode Go hardcoded, Xiaomimimo 1M for all three
- **Sortable headers**: Click to sort, click again to reverse; default Total Cost ascending; null prices sort to end
- **Promo filter**: Checkbox filters to `discount > 0` (62 rows)
- **Model name display**: Uses readable `name` field (e.g., "Z.ai: GLM 5.2") instead of raw ID
- **Provider count badge**: Datalist shows "DeepInfra (108)" — count in option text, not value
- **Space/hyphen normalization**: `s.toLowerCase().replace(/[\s-]+/g, ' ')` for model search

## Key Decisions

- Search by provider filters on inference provider, not org
- Remove quantization from dedup key; leave quant-suffix-baked-in IDs as distinct entries
- Rename project to TokenWatch across all files and GitHub repo
- Add Context column with — for missing values (no fabricated data)
- Sortable headers with null-to-end sorting
- Trophy badge only shows when sorted by cost ascending

## Technical Discoveries

### canonicalId regex gap
`gemini-2.5-flash-lite-preview-09-2025` and `gemini-2.5-flash-lite` appeared as duplicate rows — original regex `-preview-\d{2}-\d{2}$` only matched 2-digit years. Comprehensive scan after fix: 0 remaining same-(canonicalId, provider) duplicates.

### ring-2.6-1t ≠ ling-2.6-1t
Genuinely different models from InclusionAI (Ring = reasoning, Ling = base MoE); identical pricing coincidental; dedup correctly keeps separate.

### Edit boundary drops
Text edit operations silently dropped adjacent keeper lines multiple times during the session — always re-read affected regions after edits to verify integrity.

## Code Changes

| File | Changes |
|------|---------|
| `scripts/fetch-pricing.mjs` | Fixed canonicalId regex, context length maps (HYPER, MAKORA, XIAOMIMIMO, OpenCode Go) |
| `public/app.js` | Sort state, promo filter, fmtContext, model name display, provider count badge, space/hyphen normalization |
| `public/index.html` | TokenWatch branding, 9-column table (incl. Context), sortable headers, promo checkbox |
| `public/styles.css` | Sortable header styles, promo toggle, 768px mobile breakpoint |
| `public/pricing.json` | 891 models, 99.7% context coverage, 0 duplicates |

**Commits**:
- `6d2f340` feat: rename to TokenWatch, provider search, quant-free dedup, wider layout
- `3ee9ee6` security: remove key references, gitignore .reasonix/
- `b04b681` security: harden .gitignore
- `9884934` feat: sortable headers, context column, promo filter, model names, provider counts

## Final State

- **891 models** across **75 inference providers** and **11 source providers**
- **99.7% context length coverage** (888/891)
- **0 same-(canonicalId, provider) duplicates**
- **62 discounted rows** with promo badges
- **9-column table**: #, Org, Provider, Model, Input $/M, Output $/M, Cache Read $/M, Context, Total Cost
- **TokenWatch branding**; **GitHub repo**: WyrdWerk/tokenwatch (public)

## Follow-up (Planned — Batch 2)

- URL share state (encode search + tokens + sort in URL hash)
- Org/Provider visual grouping
- Export to CSV
- Dark/light toggle (localStorage)
- Custom domain for TokenWatch
- Periodic `data/manual-pricing.csv` maintenance

## References

- **Repo**: https://github.com/WyrdWerk/tokenwatch
- **Live site**: https://payg-inference-calculator.pages.dev
