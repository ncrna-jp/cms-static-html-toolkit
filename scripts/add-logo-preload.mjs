import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.mjs';

const root = config.siteDir;
const logoPath = path.join(root, config.logoPath);
const selectors = config.logoSelectors.length ? config.logoSelectors : [path.basename(config.logoPath)];

let scanned = 0;
let changed = 0;
let skippedExisting = 0;

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.html')) continue;

    scanned += 1;
    const before = await readFile(full, 'utf8');
    if (!selectors.some((selector) => before.includes(selector))) continue;
    if (new RegExp(`rel=["']preload["'][^>]+as=["']image["'][^>]+${path.basename(config.logoPath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(before)) {
      skippedExisting += 1;
      continue;
    }

    const relLogo = path.relative(path.dirname(full), logoPath).replaceAll(path.sep, '/');
    const preload = `\n\t<link rel="preload" as="image" href="${relLogo}" fetchpriority="high" />`;
    let after = before.replace(/(<title>[\s\S]*?<\/title>)/, `$1${preload}`);
    if (after === before) {
      after = before.replace(/(<head[^>]*>)/i, `$1${preload}`);
    }
    if (after !== before) {
      changed += 1;
      await writeFile(full, after);
    }
  }
}

await walk(root);
console.log({ scanned, changed, skippedExisting });
