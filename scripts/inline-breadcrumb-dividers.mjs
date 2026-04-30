import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.mjs';

const root = config.siteDir;
const arrowPattern =
  /<span class="divider">\s*<img\s+src=(["'])[^"']*media\/system\/images\/arrow\.png\1\s+alt=(["'])\2\s*\/?>\s*<\/span>/g;

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
    const after = before.replace(arrowPattern, '<span class="divider">›</span>');
    if (after !== before) {
      changed += 1;
      await writeFile(full, after);
    }
  }
}

await walk(root);
console.log({ scanned, changed });
