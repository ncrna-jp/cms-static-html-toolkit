import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.mjs';

const siteRoot = config.siteDir;
let changedCss = 0;
for (const sitePath of config.breadcrumbCssPaths) {
  const cssPath = path.join(siteRoot, sitePath);
  let css;
  try {
    css = await readFile(cssPath, 'utf8');
  } catch {
    continue;
  }
  const before = css;
  css = css.replace(
    /#rt-breadcrumbs \.icon-location:before\{[\s\S]*?\}/,
    [
      '#rt-breadcrumbs .icon-location:before{',
      '  content: ">" !important;',
      '  font-family: Arial, Helvetica, sans-serif !important;',
      '  font-size: 0.9em !important;',
      '}',
    ].join('\n'),
  );
  css = css.replace(
    /#rt-breadcrumbs \.breadcrumb \.divider:not\(\.icon-location\):before\{[\s\S]*?\}/,
    [
      '#rt-breadcrumbs .breadcrumb .divider:not(.icon-location):before{',
      '  content: ">" !important;',
      '  font-family: Arial, Helvetica, sans-serif !important;',
      '  display: inline-block !important;',
      '  margin: 0 4px !important;',
      '}',
    ].join('\n'),
  );
  if (css !== before) {
    await writeFile(cssPath, css);
    changedCss += 1;
  }
}

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
    const after = before.replace(
      /<span class="divider">(?!\s*<img\b)[\s\S]*?<\/span>/g,
      '<span class="divider">&gt;</span>',
    );
    if (after !== before) {
      changed += 1;
      await writeFile(full, after);
    }
  }
}

await walk(siteRoot);
console.log({ scanned, changed, changedCss });
