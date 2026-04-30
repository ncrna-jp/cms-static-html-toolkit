import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { config, internalAssetUrlPattern, isInternalUrl } from "./config.mjs";

const OUT_DIR = config.siteDir;
const internalAssetRe = internalAssetUrlPattern();

function sha(value, len = 12) {
  return createHash("sha1").update(value).digest("hex").slice(0, len);
}

async function walk(dir, files = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, files);
    else files.push(full);
  }
  return files;
}

async function ensureDir(file) {
  await mkdir(path.dirname(file), { recursive: true });
}

function rel(sitePath, fromFile) {
  return path.relative(path.dirname(fromFile), path.join(OUT_DIR, sitePath)).replace(/\\/g, "/");
}

function extensionFrom(url, contentType = "") {
  const pathname = new URL(url).pathname;
  const ext = path.posix.extname(pathname).toLowerCase();
  if (ext && ext.length <= 6) return ext;
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return ".jpg";
  if (contentType.includes("gif")) return ".gif";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("svg")) return ".svg";
  return ".bin";
}

async function download(url, preferredSitePath = null) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const type = res.headers.get("content-type") || "";
  const sitePath = preferredSitePath || `external-assets/${sha(url)}${extensionFrom(url, type)}`;
  const file = path.join(OUT_DIR, sitePath);
  await ensureDir(file);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  return sitePath;
}

async function localizeInternalAsset(url) {
  const parsed = new URL(url);
  const sitePath = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  await download(url, sitePath);
  return sitePath;
}

async function localizeExternalImage(url) {
  return await download(url);
}

function externalEmbedLink(url) {
  const href = url.replace(/&amp;/g, "&");
  return `<p class="external-embed-link"><a href="${href}" target="_blank" rel="noopener">外部メディアを開く</a></p>`;
}

let changedFiles = 0;
let downloaded = 0;
let embedLinks = 0;
let recaptchaRemoved = 0;

for (const file of await walk(OUT_DIR)) {
  if (!file.toLowerCase().endsWith(".html")) continue;
  let text = await readFile(file, "utf8");
  const original = text;

  for (const pattern of config.removeHtmlPatterns) {
    const re = new RegExp(pattern, "gi");
    text = text.replace(re, () => {
      recaptchaRemoved += 1;
      return "";
    });
  }

  text = text.replace(/<iframe\b[^>]*src=["']([^"']+)["'][^>]*>\s*<\/iframe>/gi, (match, src) => {
    if (!/^https?:\/\//i.test(src)) return match;
    embedLinks += 1;
    return externalEmbedLink(src);
  });

  const replacements = [];
  let m;
  if (internalAssetRe) {
    internalAssetRe.lastIndex = 0;
    while ((m = internalAssetRe.exec(text))) {
      replacements.push({ from: m[0], localize: () => localizeInternalAsset(m[0]) });
    }
  }

  const imageAttr = /(<img\b[^>]*\bsrc=["'])(https?:\/\/[^"']+)(["'][^>]*>)/gi;
  while ((m = imageAttr.exec(text))) {
    const src = m[2].replace(/&amp;/g, "&");
    if (isInternalUrl(new URL(src))) continue;
    replacements.push({ from: m[2], localize: () => localizeExternalImage(src) });
  }

  for (const item of replacements) {
    try {
      const sitePath = await item.localize();
      const replacement = rel(sitePath, file);
      text = text.split(item.from).join(replacement);
      downloaded += 1;
    } catch {
      // Preserve the link target but prevent the browser from blocking on image loads.
      text = text.split(item.from).join("images/placeholder.png");
    }
  }

  if (text !== original) {
    await writeFile(file, text);
    changedFiles += 1;
  }
}

console.log({ changedFiles, downloaded, embedLinks, recaptchaRemoved });
