#!/usr/bin/env node
/**
 * minify-json.mjs — minify public/*.json for deploy.
 *
 * Pretty-printed JSON stays in git for readable diffs; this script strips
 * whitespace at deploy time only (run in CI right before `wrangler pages
 * deploy`, never committed). Lossless by construction: each file is
 * JSON.parse'd then JSON.stringify'd with no indentation. If parsing fails
 * for any file, we log the error and exit non-zero WITHOUT writing
 * anything, so a corrupt/partial file can never reach a deploy.
 *
 * Run via `node scripts/minify-json.mjs` from repo root.
 *
 * Zero dependencies. Node >=18.
 */

import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

async function main() {
  const jsonFiles = (await readdir(PUBLIC_DIR))
    .filter(f => f.endsWith('.json'))
    .map(f => join(PUBLIC_DIR, f));

  let totalBefore = 0;
  let totalAfter = 0;

  for (const filePath of jsonFiles) {
    const rel = filePath.replace(PUBLIC_DIR + '/', '');
    const before = (await stat(filePath)).size;
    const raw = await readFile(filePath, 'utf-8');

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error(`Fatal: failed to parse ${rel}: ${err.message}`);
      process.exit(1);
    }

    const minified = JSON.stringify(parsed);
    const after = Buffer.byteLength(minified, 'utf-8');

    await writeFile(filePath, minified, 'utf-8');

    console.log(`${rel}  ${before} → ${after} bytes`);
    totalBefore += before;
    totalAfter += after;
  }

  const saved = totalBefore - totalAfter;
  const pct = totalBefore > 0 ? ((saved / totalBefore) * 100).toFixed(1) : '0.0';
  console.log(`\n→ ${jsonFiles.length} JSON file(s) minified: ${totalBefore} → ${totalAfter} bytes (saved ${saved} bytes, ${pct}%)`);
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
