import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.mjs";

const OUT_DIR = config.siteDir;
const REPORT_DIR = config.reportDir;
const missing = [];
const checked = new Set();

function isIgnored(raw) {
  return (
    !raw ||
    raw.startsWith("#") ||
    /^(mailto|tel|javascript|data|blob|ftp):/i.test(raw.trim()) ||
    /^https?:\/\//i.test(raw.trim()) ||
    raw.startsWith("//")
  );
}

async function exists(file) {
  try {
    const s = await stat(file);
    return s.isFile();
  } catch {
    return false;
  }
}

function fileToUrl(file) {
  const rel = path.relative(OUT_DIR, file).replace(/\\/g, "/");
  if (rel === "index.html") return "/";
  if (rel.endsWith("/index.html")) return `/${rel.slice(0, -"index.html".length)}`;
  return `/${rel}`;
}

function resolveRef(raw, baseFile) {
  const clean = raw.trim().replace(/&amp;/g, "&").split("#")[0];
  if (isIgnored(clean)) return null;
  const baseUrl = fileToUrl(baseFile);
  const resolved = new URL(clean, `https://static.local${baseUrl}`).pathname;
  return decodeURIComponent(resolved);
}

async function urlExists(urlPath) {
  if (checked.has(urlPath)) return true;
  checked.add(urlPath);

  const trimmed = urlPath.replace(/^\/+/, "");
  const direct = path.join(OUT_DIR, trimmed);
  const index = path.join(OUT_DIR, trimmed, "index.html");
  const slashIndex = path.join(OUT_DIR, trimmed.replace(/\/$/, ""), "index.html");

  return await exists(direct) || await exists(index) || await exists(slashIndex);
}

async function walk(dir, files = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, files);
    else files.push(full);
  }
  return files;
}

function htmlRefs(text) {
  const refs = [];
  const attrRe = /\s(?:href|src|action|poster)=("([^"]*)"|'([^']*)')/gi;
  let m;
  while ((m = attrRe.exec(text))) refs.push(m[2] ?? m[3] ?? "");

  const srcsetRe = /\ssrcset=("([^"]*)"|'([^']*)')/gi;
  while ((m = srcsetRe.exec(text))) {
    const value = m[2] ?? m[3] ?? "";
    for (const candidate of value.split(",")) {
      const first = candidate.trim().split(/\s+/)[0];
      if (first) refs.push(first);
    }
  }

  const styleUrlRe = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  while ((m = styleUrlRe.exec(text))) refs.push(m[2] ?? "");
  return refs;
}

function cssRefs(text) {
  const refs = [];
  const urlRe = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  let m;
  while ((m = urlRe.exec(text))) refs.push(m[2] ?? "");
  const importRe = /@import\s+(?:url\()?["']([^"')]+)["']\)?/gi;
  while ((m = importRe.exec(text))) refs.push(m[1] ?? "");
  return refs;
}

for (const file of await walk(OUT_DIR)) {
  const lower = file.toLowerCase();
  if (!lower.endsWith(".html") && !lower.endsWith(".css")) continue;

  const text = await readFile(file, "utf8");
  const refs = lower.endsWith(".css") ? cssRefs(text) : htmlRefs(text);
  for (const ref of refs) {
    const urlPath = resolveRef(ref, file);
    if (!urlPath) continue;
    if (!(await urlExists(urlPath))) {
      missing.push({
        file: path.relative(process.cwd(), file),
        ref,
        resolved: urlPath,
      });
    }
  }
}

await mkdir(REPORT_DIR, { recursive: true });
const rows = [["file", "ref", "resolved"], ...missing.map((m) => [m.file, m.ref, m.resolved])];
const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
await writeFile(path.join(REPORT_DIR, "missing-local-links.csv"), csv);
console.log({ missingLocalLinks: missing.length, report: path.join(REPORT_DIR, "missing-local-links.csv") });
