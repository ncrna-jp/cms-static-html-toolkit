import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.mjs";

const OUT_DIR = config.siteDir;
let changed = 0;
let removed = 0;

async function walk(dir, files = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, files);
    else files.push(full);
  }
  return files;
}

for (const file of await walk(OUT_DIR)) {
  if (!file.toLowerCase().endsWith(".html")) continue;
  const before = await readFile(file, "utf8");
  let localRemoved = 0;
  const after = before.replace(/^\s*<link\b(?=[^>]*\brel=["']alternate["'])(?=[^>]*\btype=["']application\/(?:rss|atom)(?:\+xml|xml)["'])[^>]*>\s*\r?\n?/gim, () => {
    localRemoved += 1;
    return "";
  });
  if (after !== before) {
    await writeFile(file, after);
    changed += 1;
    removed += localRemoved;
  }
}

console.log({ changedFiles: changed, removedFeedAlternates: removed });
