import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.mjs';

const siteDir = config.siteDir;
const allFiles = [];
const referenced = new Set();
const entryHtml = new Set();

async function walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (entry.isFile()) allFiles.push(full);
  }
}

function rel(file) {
  return path.relative(siteDir, file).replace(/\\/g, '/');
}

function urlPath(file) {
  return '/' + rel(file);
}

function isSkip(value) {
  const raw = value.trim();
  return (
    !raw ||
    raw.startsWith('#') ||
    /^(?:https?:)?\/\//i.test(raw) ||
    /^(?:javascript|mailto|tel|data|blob|ftp):/i.test(raw) ||
    raw.startsWith('{') ||
    raw.startsWith('<')
  );
}

function fileFromUrl(url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';
  return path.join(siteDir, pathname.replace(/^\/+/, ''));
}

async function exists(file) {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

async function addRef(raw, baseUrl) {
  if (isSkip(raw)) return;
  let url;
  try {
    url = new URL(raw.replace(/&amp;/g, '&'), baseUrl);
  } catch {
    return;
  }
  if (url.origin !== 'https://static.local') return;
  const file = fileFromUrl(url);
  if (await exists(file)) referenced.add(rel(file));
}

function srcsetRefs(value) {
  return value.split(',').map(candidate => candidate.trim().split(/\s+/)[0]).filter(Boolean);
}

await walk(siteDir);

for (const file of allFiles) {
  if (file.endsWith('.html')) entryHtml.add(rel(file));
}

for (const file of allFiles) {
  const lower = file.toLowerCase();
  if (!lower.endsWith('.html') && !lower.endsWith('.css')) continue;
  const text = await fs.readFile(file, 'utf8');
  const pageUrl = new URL(urlPath(file), 'https://static.local');
  let baseUrl = pageUrl;

  if (lower.endsWith('.html')) {
    const baseMatch = text.match(/<base\s+[^>]*href=(["'])(.*?)\1/i);
    if (baseMatch) baseUrl = new URL(baseMatch[2], pageUrl);

    const attrPattern = /\b(href|src|srcset|poster|data|data-src|data-background|action)=("([^"]*)"|'([^']*)')/gi;
    for (const match of text.matchAll(attrPattern)) {
      const attr = match[1].toLowerCase();
      const value = match[3] ?? match[4] ?? '';
      const values = attr === 'srcset' ? srcsetRefs(value) : [value];
      for (const raw of values) await addRef(raw, baseUrl);
    }

    const styleUrls = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
    for (const match of text.matchAll(styleUrls)) await addRef(match[2] ?? '', baseUrl);
  }

  if (lower.endsWith('.css')) {
    const cssBase = pageUrl;
    const cssUrls = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
    for (const match of text.matchAll(cssUrls)) await addRef(match[2] ?? '', cssBase);
    const cssImport = /@import\s+(?:url\()?["']?([^"')\s;]+)["']?\)?/gi;
    for (const match of text.matchAll(cssImport)) await addRef(match[1] ?? '', cssBase);
  }
}

const folders = new Map();
for (const file of allFiles) {
  const r = rel(file);
  const [top = '(root)'] = r.split('/');
  const stat = await fs.stat(file);
  const item = folders.get(top) ?? { folder: top, files: 0, mb: 0, html: 0, referencedFiles: 0, entryHtml: 0 };
  item.files += 1;
  item.mb += stat.size / 1024 / 1024;
  if (r.endsWith('.html')) item.html += 1;
  if (referenced.has(r)) item.referencedFiles += 1;
  if (entryHtml.has(r)) item.entryHtml += 1;
  folders.set(top, item);
}

const rows = [...folders.values()]
  .filter(row => row.folder !== '(root)')
  .sort((a, b) => a.folder.localeCompare(b.folder))
  .map(row => ({
    ...row,
    mb: Number(row.mb.toFixed(2)),
    probablyNeeded: row.referencedFiles > 0 || row.entryHtml > 0,
  }));

await fs.mkdir(config.reportDir, { recursive: true });
await fs.writeFile(
  path.join(config.reportDir, 'folder-usage.json'),
  JSON.stringify({ referencedFiles: referenced.size, folders: rows }, null, 2),
  'utf8',
);

console.table(rows);
console.log(JSON.stringify({
  referencedFiles: referenced.size,
  report: path.join(config.reportDir, 'folder-usage.json'),
}, null, 2));
