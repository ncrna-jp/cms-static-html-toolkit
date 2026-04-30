import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.mjs';

const OUT_DIR = config.siteDir;
const REPORT_DIR = config.reportDir;
const rows = [];
const literalRows = [];
const slowRows = [];

async function walk(dir, files = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, files);
    else files.push(full);
  }
  return files;
}

async function exists(file) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

function rel(file) {
  return path.relative(process.cwd(), file).replace(/\\/g, '/');
}

function add(file, kind, value, detail = '') {
  rows.push([rel(file), kind, value, detail]);
}

function addSlow(file, kind, value, detail = '') {
  slowRows.push([rel(file), kind, value, detail]);
}

function addLiteral(file, kind, value, detail = '') {
  literalRows.push([rel(file), kind, value, detail]);
}

function isDataOrAnchor(url) {
  return /^(?:data|blob|mailto|tel|javascript):/i.test(url) || url.startsWith('#');
}

function isExternal(url) {
  return /^(?:https?:)?\/\//i.test(url);
}

function localFsPath(baseFile, rawUrl) {
  const url = rawUrl.trim().replace(/&amp;/g, '&').split('#')[0].split('?')[0];
  if (!url || isDataOrAnchor(url) || isExternal(url)) return null;
  const normalized = decodeURIComponent(url);
  if (normalized.startsWith('/')) return path.join(OUT_DIR, normalized.replace(/^\/+/, ''));
  return path.resolve(path.dirname(baseFile), normalized);
}

function attrs(tag) {
  const out = new Map();
  const re = /\s([a-zA-Z0-9:_-]+)=("[^"]*"|'[^']*')/g;
  let m;
  while ((m = re.exec(tag))) out.set(m[1].toLowerCase(), m[2].slice(1, -1));
  return out;
}

function csv(rows) {
  return rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
}

const files = await walk(OUT_DIR);

