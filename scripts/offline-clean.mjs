import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.mjs";

const OUT_DIR = config.siteDir;

async function ensureDir(file) {
  await mkdir(path.dirname(file), { recursive: true });
}

async function writeText(sitePath, text) {
  const file = path.join(OUT_DIR, sitePath);
  await ensureDir(file);
  await writeFile(file, text);
}

async function fetchBinary(url, sitePath) {
  const file = path.join(OUT_DIR, sitePath);
  await ensureDir(file);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
}

async function walk(dir, files = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, files);
    else files.push(full);
  }
  return files;
}

function rel(sitePath, fromFile) {
  return path.relative(path.dirname(fromFile), path.join(OUT_DIR, sitePath)).replace(/\\/g, "/");
}

let localFilesWritten = 0;
let localFilesFetched = 0;
for (const item of config.cdnReplacements) {
  if (typeof item.localText === "string") {
    await writeText(item.localPath, item.localText);
    localFilesWritten += 1;
  } else if (item.url && item.localPath) {
    await fetchBinary(item.url, item.localPath);
    localFilesFetched += 1;
  }
}

let changedHtmlFiles = 0;
let removedScripts = 0;
for (const file of await walk(OUT_DIR)) {
  if (!file.toLowerCase().endsWith(".html")) continue;
  let text = await readFile(file, "utf8");
  const original = text;

  for (const item of config.cdnReplacements) {
    if (!item.pattern || !item.localPath) continue;
    text = text.replace(new RegExp(item.pattern, item.flags || "g"), rel(item.localPath, file));
  }

  for (const pattern of config.removeScriptSrcPatterns) {
    const re = new RegExp(`<script\\b[^>]*src=["'](?:${pattern})["'][^>]*>\\s*</script>`, "gi");
    text = text.replace(re, () => {
      removedScripts += 1;
      return "";
    });
  }

  if (text !== original) {
    await writeFile(file, text);
    changedHtmlFiles += 1;
  }
}

console.log({ changedHtmlFiles, localFilesWritten, localFilesFetched, removedScripts });
