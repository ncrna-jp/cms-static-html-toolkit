import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalizeUrl, config, isInternalUrl, requireTargetOrigin } from "./config.mjs";

const SITE_ORIGIN = requireTargetOrigin().href;
const START_URLS = config.startUrls;
const OUT_DIR = config.siteDir;
const REPORT_DIR = config.reportDir;
const MAX_PAGES = config.maxPages;
const MAX_ASSETS = config.maxAssets;
const CONCURRENCY = config.concurrency;
const DELAY_MS = config.delayMs;

const pageQueue = [];
const assetQueue = [];
const seenPages = new Set();
const seenAssets = new Set();
const savedPages = new Map();
const savedAssets = new Map();
const failures = [];
const externalLinks = new Set();
const queryPages = new Map();

const htmlExtensions = new Set(["", ".html", ".htm", ".php"]);
const assetExtensions = new Set([
  ".css", ".js", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".zip",
  ".woff", ".woff2", ".ttf", ".eot", ".mp4", ".mov", ".avi", ".mp3",
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha(input, len = 12) {
  return createHash("sha1").update(input).digest("hex").slice(0, len);
}

function normalizeUrl(raw, base = SITE_ORIGIN) {
  if (!raw || raw.startsWith("#")) return null;
  const trimmed = raw.trim().replace(/&amp;/gi, "&");
  if (/^(mailto|tel|javascript|data|blob):/i.test(trimmed)) return null;

  try {
    const url = new URL(trimmed, base);
    url.hash = "";
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

function isInternal(url) {
  return isInternalUrl(url);
}

function canonical(url) {
  return canonicalizeUrl(url);
}

function shouldSkipPage(url) {
  const p = url.pathname.toLowerCase();
  return (
    config.skipPagePathPrefixes.some((prefix) => p.startsWith(prefix.toLowerCase())) ||
    config.skipPagePathIncludes.some((part) => p.includes(part.toLowerCase())) ||
    config.skipQueryParams.some((param) => url.searchParams.has(param)) ||
    Object.entries(config.skipQueryParamValues).some(([param, values]) => values.includes(url.searchParams.get(param)))
  );
}

function extensionOf(url) {
  return path.posix.extname(decodeURIComponent(url.pathname.split("/").pop() || ""));
}

function looksLikeAsset(url) {
  const ext = extensionOf(url).toLowerCase();
  const p = url.pathname.toLowerCase();
  return assetExtensions.has(ext) || p.includes("/download/") || p.endsWith("/typography2.php");
}

function enqueuePage(url) {
  if (!isInternal(url) || shouldSkipPage(url)) return;
  const key = canonical(url);
  if (seenPages.has(key) || seenPages.size >= MAX_PAGES) return;
  seenPages.add(key);
  pageQueue.push(new URL(key));
}

function enqueueAsset(url) {
  if (!isInternal(url)) {
    externalLinks.add(url.href);
    return;
  }
  const key = canonical(url);
  if (seenAssets.has(key) || seenAssets.size >= MAX_ASSETS) return;
  seenAssets.add(key);
  assetQueue.push(new URL(key));
}

function cleanPathSegment(segment) {
  return segment.replace(/[<>:"\\|?*\x00-\x1f]/g, "_");
}

function htmlOutputPath(url) {
  if (url.search) {
    const key = canonical(url);
    const file = `${sha(key)}.html`;
    queryPages.set(key, `/__query/${file}`);
    return path.join(OUT_DIR, "__query", file);
  }

  let pathname = decodeURIComponent(url.pathname);
  pathname = pathname.split("/").map(cleanPathSegment).join("/");
  if (pathname === "/" || pathname === "") return path.join(OUT_DIR, "index.html");

  const ext = path.posix.extname(pathname).toLowerCase();
  if (ext === ".html" || ext === ".htm") return path.join(OUT_DIR, pathname);
  if (pathname.endsWith("/")) return path.join(OUT_DIR, pathname, "index.html");
  return path.join(OUT_DIR, pathname, "index.html");
}

function assetOutputPath(url) {
  let pathname = decodeURIComponent(url.pathname);
  pathname = pathname.split("/").map(cleanPathSegment).join("/");
  if (pathname === "/" || pathname === "") pathname = `/download-${sha(canonical(url))}`;
  if (pathname.endsWith("/") || !path.posix.extname(pathname)) {
    pathname = path.posix.join(pathname, `download-${sha(canonical(url))}.bin`);
  }

  if (url.search) {
    const ext = path.posix.extname(pathname);
    const base = pathname.slice(0, ext ? -ext.length : undefined);
    pathname = `${base}.${sha(canonical(url), 8)}${ext || ".bin"}`;
  }

  return path.join(OUT_DIR, pathname);
}

function relativeRef(targetFile, fromFile) {
  const rel = path.relative(path.dirname(fromFile), targetFile).replace(/\\/g, "/");
  return rel || path.basename(targetFile);
}

function staticUrlForPage(url, fromFile) {
  const out = htmlOutputPath(url);
  if (fromFile) return relativeRef(out, fromFile);

  if (url.search) {
    const key = canonical(url);
    if (!queryPages.has(key)) queryPages.set(key, `/__query/${sha(key)}.html`);
    return queryPages.get(key);
  }

  let pathname = url.pathname;
  if (pathname === "" || pathname === "/") return "/";
  const ext = path.posix.extname(pathname).toLowerCase();
  if (ext === ".html" || ext === ".htm") return pathname;
  if (pathname.endsWith("/")) return pathname;
  return `${pathname}/`;
}

function staticUrlForAsset(url, fromFile) {
  const out = assetOutputPath(url);
  if (fromFile) return relativeRef(out, fromFile);
  return `/${path.relative(OUT_DIR, out).replace(/\\/g, "/")}`;
}

function classifyReference(url) {
  if (!isInternal(url)) return "external";
  if (looksLikeAsset(url)) return "asset";
  const ext = extensionOf(url).toLowerCase();
  if (htmlExtensions.has(ext)) return "page";
  return "page";
}

function rewriteCssUrls(css, baseUrl, fromFile) {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, quote, raw) => {
    const url = normalizeUrl(raw, baseUrl);
    if (!url) return match;
    if (!isInternal(url)) {
      externalLinks.add(url.href);
      return match;
    }
    enqueueAsset(url);
    return `url(${quote || ""}${staticUrlForAsset(url, fromFile)}${quote || ""})`;
  }).replace(/@import\s+(['"])([^'"]+)\1/gi, (match, quote, raw) => {
    const url = normalizeUrl(raw, baseUrl);
    if (!url) return match;
    if (!isInternal(url)) {
      externalLinks.add(url.href);
      return match;
    }
    enqueueAsset(url);
    return `@import ${quote}${staticUrlForAsset(url, fromFile)}${quote}`;
  });
}

function rewriteSrcset(value, baseUrl, fromFile) {
  return value.split(",").map((candidate) => {
    const parts = candidate.trim().split(/\s+/);
    if (!parts[0]) return candidate;
    const url = normalizeUrl(parts[0], baseUrl);
    if (!url) return candidate;
    if (!isInternal(url)) {
      externalLinks.add(url.href);
      return candidate.trim();
    }
    enqueueAsset(url);
    parts[0] = staticUrlForAsset(url, fromFile);
    return parts.join(" ");
  }).join(", ");
}

function rewriteHtml(html, baseUrl, fromFile) {
  let output = html;

  output = output.replace(/\s(srcset)=("([^"]*)"|'([^']*)')/gi, (match, attr, quoted, dbl, sgl) => {
    const quote = quoted[0];
    const value = dbl ?? sgl ?? "";
    return ` ${attr}=${quote}${rewriteSrcset(value, baseUrl, fromFile)}${quote}`;
  });

  output = output.replace(/\s(href|src|action|poster)=("([^"]*)"|'([^']*)')/gi, (match, attr, quoted, dbl, sgl) => {
    const quote = quoted[0];
    const value = dbl ?? sgl ?? "";
    const decodedValue = value.replace(/&amp;/gi, "&");
    const malformedExternal = decodedValue.match(/^\/\s*(https?:\/\/.+)$/i);
    if (malformedExternal) {
      externalLinks.add(malformedExternal[1]);
      return ` ${attr}=${quote}${malformedExternal[1]}${quote}`;
    }
    const url = normalizeUrl(decodedValue, baseUrl);
    if (!url) return match;

    if (!isInternal(url)) {
      externalLinks.add(url.href);
      return match;
    }

    if (url.searchParams.get("format") === "feed") {
      return ` ${attr}=${quote}#${quote}`;
    }

    const kind = classifyReference(url);
    if (kind === "asset") {
      enqueueAsset(url);
      return ` ${attr}=${quote}${staticUrlForAsset(url, fromFile)}${quote}`;
    }

    enqueuePage(url);
    return ` ${attr}=${quote}${staticUrlForPage(url, fromFile)}${quote}`;
  });

  output = output.replace(/style=("([^"]*)"|'([^']*)')/gi, (match, quoted, dbl, sgl) => {
    const quote = quoted[0];
    const value = dbl ?? sgl ?? "";
    return `style=${quote}${rewriteCssUrls(value, baseUrl, fromFile)}${quote}`;
  });

  return output;
}

