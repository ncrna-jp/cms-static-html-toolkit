import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { config, internalAssetUrlPattern, internalUrlPattern } from "./config.mjs";

const OUT_DIR = config.siteDir;
const REPORT_DIR = config.reportDir;
const rows = [];
const checkedPaths = new Map();
const internalRe = internalUrlPattern();
const liveAssetRe = internalAssetUrlPattern();

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
    const s = await stat(file);
    return s.isFile();
  } catch {
    return false;
  }
}

function rel(file) {
  return path.relative(process.cwd(), file).replace(/\\/g, "/");
}

function add(file, kind, severity, value, detail = "") {
  rows.push([rel(file), kind, severity, value, detail]);
}

function isExternalAllowed(url) {
  return /^(mailto|tel|javascript|data|blob|ftp):/i.test(url) || (/^(?:https?:)?\/\//i.test(url) && !(internalRe?.test(url)));
}

function fileToUrl(file) {
  const r = path.relative(OUT_DIR, file).replace(/\\/g, "/");
  if (r === "index.html") return "/";
  if (r.endsWith("/index.html")) return `/${r.slice(0, -"index.html".length)}`;
  return `/${r}`;
}

function normalizeInternal(raw, file) {
  let value = raw.trim().replace(/&amp;/g, "&");
  if (!value || value.startsWith("#") || isExternalAllowed(value)) return null;

  value = value.split("#")[0];
  if (internalRe?.test(value) && /^https?:\/\//i.test(value)) {
    value = new URL(value).pathname + new URL(value).search;
  } else if (internalRe?.test(value) && /^\/\//.test(value)) {
    value = new URL(`https:${value}`).pathname + new URL(`https:${value}`).search;
  }

  if (!value || value.startsWith("#")) return null;
  const baseUrl = fileToUrl(file);
  const u = new URL(value, `https://static.local${baseUrl}`);
  return decodeURIComponent(u.pathname);
}

async function localPathExists(urlPath) {
  if (checkedPaths.has(urlPath)) return checkedPaths.get(urlPath);
  const trimmed = urlPath.replace(/^\/+/, "");
  const candidates = [
    path.join(OUT_DIR, trimmed),
    path.join(OUT_DIR, trimmed, "index.html"),
    path.join(OUT_DIR, trimmed.replace(/\/$/, ""), "index.html"),
  ];
  const ok = await Promise.any(candidates.map((p) => exists(p).then((yes) => yes ? true : Promise.reject()))).catch(() => false);
  checkedPaths.set(urlPath, ok);
  return ok;
}

function attrs(text, names) {
  const out = [];
  const re = new RegExp(`\\s(${names.join("|")})=("[^"]*"|'[^']*')`, "gi");
  let m;
  while ((m = re.exec(text))) out.push({ name: m[1].toLowerCase(), value: m[2].slice(1, -1) });
  return out;
}

for (const file of await walk(OUT_DIR)) {
  const lower = file.toLowerCase();
  if (!lower.endsWith(".html") && !lower.endsWith(".css") && !lower.endsWith(".js")) continue;
  const text = await readFile(file, "utf8");

  if (lower.endsWith(".html")) {
    for (const { name, value } of attrs(text, ["href", "src", "action", "poster", "data-src", "data-background"])) {
      const isInternalLive = Boolean(internalRe?.test(value));
      if (isInternalLive && name !== "href") add(file, "live-internal-resource", "high", value, name);
      if (isInternalLive && name === "href") add(file, "live-internal-anchor", "medium", value, name);
      if (name === "action" && isInternalLive) add(file, "live-internal-form-action", "high", value, name);

      const local = normalizeInternal(value, file);
      if (local && !(await localPathExists(local))) add(file, "missing-local-reference", "high", value, `${name} -> ${local}`);
    }

    const srcsetRe = /\ssrcset=("([^"]*)"|'([^']*)')/gi;
    let m;
    while ((m = srcsetRe.exec(text))) {
      for (const candidate of (m[2] ?? m[3] ?? "").split(",")) {
        const value = candidate.trim().split(/\s+/)[0];
        if (!value) continue;
        const local = normalizeInternal(value, file);
        if (local && !(await localPathExists(local))) add(file, "missing-local-srcset", "high", value, local);
      }
    }

    const refreshRe = /<meta\b[^>]*http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"';>]+)[^"']*["'][^>]*>/gi;
    while ((m = refreshRe.exec(text))) {
      const value = m[1].trim();
      const isInternalLive = Boolean(internalRe?.test(value));
      if (isInternalLive) add(file, "live-internal-refresh", "high", value);
    }
  }

  if (lower.endsWith(".html") || lower.endsWith(".css")) {
    const cssUrlRe = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
    let m;
    while ((m = cssUrlRe.exec(text))) {
      const value = m[2].trim();
      const local = normalizeInternal(value, file);
      if (local && !(await localPathExists(local))) add(file, "missing-css-url", "high", value, local);
    }
  }

  let m;
  if (liveAssetRe) {
    liveAssetRe.lastIndex = 0;
    while ((m = liveAssetRe.exec(text))) add(file, "live-internal-asset-literal", "medium", m[0]);
  }
}

await mkdir(REPORT_DIR, { recursive: true });
const csvRows = [["file", "kind", "severity", "value", "detail"], ...rows];
const csv = csvRows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
await writeFile(path.join(REPORT_DIR, "static-integrity.csv"), csv);

const summary = rows.reduce((acc, [, kind, severity]) => {
  acc.total += 1;
  acc.byKind[kind] = (acc.byKind[kind] ?? 0) + 1;
  acc.bySeverity[severity] = (acc.bySeverity[severity] ?? 0) + 1;
  return acc;
}, { total: 0, byKind: {}, bySeverity: {} });

console.log({ ...summary, report: path.join(REPORT_DIR, "static-integrity.csv") });