for (const file of files) {
  const lower = file.toLowerCase();
  if (!lower.endsWith('.html') && !lower.endsWith('.css') && !lower.endsWith('.js')) continue;
  const text = await readFile(file, 'utf8');

  if (lower.endsWith('.html')) {
    const tagRe = /<(script|link|img|source|video|audio|iframe|embed|object|form)\b[^>]*>/gi;
    let m;
    while ((m = tagRe.exec(text))) {
      const tagName = m[1].toLowerCase();
      const tag = m[0];
      const a = attrs(tag);
      const relAttr = (a.get('rel') ?? '').toLowerCase();
      const resourceAttrs = [];

      if (tagName === 'script') resourceAttrs.push('src');
      if (tagName === 'link' && /\b(?:stylesheet|preload|modulepreload|icon|shortcut icon|apple-touch-icon|manifest|preconnect|dns-prefetch)\b/.test(relAttr)) {
        resourceAttrs.push('href');
      }
      if (['img', 'source', 'video', 'audio', 'iframe', 'embed'].includes(tagName)) {
        resourceAttrs.push('src', 'srcset', 'poster');
      }
      if (tagName === 'object') resourceAttrs.push('data');
      if (tagName === 'form') resourceAttrs.push('action');

      for (const attr of resourceAttrs) {
        const value = a.get(attr);
        if (!value || isDataOrAnchor(value)) continue;
        if (isExternal(value)) add(file, `external-${tagName}-${attr}`, value);
        if (attr === 'srcset') {
          for (const candidate of value.split(',')) {
            const src = candidate.trim().split(/\s+/)[0];
            const fsPath = localFsPath(file, src);
            if (fsPath && !(await exists(fsPath))) add(file, 'missing-srcset-file', src, rel(fsPath));
          }
          continue;
        }
        const fsPath = localFsPath(file, value);
        if (fsPath && !(await exists(fsPath))) add(file, `missing-${tagName}-${attr}`, value, rel(fsPath));
      }

      if (tagName === 'iframe') addSlow(file, 'iframe', a.get('src') ?? '', 'iframes can delay/render late');
    }

    const loadWait = /(?:jQuery|\$)\s*\(\s*window\s*\)\s*\.\s*load|window\.addEventListener\s*\(\s*['"]load['"]|window\.onload\s*=/gi;
    if (loadWait.test(text)) addSlow(file, 'window-load-handler', '', 'code waits for full page load before running');

    const timer = /set(?:Timeout|Interval)\s*\(/gi;
    if (timer.test(text)) addSlow(file, 'timer-script', '', 'timer-based behavior present');
  }

  if (lower.endsWith('.css') || lower.endsWith('.html')) {
    const cssUrls = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
    let m;
    while ((m = cssUrls.exec(text))) {
      const value = m[2].trim();
      if (!value || isDataOrAnchor(value)) continue;
      if (isExternal(value)) add(file, 'external-css-url', value);
      const fsPath = localFsPath(file, value);
      if (fsPath && !(await exists(fsPath))) add(file, 'missing-css-url-file', value, rel(fsPath));
    }

    const cssImport = /@import\s+(?:url\()?["']?([^"')\s;]+)["']?\)?/gi;
    while ((m = cssImport.exec(text))) {
      const value = m[1].trim();
      if (isExternal(value)) add(file, 'external-css-import', value);
      const fsPath = localFsPath(file, value);
      if (fsPath && !(await exists(fsPath))) add(file, 'missing-css-import-file', value, rel(fsPath));
    }
  }

  if (lower.endsWith('.css')) {
    const fontFace = /@font-face\s*\{[\s\S]*?\}/gi;
    let m;
    while ((m = fontFace.exec(text))) {
      const block = m[0];
      const urls = [...block.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)].map((match) => match[2].trim());
      for (const value of urls) {
        if (isExternal(value)) add(file, 'external-font-url', value);
        const fsPath = localFsPath(file, value);
        if (fsPath && !(await exists(fsPath))) add(file, 'missing-font-file', value, rel(fsPath));
      }
    }
  }

  if (lower.endsWith('.js') || lower.endsWith('.html')) {
    const likelyNetwork = /\b(?:fetch|XMLHttpRequest|\.ajax|\$\.get|\$\.post|getJSON)\b/gi;
    if (likelyNetwork.test(text)) addSlow(file, 'ajax-capable-code', '', 'contains Ajax-capable code; runtime requests checked separately');

    const literalExternal = /["']((?:https?:)?\/\/[^"']+)["']/gi;
    let m;
    while ((m = literalExternal.exec(text))) {
      const value = m[1];
      if (config.externalLiteralAllowPatterns.some((pattern) => new RegExp(pattern, 'i').test(value))) continue;
      addLiteral(file, 'external-url-literal', value);
    }
  }
}

await mkdir(REPORT_DIR, { recursive: true });
await writeFile(path.join(REPORT_DIR, 'loading-dependencies.csv'), csv([['file', 'kind', 'value', 'detail'], ...rows]));
await writeFile(path.join(REPORT_DIR, 'external-url-literals.csv'), csv([['file', 'kind', 'value', 'detail'], ...literalRows]));
await writeFile(path.join(REPORT_DIR, 'loading-gimmicks.csv'), csv([['file', 'kind', 'value', 'detail'], ...slowRows]));

const byKind = rows.reduce((acc, [, kind]) => {
  acc[kind] = (acc[kind] ?? 0) + 1;
  return acc;
}, {});
const slowByKind = slowRows.reduce((acc, [, kind]) => {
  acc[kind] = (acc[kind] ?? 0) + 1;
  return acc;
}, {});

console.log({
  dependencyIssues: rows.length,
  byKind,
  externalUrlLiterals: literalRows.length,
  slowSignals: slowRows.length,
  slowByKind,
  dependencyReport: path.join(REPORT_DIR, 'loading-dependencies.csv'),
  literalReport: path.join(REPORT_DIR, 'external-url-literals.csv'),
  slowReport: path.join(REPORT_DIR, 'loading-gimmicks.csv'),
});