async function fetchWithTimeout(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
        signal: controller.signal,
        headers: {
        "User-Agent": config.userAgent,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function saveFile(filePath, bytesOrText) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytesOrText);
}

async function crawlPage(url) {
  const key = canonical(url);
  try {
    await sleep(DELAY_MS);
    const res = await fetchWithTimeout(url.href);
    const finalUrl = new URL(res.url);
    if (!isInternal(finalUrl)) {
      externalLinks.add(finalUrl.href);
      const out = htmlOutputPath(url);
      const html = `<!doctype html>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=${finalUrl.href}">
<title>Redirect</title>
<p><a href="${finalUrl.href}">${finalUrl.href}</a></p>
`;
      await saveFile(out, html);
      savedPages.set(key, out);
      return;
    }
    const type = res.headers.get("content-type") || "";
    if (!res.ok) {
      failures.push({ url: key, status: res.status, type: "page" });
      return;
    }

    if (!type.includes("text/html") && !type.includes("application/xhtml")) {
      enqueueAsset(url);
      return;
    }

    const out = htmlOutputPath(url);
    const html = await res.text();
    const rewritten = rewriteHtml(html, url.href, out);
    await saveFile(out, rewritten);
    savedPages.set(key, out);
  } catch (error) {
    failures.push({ url: key, status: error.name || "ERROR", type: "page", message: error.message });
  }
}

