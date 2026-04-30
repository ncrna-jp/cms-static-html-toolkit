import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.mjs';

const siteDir = config.siteDir;
const reportPath = path.join(config.reportDir, 'http-resource-check.csv');
const origin = config.localOrigin;

const htmlFiles = [];
const cssFiles = [];

async function walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (entry.isFile()) {
      if (entry.name.endsWith('.html')) htmlFiles.push(full);
      if (entry.name.endsWith('.css')) cssFiles.push(full);
    }
  }
}

function relUrl(file) {
  return '/' + path.relative(siteDir, file).replace(/\\/g, '/');
}

function isSkippable(raw) {
  const value = raw.trim();
  return (
    !value ||
    value.startsWith('#') ||
    /^(?:javascript|mailto|tel|data|blob):/i.test(value) ||
    value.startsWith('{') ||
    value.startsWith('<')
  );
}

function srcsetRefs(value) {
  return value
    .split(',')
    .map(candidate => candidate.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function addUrl(set, raw, baseUrl) {
  if (isSkippable(raw)) return;
  let url;
  try {
    url = new URL(raw.replace(/&amp;/g, '&'), baseUrl);
  } catch {
    return;
  }
  if (url.origin !== origin) return;
  url.hash = '';
  set.add(url.href);
}

function htmlRefs(text, pageUrl) {
  const refs = new Set([pageUrl.href]);
  const baseMatch = text.match(/<base\s+[^>]*href=(["'])(.*?)\1/i);
  const baseUrl = baseMatch ? new URL(baseMatch[2], pageUrl) : pageUrl;
  const attrPattern = /\b(href|src|srcset|poster|data|data-src|data-background|action)=("([^"]*)"|'([^']*)')/gi;
  for (const match of text.matchAll(attrPattern)) {
    const attr = match[1].toLowerCase();
    const value = match[3] ?? match[4] ?? '';
    const values = attr === 'srcset' ? srcsetRefs(value) : [value];
    for (const raw of values) addUrl(refs, raw, baseUrl);
  }
  return refs;
}

function cssRefs(text, cssUrl) {
  const refs = new Set([cssUrl.href]);
  const urlPattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  for (const match of text.matchAll(urlPattern)) addUrl(refs, match[2] ?? '', cssUrl);
  const importPattern = /@import\s+(?:url\()?["']?([^"')\s;]+)["']?\)?/gi;
  for (const match of text.matchAll(importPattern)) addUrl(refs, match[1] ?? '', cssUrl);
  return refs;
}

function csvCell(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

await walk(siteDir);

const urls = new Set();

for (const file of htmlFiles) {
  const text = await fs.readFile(file, 'utf8');
  const pageUrl = new URL(relUrl(file), origin);
  for (const url of htmlRefs(text, pageUrl)) urls.add(url);
}

for (const file of cssFiles) {
  const text = await fs.readFile(file, 'utf8');
  const cssUrl = new URL(relUrl(file), origin);
  for (const url of cssRefs(text, cssUrl)) urls.add(url);
}

const failures = [];
const list = [...urls].sort();
let index = 0;
const workers = Array.from({ length: 12 }, async () => {
  while (index < list.length) {
    const url = list[index++];
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.status >= 400) {
        failures.push({ url, status: response.status, statusText: response.statusText });
      }
      await response.arrayBuffer();
    } catch (error) {
      failures.push({ url, status: 'ERROR', statusText: error.message });
    }
  }
});

await Promise.all(workers);

await fs.mkdir(path.dirname(reportPath), { recursive: true });
await fs.writeFile(
  reportPath,
  ['url,status,statusText', ...failures.map(row => [
    row.url,
    row.status,
    row.statusText,
  ].map(csvCell).join(','))].join('\n'),
  'utf8',
);

console.log(JSON.stringify({
  checked: list.length,
  failures: failures.length,
  report: reportPath,
}, null, 2));
