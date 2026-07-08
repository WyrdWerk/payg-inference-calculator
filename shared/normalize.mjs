/**
 * shared/normalize.mjs — pure canonicalization helpers shared by the Node
 * pipeline (scripts/) and the Cloudflare Pages Function (functions/).
 *
 * This module MUST NOT import any node: builtins. It is bundled into a
 * Cloudflare Worker (which has no node:fs unless nodejs_compat is enabled),
 * so every function here must be a pure string transform.
 *
 * Imported by:
 *   - scripts/lib.mjs                       (re-exports these)
 *   - functions/api/v1/[[route]].js         (direct import — replaces the
 *     former local normalizeId, which had a greedy -preview-.*$ catch-all
 *     that over-stripped -preview-customtools and caused distinct models to
 *     collide in /models/:id/providers)
 */

/**
 * Build canonical model ID for cross-referencing and dedup.
 * Strips provider prefix, suffixes (:free, dates, -preview, :thinking), lowercases.
 *
 * Date formats stripped: YYYY-MM-DD (-YYYY-MM-DD), YYYYMMDD (-YYYYMMDD), YYMMDD (-YYMMDD).
 * Preview formats stripped: -preview, -preview-MM-YY, -preview-MM-YYYY, -preview-YYYY-MM-DD.
 *
 * IMPORTANT: unknown -preview-<foo> suffixes (e.g. -preview-customtools) are
 * PRESERVED as distinct entries. The API's former normalizeId used a greedy
 * -preview-.*$ catch-all that over-stripped these, causing distinct models
 * (e.g. gemini-3.1-pro vs gemini-3.1-pro-preview-customtools) to collide in
 * /models/:id/providers. Do NOT reintroduce that catch-all.
 *
 * Turbo variants kept separate (different SKUs).
 * Quantization suffixes baked into the ID (e.g. glm-5.2-fp8) are left as-is —
 * they are distinct model entries, not collapsed.
 */
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

/**
 * Build a key for org cross-referencing.
 * Like canonicalId but also strips quantization and tier suffixes.
 * Used ONLY for org resolution — not for dedup or model display.
 */
export function orgLookupKey(id) {
  return canonicalId(id)
    .replace(/-(fp8|nvfp4|int4-mixed-ar|int4|bf16|fp16|fp6|mxfp4)$/, '')
    .replace(/-long$/, '');
}
