#!/usr/bin/env node
/**
 * bust-cache.mjs — rewrite ?v= cache-bust tokens in public/*.html to content
 * hashes of the referenced assets.
 *
 * Replaces the former hand-maintained ?v=20260707e strings that were bumped
 * manually per deploy and occasionally forgotten (causing stale-JS-against-
 * new-HTML bugs — see SESSION-2026-07-05-enhancement.md Lesson #7).
 *
 * Run before deploy in CI (deploy job) OR locally via `npm run bust:cache`.
 * The rewritten HTML is uploaded to Cloudflare but NOT committed to the repo
 * — the repo keeps its old ?v= and every deploy gets fresh content hashes.
 *
 * Zero dependencies. Node >=18.
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

// Match href="...?v=..." or src="...?v=..." — captures the asset path and the
// full ?v=<old> token so we can replace just the version.
const REF_REGEX = /((?:href|src)=["'])([^"'?]+)(\?v=)([^"']*)/g;

/** Compute an 8-char SHA-1 content hash for an asset file. */
async function hashFile(filePath) {
  const content = await readFile(filePath, 'utf-8');
  return createHash('sha1').update(content).digest('hex').slice(0, 8);
}

/** Rewrite ?v= tokens in a single HTML file. Returns count of tokens busted. */
async function bustHtml(htmlPath) {
  let html = await readFile(htmlPath, 'utf-8');
  const matches = [...html.matchAll(REF_REGEX)];
  if (matches.length === 0) return 0;

  // Compute hashes for all referenced assets (dedup by asset path)
  const assetHashes = new Map(); // assetPath → hash
  for (const match of matches) {
    const assetPath = match[2];
    if (!assetHashes.has(assetPath)) {
      const assetAbs = join(PUBLIC_DIR, basename(assetPath));
      try {
        const hash = await hashFile(assetAbs);
        assetHashes.set(assetPath, hash);
      } catch {
        // Asset not found — leave its ?v= unchanged
        assetHashes.set(assetPath, null);
      }
    }
  }

  // Synchronous replace using the computed hashes
  let count = 0;
  html = html.replace(REF_REGEX, (full, prefix, assetPath, queryToken, oldHash) => {
    const hash = assetHashes.get(assetPath);
    if (hash === null) return full; // asset not found, leave as-is
    count++;
    return `${prefix}${assetPath}${queryToken}${hash}`;
  });

  if (count > 0) {
    await writeFile(htmlPath, html, 'utf-8');
  }
  return count;
}

async function main() {
  const htmlFiles = (await readdir(PUBLIC_DIR))
    .filter(f => f.endsWith('.html'))
    .map(f => join(PUBLIC_DIR, f));

  let totalBusted = 0;
  for (const htmlFile of htmlFiles) {
    const count = await bustHtml(htmlFile);
    const rel = htmlFile.replace(PUBLIC_DIR + '/', '');
    if (count > 0) {
      console.log(`✓ ${rel}: ${count} cache-bust token(s) updated`);
      totalBusted += count;
    } else {
      console.log(`· ${rel}: no ?v= tokens found`);
    }
  }
  console.log(`\n→ ${totalBusted} cache-bust token(s) updated across ${htmlFiles.length} HTML file(s)`);
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