async function crawlAsset(url) {
  const key = canonical(url);
  try {
    await sleep(DELAY_MS);
    const res = await fetchWithTimeout(url.href);
    const finalUrl = new URL(res.url);
    if (!isInternal(finalUrl)) {
      externalLinks.add(finalUrl.href);
      failures.push({ url: key, status: "external-redirect", type: "asset", message: finalUrl.href });
      return;
    }
    if (!res.ok) {
      failures.push({ url: key, status: res.status, type: "asset" });
      return;
    }

    const type = res.headers.get("content-type") || "";
    let body;
    if (type.includes("text/css")) {
      body = rewriteCssUrls(await res.text(), url.href, assetOutputPath(url));
    } else {
      body = Buffer.from(await res.arrayBuffer());
    }

    const out = assetOutputPath(url);
    await saveFile(out, body);
    savedAssets.set(key, out);
  } catch (error) {
    failures.push({ url: key, status: error.name || "ERROR", type: "asset", message: error.message });
  }
}

async function worker() {
  while (pageQueue.length || assetQueue.length) {
    const page = pageQueue.shift();
    if (page) {
      await crawlPage(page);
      continue;
    }

    const asset = assetQueue.shift();
    if (asset) await crawlAsset(asset);
  }
}

async function writeReports() {
  await mkdir(REPORT_DIR, { recursive: true });

  const pageRows = [["url", "file"], ...[...savedPages.entries()].map(([url, file]) => [url, path.relative(process.cwd(), file)])];
  const assetRows = [["url", "file"], ...[...savedAssets.entries()].map(([url, file]) => [url, path.relative(process.cwd(), file)])];
  const failRows = [["type", "status", "url", "message"], ...failures.map((f) => [f.type, f.status, f.url, f.message || ""])];
  const externalRows = [["url"], ...[...externalLinks].sort().map((url) => [url])];
  const queryRows = [["source_url", "static_url"], ...[...queryPages.entries()].map(([url, staticUrl]) => [url, staticUrl])];

  const csv = (rows) => rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
  await saveFile(path.join(REPORT_DIR, "pages.csv"), csv(pageRows));
  await saveFile(path.join(REPORT_DIR, "assets.csv"), csv(assetRows));
  await saveFile(path.join(REPORT_DIR, "failures.csv"), csv(failRows));
  await saveFile(path.join(REPORT_DIR, "external-links.csv"), csv(externalRows));
  await saveFile(path.join(REPORT_DIR, "query-pages.csv"), csv(queryRows));

  const htaccess = [
    "DirectoryIndex index.html",
    "RewriteEngine On",
    "",
    "# Serve extensionless CMS URLs from generated directory indexes.",
    "RewriteCond %{REQUEST_FILENAME} !-f",
    "RewriteCond %{REQUEST_FILENAME} !-d",
    "RewriteCond %{DOCUMENT_ROOT}%{REQUEST_URI}/index.html -f",
    "RewriteRule ^(.+[^/])$ $1/ [R=301,L]",
    "",
    "# Keep ordinary static files cacheable.",
    "<IfModule mod_expires.c>",
    "  ExpiresActive On",
    "  ExpiresByType image/jpeg \"access plus 1 year\"",
    "  ExpiresByType image/png \"access plus 1 year\"",
    "  ExpiresByType image/gif \"access plus 1 year\"",
    "  ExpiresByType image/svg+xml \"access plus 1 year\"",
    "  ExpiresByType text/css \"access plus 1 month\"",
    "  ExpiresByType application/javascript \"access plus 1 month\"",
    "</IfModule>",
    "",
  ].join("\n");
  await saveFile(path.join(OUT_DIR, ".htaccess"), htaccess);

  const summary = {
    savedPages: savedPages.size,
    savedAssets: savedAssets.size,
    failures: failures.length,
    externalLinks: externalLinks.size,
    queryPages: queryPages.size,
    outDir: OUT_DIR,
    reportDir: REPORT_DIR,
  };
  await saveFile(path.join(REPORT_DIR, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(summary);
}

for (const start of START_URLS) enqueuePage(normalizeUrl(start));

while (pageQueue.length || assetQueue.length) {
  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);
}

await writeReports();
