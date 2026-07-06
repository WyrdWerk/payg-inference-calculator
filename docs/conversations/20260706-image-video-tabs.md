# TokenWatch — Image & Video Generation Tabs

**Date**: 2026-07-06
**Session**: Adding image + video generation pricing to TokenWatch
**Status**: ✅ Deployed

---

## Summary

TokenWatch now tracks image and video generation model pricing from OpenRouter's dedicated APIs, in addition to the existing text-generation catalog. Three separate tabs (Text/Image/Video) with shared navigation, each loading its own pricing data.

## OpenRouter API Discovery

OpenRouter has three separate model catalogs — all list without authentication:

| Catalog | Endpoint | Models | Pricing |
|---|---|---|---|
| Text | `GET /api/v1/models` | 340 | $/token → $/M tokens |
| Image | `GET /api/v1/images/models` + `/endpoints` | 39 listed, 34 with pricing | image/megapixel/token units |
| Video | `GET /api/v1/videos/models` | 16 listed, 13 with pricing | per-second with resolution/audio |

**Critical finding**: The chat `/v1/models` endpoint does NOT contain image/video generation models. Must query separate catalogs.

## Image Pricing Units

Three unit types from OpenRouter endpoint pricing:

| Unit | Example | Per-unit price | Computable as count × price? |
|---|---|---|---|
| `image` | Sourceful Riverflow | $0.019/image | Yes |
| `megapixel` | FLUX.2 Klein 4B | $0.014/MP | No (varies by resolution) |
| `token` | Nano Banana 2 Lite | $30/M tokens | No (varies by complexity) |

## Video Pricing

- `pricing_skus` on model level (no endpoint fetch)
- Keys: `duration_seconds_720p`, `duration_seconds_with_audio`, `cents_per_video_output_second_480p`
- Normalization: cent-denominated keys (`cents_*`) → value / 100
- Per-second filter: `/second/i` regex excludes per-token SKUs (`video_tokens`)
- Result: 13 models with per-second pricing ($0.03-$0.60/sec)

## Architecture

### New files (9)
```
scripts/lib.mjs                    Shared utilities (org, dedup, HTTP, guards)
scripts/fetch-images.mjs           Image pipeline → public/image-pricing.json
scripts/fetch-videos.mjs           Video pipeline → public/video-pricing.json
public/image-pricing.json          34 image models
public/video-pricing.json          13 video models
public/image.html                  Image pricing tab
public/image-app.js                Image frontend logic
public/video.html                  Video pricing tab
public/video-app.js                Video frontend logic
```

### Modified files (4)
```
package.json                       Added fetch:images, fetch:videos, fetch:all
public/index.html                  Added tab nav
public/styles.css                  Added .tab-nav styles
.github/workflows/refresh-pricing.yml  Added image + video fetch steps
```

### Design decisions
- Model creator = provider (no OpenRouter de-aggregation for image/video)
- No ZDR/subscription badges on image/video tabs
- Separate JSON files per modality (different schemas)
- CI daily cron runs all three pipelines

## Bugs Fixed During Session

1. **Package.json corruption**: Edit tool dropped `"scripts": {` wrapper → invalid JSON → Cloudflare deploy failed. Fixed by rewrite + `JSON.parse()` validation.

2. **Video per-token SKUs included**: Seedance models have `video_tokens` keys that aren't per-second → producing nonsensical $0.0000056/sec values. Fixed with `/second/i` filter in pipeline.

3. **Megapixel unit not handled**: Black Forest Labs Flux models use `unit:"megapixel"` — initially invisible in frontend. Fixed by making unit display adaptive and showing "varies" for non-computable units.

4. **Token price rendering**: Raw per-token values ($0.00003) rendered as "$0.0000" with toFixed(4). Fixed by displaying `cost_per_million` as "$X/M tokens" for token-priced rows.

## Commit History
- `44f7dd0` feat: image + video generation pricing tabs (12 files, +3274)
- `f32c077` fix(ci): add image + video fetch steps to daily refresh
- `6fdf6a1` fix: repair broken package.json (missing scripts key)
- `072b21f` docs: image + video generation tabs — README, AGENTS.md, TODO.md
