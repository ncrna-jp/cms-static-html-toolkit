import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.mjs';

const siteDir = config.siteDir;
const reportDir = config.reportDir;
const reportPath = path.join(reportDir, 'removable-files.csv');

const allFiles = [];
const referenced = new Set();
const htmlFiles = new Set();

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

function siteUrl(file) {
  return '/' + rel(file);
}

function skip(raw) {
  const value = raw.trim();
  return (
    !value ||
    value.startsWith('#') ||
    /^(?:https?:)?\/\//i.test(value) ||
    /^(?:javascript|mailto|tel|data|blob|ftp):/i.test(value) ||
    value.startsWith('{') ||
    value.startsWith('<')
  );
}

function isStylesheetLike(file) {
  const lower = file.toLowerCase();
  return lower.endsWith('.css') || lower.endsWith('typography2.php');
}

function srcsetRefs(value) {
  return value.split(',').map(candidate => candidate.trim().split(/\s+/)[0]).filter(Boolean);
}

async function exists(file) {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

function fileFromUrl(url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';
  return path.join(siteDir, pathname.replace(/^\/+/, ''));
}

async function addRef(raw, baseUrl) {
  if (skip(raw)) return;
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

await walk(siteDir);

for (const file of allFiles) {
  if (file.endsWith('.html')) htmlFiles.add(rel(file));
}

for (const file of allFiles) {
  const lower = file.toLowerCase();
  if (!lower.endsWith('.html') && !isStylesheetLike(file)) continue;
  const text = await fs.readFile(file, 'utf8');
  const pageUrl = new URL(siteUrl(file), 'https://static.local');
  let baseUrl = pageUrl;

  if (lower.endsWith('.html')) {
    const baseMatch = text.match(/<base\s+[^>]*href=(["'])(.*?)\1/i);
    if (baseMatch) baseUrl = new URL(baseMatch[2], pageUrl);

    const attrPattern = /\b(href|src|srcset|poster|data|data-src|data-background|action)=("([^"]*)"|'([^']*)')/gi;
    for (const match of text.matchAll(attrPattern)) {
      const attr = match[1].toLowerCase();
      const value = match[3] ?? match[4] ?? '';
      const values = attr === 'srcset' ? srcsetRefs(value) : [value];
      for (const item of values) await addRef(item, baseUrl);
    }

    const inlineUrlPattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
    for (const match of text.matchAll(inlineUrlPattern)) await addRef(match[2] ?? '', baseUrl);
  }

  if (isStylesheetLike(file)) {
    const cssBase = pageUrl;
    const urlPattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
    for (const match of text.matchAll(urlPattern)) await addRef(match[2] ?? '', cssBase);
    const importPattern = /@import\s+(?:url\()?["']?([^"')\s;]+)["']?\)?/gi;
    for (const match of text.matchAll(importPattern)) await addRef(match[1] ?? '', cssBase);
  }
}

const removable = [];
for (const file of allFiles) {
  const relative = rel(file);
  const stat = await fs.stat(file);
  const feedFile = relative.includes('.feed/');
  const apacheOnly = relative === '.htaccess';
  const hostingControl = relative === '.nojekyll';
  const keepConfigured = config.keepUnreferencedPaths.includes(relative);
  const unreferencedAsset = !hostingControl && !keepConfigured && !htmlFiles.has(relative) && !referenced.has(relative);

  if (feedFile || apacheOnly || unreferencedAsset) {
    removable.push({
      file: relative,
      reason: feedFile ? 'feed-html-unneeded' : apacheOnly ? 'apache-only-not-used-on-pages' : 'unreferenced-non-html-asset',
      bytes: stat.size,
      mb: Number((stat.size / 1024 / 1024).toFixed(4)),
    });
  }
}

await fs.mkdir(reportDir, { recursive: true });
await fs.writeFile(
  reportPath,
  ['file,reason,bytes,mb', ...removable.map(row => [
    row.file,
    row.reason,
    row.bytes,
    row.mb,
  ].map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))].join('\n'),
  'utf8',
);

const byReason = removable.reduce((acc, row) => {
  const item = acc[row.reason] ?? { count: 0, mb: 0 };
  item.count += 1;
  item.mb += row.bytes / 1024 / 1024;
  acc[row.reason] = item;
  return acc;
}, {});

for (const item of Object.values(byReason)) item.mb = Number(item.mb.toFixed(4));

console.log(JSON.stringify({
  removable: removable.length,
  mb: Number((removable.reduce((sum, row) => sum + row.bytes, 0) / 1024 / 1024).toFixed(4)),
  byReason,
  report: reportPath,
}, null, 2));
