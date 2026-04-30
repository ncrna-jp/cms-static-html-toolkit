import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.mjs';

const siteDir = config.siteDir;
const reportPath = path.join(config.reportDir, 'browser-resolved-links.csv');
const siteOrigin = config.localOrigin;

const htmlFiles = [];

async function walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      htmlFiles.push(fullPath);
    }
  }
}

function toUrlPath(filePath) {
  return '/' + path.relative(siteDir, filePath).replace(/\\/g, '/');
}

function toLocalFile(url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';
  return path.join(siteDir, pathname.replace(/^\/+/, ''));
}

function refsFromSrcset(value) {
  return value
    .split(',')
    .map(candidate => candidate.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function isSkippable(value) {
  const trimmed = value.trim();
  return (
    !trimmed ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('javascript:') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('tel:') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('{') ||
    trimmed.startsWith('<')
  );
}

function csvCell(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

await walk(siteDir);

const missing = [];
for (const htmlFile of htmlFiles) {
  const html = await fs.readFile(htmlFile, 'utf8');
  const pageUrl = new URL(toUrlPath(htmlFile), siteOrigin);
  const baseMatch = html.match(/<base\s+[^>]*href=(["'])(.*?)\1/i);
  const baseUrl = baseMatch ? new URL(baseMatch[2], pageUrl) : pageUrl;

  const attrPattern = /\b(href|src|srcset|poster|data|data-src|data-background|action)=("([^"]*)"|'([^']*)')/gi;
  for (const match of html.matchAll(attrPattern)) {
    const attr = match[1].toLowerCase();
    const value = match[3] ?? match[4] ?? '';
    if (isSkippable(value)) continue;

    const values = attr === 'srcset' ? refsFromSrcset(value) : [value];
    for (const refValue of values) {
      if (isSkippable(refValue)) continue;

      let resolved;
      try {
        resolved = new URL(refValue, baseUrl);
      } catch {
        continue;
      }

      if (resolved.origin !== siteOrigin) continue;
      const target = toLocalFile(resolved);
      try {
        await fs.access(target);
      } catch {
        missing.push({
          page: path.relative(siteDir, htmlFile).replace(/\\/g, '/'),
          base: baseMatch?.[2] ?? '',
          attr,
          value: refValue,
          resolved: resolved.pathname + resolved.search + resolved.hash,
          target: path.relative(siteDir, target).replace(/\\/g, '/'),
        });
      }
    }
  }
}

await fs.mkdir(path.dirname(reportPath), { recursive: true });
await fs.writeFile(
  reportPath,
  ['page,base,attr,value,resolved,target', ...missing.map(row => [
    row.page,
    row.base,
    row.attr,
    row.value,
    row.resolved,
    row.target,
  ].map(csvCell).join(','))].join('\n'),
  'utf8',
);

console.log(JSON.stringify({ total: missing.length, report: reportPath }, null, 2));
