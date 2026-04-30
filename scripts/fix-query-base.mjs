import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.mjs';

const queryDir = path.join(config.siteDir, '__query');
let files = [];
try {
  files = await fs.readdir(queryDir);
} catch {
  console.log({ changed: 0, skipped: 'no __query directory' });
  process.exit(0);
}
let changed = 0;

for (const file of files) {
  if (!file.endsWith('.html')) continue;
  const fullPath = path.join(queryDir, file);
  const html = await fs.readFile(fullPath, 'utf8');
  const next = html.replace(
    /<base\s+href=(["'])(.*?)\1\s*\/?>/i,
    `<base href="${file}" />`,
  );

  if (next !== html) {
    await fs.writeFile(fullPath, next, 'utf8');
    changed += 1;
  }
}

console.log(JSON.stringify({ changed }, null, 2));
