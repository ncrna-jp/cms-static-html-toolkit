import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config, internalAssetUrlPattern } from "./config.mjs";

const OUT_DIR = config.siteDir;
const REPORT_DIR = config.reportDir;
const rows = [];
const liveAssetRe = internalAssetUrlPattern();

async function walk(dir, files = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, files);
    else files.push(full);
  }
  return files;
}

function push(file, kind, value) {
  if (/^\s*data:/i.test(value)) return;
  rows.push([path.relative(process.cwd(), file), kind, value]);
}

for (const file of await walk(OUT_DIR)) {
  const lower = file.toLowerCase();
  if (!lower.endsWith(".html") && !lower.endsWith(".css") && !lower.endsWith(".js")) continue;
  const text = await readFile(file, "utf8");

  if (lower.endsWith(".html")) {
    const resourceAttr = /\s(?:src|srcset|poster|data-src|data-background)=["']([^"']*(?:https?:)?\/\/[^"']+)["']/gi;
    let m;
    while ((m = resourceAttr.exec(text))) push(file, "html-resource-attr", m[1]);

    const linkTag = /<link\b[^>]*href=["']([^"']*(?:https?:)?\/\/[^"']+)["'][^>]*>/gi;
    while ((m = linkTag.exec(text))) {
      const tag = m[0];
      if (/\brel=["']?(?:stylesheet|preload|modulepreload|icon|shortcut icon|apple-touch-icon|manifest|preconnect|dns-prefetch)/i.test(tag)) {
        push(file, "html-link-resource", m[1]);
      }
    }

    const scriptTag = /<script\b[^>]*src=["']([^"']*(?:https?:)?\/\/[^"']+)["'][^>]*>/gi;
    while ((m = scriptTag.exec(text))) push(file, "html-script-resource", m[1]);
  }

  const cssUrl = /url\(\s*["']?((?:https?:)?\/\/[^"')\s]+)["']?\s*\)/gi;
  let m;
  while ((m = cssUrl.exec(text))) push(file, "css-url", m[1]);

  const importUrl = /@import\s+(?:url\()?["']((?:https?:)?\/\/[^"']+)["']\)?/gi;
  while ((m = importUrl.exec(text))) push(file, "css-import", m[1]);

  if (liveAssetRe) {
    liveAssetRe.lastIndex = 0;
    while ((m = liveAssetRe.exec(text))) push(file, "internal-asset-literal", m[0]);
  }
}

await mkdir(REPORT_DIR, { recursive: true });
const csvRows = [["file", "kind", "url"], ...rows];
const csv = csvRows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
await writeFile(path.join(REPORT_DIR, "remote-resources.csv"), csv);
console.log({ remoteResources: rows.length, report: path.join(REPORT_DIR, "remote-resources.csv") });
