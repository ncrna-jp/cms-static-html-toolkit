import fs from "node:fs";
import path from "node:path";

function readJson(file) {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function array(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) return value.split(",").map((item) => item.trim()).filter(Boolean);
  return fallback;
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const configPath = path.resolve(process.env.TOOLKIT_CONFIG || "toolkit.config.json");
const fileConfig = readJson(configPath);

const targetOriginValue = process.env.SITE_ORIGIN || fileConfig.targetOrigin || "";
const targetOrigin = targetOriginValue ? new URL(targetOriginValue) : null;

const internalHosts = new Set(array(process.env.INTERNAL_HOSTS, fileConfig.internalHosts || []));
if (targetOrigin) internalHosts.add(targetOrigin.hostname);

const canonicalHost = process.env.CANONICAL_HOST || fileConfig.canonicalHost || targetOrigin?.hostname || "";

export const config = {
  configPath,
  targetOrigin,
  targetOriginHref: targetOrigin?.href.replace(/\/$/, "") || "",
  startUrls: array(process.env.START_URLS, fileConfig.startUrls || ["/"]),
  internalHosts,
  canonicalHost,
  siteDir: path.resolve(process.env.SITE_DIR || fileConfig.siteDir || "site"),
  reportDir: path.resolve(process.env.REPORT_DIR || fileConfig.reportDir || "crawl-output"),
  localOrigin: process.env.LOCAL_ORIGIN || fileConfig.localOrigin || "http://127.0.0.1:8123",
  userAgent: process.env.USER_AGENT || fileConfig.userAgent || "cms-static-html-toolkit/1.0",
  maxPages: number(process.env.MAX_PAGES, fileConfig.maxPages ?? 8000),
  maxAssets: number(process.env.MAX_ASSETS, fileConfig.maxAssets ?? 20000),
  concurrency: number(process.env.CONCURRENCY, fileConfig.concurrency ?? 6),
  delayMs: number(process.env.DELAY_MS, fileConfig.delayMs ?? 120),
  internalAssetPrefixes: array(process.env.INTERNAL_ASSET_PREFIXES, fileConfig.internalAssetPrefixes || [
    "/images/",
    "/media/",
    "/modules/",
    "/templates/",
    "/components/",
    "/plugins/",
    "/libraries/",
    "/assets/",
    "/uploads/",
    "/files/",
  ]),
  skipPagePathPrefixes: array(process.env.SKIP_PAGE_PATH_PREFIXES, fileConfig.skipPagePathPrefixes || [
    "/administrator",
    "/admin",
    "/api/",
  ]),
  skipPagePathIncludes: array(process.env.SKIP_PAGE_PATH_INCLUDES, fileConfig.skipPagePathIncludes || [
    "/component/users",
    "/wp-admin",
    "/wp-login",
  ]),
  skipQueryParams: array(process.env.SKIP_QUERY_PARAMS, fileConfig.skipQueryParams || ["print"]),
  skipQueryParamValues: fileConfig.skipQueryParamValues || { format: ["feed"], tmpl: ["component"] },
  logoPath: process.env.LOGO_PATH || fileConfig.logoPath || "images/logo.png",
  logoSelectors: array(process.env.LOGO_SELECTORS, fileConfig.logoSelectors || []),
  breadcrumbCssPaths: array(process.env.BREADCRUMB_CSS_PATHS, fileConfig.breadcrumbCssPaths || []),
  preloadImagePaths: array(process.env.PRELOAD_IMAGE_PATHS, fileConfig.preloadImagePaths || []),
  requiredAssets: fileConfig.requiredAssets || [],
  redirectMappings: fileConfig.redirectMappings || {},
  copyIfMissing: fileConfig.copyIfMissing || [],
  bytePlaceholders: fileConfig.bytePlaceholders || [],
  keepUnreferencedPaths: array(process.env.KEEP_UNREFERENCED_PATHS, fileConfig.keepUnreferencedPaths || []),
  pathReplacements: fileConfig.pathReplacements || [],
  cdnReplacements: fileConfig.cdnReplacements || [],
  removeScriptSrcPatterns: array(undefined, fileConfig.removeScriptSrcPatterns || []),
  removeHtmlPatterns: array(undefined, fileConfig.removeHtmlPatterns || []),
  externalLiteralAllowPatterns: array(undefined, fileConfig.externalLiteralAllowPatterns || [
    "schema\\.org",
    "ogp\\.me",
    "w3\\.org",
    "gnu\\.org",
    "developer\\.mozilla",
  ]),
};

export function requireTargetOrigin() {
  if (!config.targetOrigin) {
    throw new Error(`Missing targetOrigin. Copy toolkit.config.example.json to toolkit.config.json and set targetOrigin, or set SITE_ORIGIN.`);
  }
  return config.targetOrigin;
}

export function isInternalUrl(url) {
  return config.internalHosts.has(url.hostname);
}

export function canonicalizeUrl(url) {
  const copy = new URL(url.href);
  if (config.canonicalHost) copy.hostname = config.canonicalHost;
  if (config.targetOrigin) copy.protocol = config.targetOrigin.protocol;
  if (copy.pathname !== "/" && copy.pathname.endsWith("//")) {
    copy.pathname = copy.pathname.replace(/\/+$/, "/");
  }
  return copy.href;
}

export function toTargetAbsolute(pathOrUrl) {
  const origin = requireTargetOrigin();
  return new URL(pathOrUrl, origin.href).href;
}

export function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function internalUrlPattern() {
  const hosts = [...config.internalHosts].map(escapeRegex);
  if (!hosts.length) return null;
  return new RegExp(`^(?:https?:)?//(?:${hosts.join("|")})(?::[0-9]+)?(?:/|$)`, "i");
}

export function internalAssetUrlPattern() {
  const hosts = [...config.internalHosts].map(escapeRegex);
  if (!hosts.length) return null;
  const prefixes = config.internalAssetPrefixes.map((prefix) => escapeRegex(prefix.replace(/^\/?/, "/")));
  if (!prefixes.length) return null;
  return new RegExp(`https?://(?:${hosts.join("|")})(?:${prefixes.join("|")})[^"'<>\\s)]+`, "gi");
}
