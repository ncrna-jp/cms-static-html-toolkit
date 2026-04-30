import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.mjs';

const root = config.siteDir;
const gaBlock = /\(function\(i,s,o,g,r,a,m\)\{i\['GoogleAnalyticsObject'\]=r;[\s\S]*?google-analytics\.com\/analytics\.js[\s\S]*?__gaTracker\('send',\s*'pageview'\);\s*/g;

let scanned = 0;
let changed = 0;

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
    const after = before.replace(gaBlock, '');
    if (after !== before) {
      changed += 1;
      await writeFile(full, after);
    }
  }
}

await walk(root);
console.log({ scanned, changed });
