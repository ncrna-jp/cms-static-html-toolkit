import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { config, toTargetAbsolute } from "./config.mjs";

const OUT_DIR = config.siteDir;

async function exists(file) {
  try {
    const s = await stat(file);
    return s.isFile();
  } catch {
    return false;
  }
}

async function ensureDir(file) {
  await mkdir(path.dirname(file), { recursive: true });
}

async function fetchAsset(item) {
  const localPath = typeof item === "string" ? item : item.path;
  const source = typeof item === "string" ? toTargetAbsolute(localPath) : (item.url || toTargetAbsolute(localPath));
  const out = path.join(OUT_DIR, localPath);
  if (await exists(out)) return false;
  const res = await fetch(source);
  if (!res.ok) throw new Error(`${res.status} ${source}`);
  await ensureDir(out);
  await writeFile(out, Buffer.from(await res.arrayBuffer()));
  return true;
}

async function writeRedirect(localPath, target) {
  const out = path.join(OUT_DIR, localPath);
  await ensureDir(out);
  await writeFile(out, `<!doctype html>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=${target}">
<title>Redirect</title>
<p><a href="${target}">${target}</a></p>
`);
}

async function writeBytes(item) {
  const out = path.join(OUT_DIR, item.path);
  if (await exists(out)) return false;
  await ensureDir(out);
  await writeFile(out, Buffer.from(item.base64, "base64"));
  return true;
}

async function walk(dir, files = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, files);
    else files.push(full);
  }
  return files;
}

function relativeToSiteFile(targetSitePath, fromFile) {
  return path.relative(path.dirname(fromFile), path.join(OUT_DIR, targetSitePath)).replace(/\\/g, "/");
}

let fetchedAssets = 0;
for (const item of config.requiredAssets) {
  if (await fetchAsset(item)) fetchedAssets += 1;
}

let copiedFiles = 0;
for (const item of config.copyIfMissing) {
  const from = path.join(OUT_DIR, item.from);
  const to = path.join(OUT_DIR, item.to);
  if (!(await exists(to)) && await exists(from)) {
    await ensureDir(to);
    await copyFile(from, to);
    copiedFiles += 1;
  }
}

let placeholders = 0;
for (const item of config.bytePlaceholders) {
  if (await writeBytes(item)) placeholders += 1;
}

let redirects = 0;
for (const [localPath, target] of Object.entries(config.redirectMappings)) {
  await writeRedirect(localPath, target);
  redirects += 1;
}

let changedHtmlFiles = 0;
for (const file of await walk(OUT_DIR)) {
  if (!file.toLowerCase().endsWith(".html")) continue;
  let text = await readFile(file, "utf8");
  const original = text;

  for (const item of config.pathReplacements) {
    const replacement = item.sitePath ? relativeToSiteFile(item.sitePath, file) : item.replacement;
    text = text.replace(new RegExp(item.pattern, item.flags || "g"), replacement);
  }

  if (text !== original) {
    await writeFile(file, text);
    changedHtmlFiles += 1;
  }
}

console.log({ fetchedAssets, copiedFiles, placeholders, redirects, changedHtmlFiles });
