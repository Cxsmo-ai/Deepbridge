import { nanoid } from "nanoid";
import { request } from "undici";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { MediaRequest } from "../deepbrid/apiClient";
import { makeMediaKey } from "../core/mediaKey";
import { parseRelease } from "../core/parseRelease";
import { MediaMetadata, normalizeComparableTitle, scoreReleaseMatch } from "../core/releaseMatch";
import { SourceCandidate } from "../core/types";

const NEXUS_BASE_URL = "https://nexus.miatrix.com";
const DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

type NexusStats = {
  startedAt: string;
  finishedAt: string;
  configured: boolean;
  mediaKey: string;
  searchMode: string;
  plannedSearches: number;
  fulfilledSearches: number;
  failedSearches: number;
  detailPages: number;
  matchedDetailPages: number;
  browserEpisodePages: number;
  rawItems: number;
  dedupedItems: number;
  filteredItems: number;
  selectedItems: number;
  candidates: number;
  nzbDownloads: number;
  errors: Record<string, number>;
};

type NexusSearchResult = {
  releaseHash: string;
  nzbHash: string;
  title: string;
  sizeBytes?: number;
  category?: string;
  posted?: string;
  grabs?: number;
};

let lastNexusStats: NexusStats = {
  startedAt: "",
  finishedAt: "",
  configured: false,
  mediaKey: "",
  searchMode: "",
  plannedSearches: 0,
  fulfilledSearches: 0,
  failedSearches: 0,
  detailPages: 0,
  matchedDetailPages: 0,
  browserEpisodePages: 0,
  rawItems: 0,
  dedupedItems: 0,
  filteredItems: 0,
  selectedItems: 0,
  candidates: 0,
  nzbDownloads: 0,
  errors: {}
};

export function getLastNexusMiatrixStats(): NexusStats {
  return lastNexusStats;
}

function getConfig(userConfig?: any) {
  const cookie = String(userConfig?.nexusMiatrixCookie || process.env.NEXUS_MIATRIX_COOKIE || "").trim();
  const email = String(userConfig?.nexusMiatrixEmail || process.env.NEXUS_MIATRIX_EMAIL || "").trim();
  const password = String(userConfig?.nexusMiatrixPassword || process.env.NEXUS_MIATRIX_PASSWORD || "");
  const enabled = Boolean(userConfig?.nexusMiatrixEnabled !== false && (cookie || (email && password)));
  return {
    enabled,
    cookie,
    email,
    password,
    userAgent: String(userConfig?.nexusMiatrixUserAgent || process.env.NEXUS_MIATRIX_USER_AGENT || DEFAULT_USER_AGENT),
    searchTimeoutMs: Number(userConfig?.nexusMiatrixSearchTimeout || userConfig?.indexerTimeout || process.env.NEXUS_MIATRIX_SEARCH_TIMEOUT || 8000) || 8000,
    browserTimeoutMs: Number(userConfig?.nexusMiatrixBrowserTimeout || process.env.NEXUS_MIATRIX_BROWSER_TIMEOUT || 32000) || 32000,
    nzbTimeoutMs: Number(userConfig?.nexusMiatrixNzbTimeout || userConfig?.resolveTimeout || process.env.NEXUS_MIATRIX_NZB_TIMEOUT || 25000) || 25000,
    maxResults: Math.max(0, Math.min(Number(userConfig?.nexusMiatrixMaxResults || process.env.NEXUS_MIATRIX_MAX_RESULTS || 2) || 2, 10))
  };
}

const loginCache = new Map<string, { cookie: string; expiresAt: number }>();

function setCookieHeaders(headers: any): string[] {
  const value = headers?.["set-cookie"];
  if (!value) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function cookiePair(setCookie: string): string {
  return setCookie.split(";")[0].trim();
}

function mergeCookies(...cookieSources: Array<string | undefined>): string {
  const pairs = new Map<string, string>();
  for (const source of cookieSources) {
    if (!source) continue;
    for (const part of source.split(";")) {
      const pair = part.trim();
      const index = pair.indexOf("=");
      if (index <= 0) continue;
      pairs.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }
  return [...pairs.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function extractInputValue(html: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tag = html.match(new RegExp(`<input[^>]+name=["']${escaped}["'][^>]*>`, "i"))?.[0] || "";
  return decodeHtml(tag.match(/\bvalue=["']([^"']*)["']/i)?.[1] || "");
}

async function loginCookie(config: ReturnType<typeof getConfig>): Promise<string> {
  if (config.cookie) return config.cookie;
  if (!config.email || !config.password) throw new Error("nexus_miatrix_not_configured");

  const cacheKey = `${config.email}|${config.userAgent}`;
  const cached = loginCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.cookie;

  const loginPage = await request(`${NEXUS_BASE_URL}/Account/Login`, {
    signal: AbortSignal.timeout(config.nzbTimeoutMs),
    headers: {
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "user-agent": config.userAgent
    }
  });
  const loginHtml = await loginPage.body.text();
  if (loginPage.statusCode >= 400) throw new Error(`nexus_login_page_http_${loginPage.statusCode}`);

  const initialCookie = setCookieHeaders(loginPage.headers).map(cookiePair).join("; ");
  const verificationToken = extractInputValue(loginHtml, "__RequestVerificationToken");
  const handler = extractInputValue(loginHtml, "_handler");
  if (!verificationToken) throw new Error("nexus_login_missing_antiforgery");

  const body = new URLSearchParams();
  body.set("_handler", handler);
  body.set("__RequestVerificationToken", verificationToken);
  body.set("Input.EmailOrUserName", config.email);
  body.set("Input.Password", config.password);
  body.set("Input.RememberMe", "true");

  const loginResponse = await request(`${NEXUS_BASE_URL}/Account/Login`, {
    method: "POST",
    signal: AbortSignal.timeout(config.nzbTimeoutMs),
    body: body.toString(),
    headers: {
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "content-type": "application/x-www-form-urlencoded",
      "cookie": initialCookie,
      "origin": NEXUS_BASE_URL,
      "referer": `${NEXUS_BASE_URL}/Account/Login`,
      "user-agent": config.userAgent
    }
  });
  const responseText = await loginResponse.body.text();
  const responseCookies = setCookieHeaders(loginResponse.headers).map(cookiePair).join("; ");
  const sessionCookie = mergeCookies(initialCookie, responseCookies);
  const hasIdentityCookie = /\.AspNetCore\.Identity\.Application=/.test(sessionCookie);
  if (!hasIdentityCookie || (loginResponse.statusCode >= 400 && loginResponse.statusCode !== 302)) {
    if (/invalid|failed|password|email/i.test(responseText)) throw new Error("nexus_login_rejected");
    throw new Error(`nexus_login_http_${loginResponse.statusCode}`);
  }

  loginCache.set(cacheKey, {
    cookie: sessionCookie,
    expiresAt: Date.now() + 45 * 60 * 1000
  });
  return sessionCookie;
}

async function fetchMediaMetadata(media: MediaRequest): Promise<MediaMetadata> {
  if (!media.imdbId.startsWith("tt")) return {};
  try {
    const res = await request(`https://v3-cinemeta.strem.io/meta/${media.type}/${media.imdbId}.json`, {
      signal: AbortSignal.timeout(3500)
    });
    const data = await res.body.json() as any;
    const meta = data?.meta;
    const year = parseInt(String(meta?.releaseInfo || meta?.year || "").match(/\b(19|20)\d{2}\b/)?.[0] || "", 10);
    const aliases = [meta?.name, meta?.imdb_id, meta?.slug].filter(Boolean);
    if (meta?.name && Number.isFinite(year)) aliases.push(`${meta.name} ${year}`);
    const genres = Array.isArray(meta?.genre) ? meta.genre : String(meta?.genre || "").split(",");
    return {
      title: meta?.name,
      aliases,
      year: Number.isFinite(year) ? year : undefined,
      countries: String(meta?.country || "").split(",").map(country => country.trim()).filter(Boolean),
      isAnime: genres.some((genre: string) => /anime/i.test(String(genre)))
    };
  } catch {
    return {};
  }
}

function buildQueryTitles(metadata: MediaMetadata, media: MediaRequest): string[] {
  const seen = new Set<string>();
  const titles = [metadata.title, ...(metadata.aliases || []), media.imdbId].filter((value): value is string => Boolean(value));
  const out: string[] = [];
  for (const title of titles) {
    const normalized = normalizeComparableTitle(title);
    const dotted = normalized.replace(/\s+/g, ".");
    for (const value of [title, normalized, dotted]) {
      const key = normalizeComparableTitle(value);
      if (key && !/^tt\d+$/i.test(key) && !seen.has(key)) {
        seen.add(key);
        out.push(value);
      }
    }
  }
  return out.slice(0, 3);
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([a-f0-9]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function stripTags(html: string): string {
  return decodeHtml(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function parseSizeBytes(value: string): number | undefined {
  const match = value.match(/(\d+(?:\.\d+)?)\s*(GB|GiB|MB|MiB)\b/i);
  if (!match) return undefined;
  const amount = parseFloat(match[1]);
  if (!Number.isFinite(amount)) return undefined;
  return Math.round(amount * (match[2].toLowerCase().startsWith("g") ? 1073741824 : 1048576));
}

function parseGrabs(value: string): number | undefined {
  const match = value.match(/\bGrabs?\s*:?\s*(\d+)\b/i);
  if (match) return Number(match[1]);
  return undefined;
}

export function parseNexusSearchResults(html: string): NexusSearchResult[] {
  const rows = [...html.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map(match => match[0]);
  const results: NexusSearchResult[] = [];
  for (const row of rows) {
    const detailMatch = row.match(/href=["']\/?details\/([A-Za-z0-9_-]+)["']/i);
    const nzbMatch = row.match(/href=["']\/?getnzb\/([A-Za-z0-9_-]+)["']/i);
    if (!detailMatch && !nzbMatch) continue;
    const releaseHash = detailMatch?.[1] || nzbMatch?.[1];
    const nzbHash = nzbMatch?.[1] || releaseHash;
    if (!releaseHash || !nzbHash) continue;

    const titleMatch = row.match(/href=["']\/?details\/[A-Za-z0-9_-]+["'][^>]*>([\s\S]*?)<\/a>/i);
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(match => stripTags(match[1]));
    const title = stripTags(titleMatch?.[1] || cells[0] || "");
    if (!title || /^name$/i.test(title)) continue;

    const text = stripTags(row);
    results.push({
      releaseHash,
      nzbHash,
      title,
      sizeBytes: parseSizeBytes(text),
      category: cells.find(cell => /^(Movies|TV|Anime|Documentary|Foreign|HD|SD|UHD|WEB-DL)\b/i.test(cell)),
      posted: cells.find(cell => /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d{4})\b/i.test(cell)),
      grabs: parseGrabs(text) || (cells[7] && /^\d+$/.test(cells[7]) ? Number(cells[7]) : undefined)
    });
  }
  return results;
}

function isArchiveRelease(title: string): boolean {
  return /(?:^|[.\s_-])(?:rar|r\d{2}|7z(?:\.\d{3})?|zip|par2|sfv|nfo)(?:$|[.\s_-])/i.test(title);
}

function looksLikeVideoRelease(title: string): boolean {
  return /\.(?:mkv|mp4|m4v|avi|mov|ts|m2ts)(?:$|[\s._-])/i.test(title)
    || /\b(?:2160p|1080p|720p|480p|4k|uhd|web-?dl|webrip|blu-?ray|remux|hdtv)\b/i.test(title);
}

function hasBadReleaseSignal(title: string): boolean {
  return /\b(?:sample|trailer|camrip|cam|telesync|hdts|tsrip|tc|telecine|screener|xbet|password|encrypted)\b/i.test(title)
    || /(?:^|[.\s_-])(?:exe|scr|bat|cmd|msi|iso|img)(?:$|[.\s_-])/i.test(title);
}

function sizeLooksPlayable(size: number | undefined): boolean {
  if (!size) return true;
  const gb = size / 1073741824;
  return gb >= 0.2 && gb <= 120;
}

function errorCategory(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "unknown");
  if (/401|403|auth|login|cookie/i.test(message)) return "auth";
  if (/timeout|aborted/i.test(message)) return "timeout";
  if (/ENOTFOUND|ECONN|network|fetch/i.test(message)) return "network";
  return "other";
}

async function fetchNexusPage(path: string, config: ReturnType<typeof getConfig>): Promise<string> {
  const cookie = await loginCookie(config);
  const url = path.startsWith("http") ? path : `${NEXUS_BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
  const res = await request(url, {
    signal: AbortSignal.timeout(config.searchTimeoutMs),
    headers: {
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "cookie": cookie,
      "user-agent": config.userAgent
    }
  });
  const text = await res.body.text();
  if (res.statusCode === 401 || res.statusCode === 403 || /login/i.test(String(res.headers.location || ""))) {
    throw new Error(`nexus_auth_${res.statusCode}`);
  }
  if (res.statusCode >= 400) throw new Error(`nexus_http_${res.statusCode}`);
  return text;
}

function nexusTitleSearchPath(media: MediaRequest, query: string): string {
  const section = media.type === "series" ? "series" : "movies";
  return `/${section}?search=${encodeURIComponent(query)}`;
}

function nexusDetailPathPrefix(media: MediaRequest): string {
  return media.type === "series" ? "/series-details/" : "/movie-details/";
}

function parseDetailLinks(html: string, media: MediaRequest): string[] {
  const prefix = nexusDetailPathPrefix(media).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const links = new Set<string>();
  for (const match of html.matchAll(new RegExp(`href=["'](${prefix}[^"']+)["']`, "gi"))) {
    const href = decodeHtml(match[1]).split("#")[0];
    if (href) links.add(href.startsWith("/") ? href : `/${href}`);
  }
  return [...links].slice(0, 8);
}

function findChromiumExecutable(): string | undefined {
  const candidates = [
    process.env.NEXUS_MIATRIX_CHROMIUM_PATH,
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome-stable",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find(candidate => fs.existsSync(candidate));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForJson(url: string, options: any = {}, timeoutMs = 10000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response.json();
      lastError = `http_${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(250);
  }
  throw new Error(`nexus_browser_cdp_unavailable_${lastError || "timeout"}`);
}

async function withCdp<T>(port: number, targetUrl: string, callback: (send: (method: string, params?: any) => Promise<any>) => Promise<T>): Promise<T> {
  const target = await waitForJson(`http://127.0.0.1:${port}/json/new?${targetUrl}`, { method: "PUT" }, 15000);
  const WebSocketCtor = (globalThis as any).WebSocket;
  if (!WebSocketCtor) throw new Error("nexus_browser_no_websocket");
  const ws = new WebSocketCtor(target.webSocketDebuggerUrl);
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  let nextId = 1;

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("nexus_browser_ws_error"));
  });

  ws.onmessage = (message: any) => {
    const data = JSON.parse(String(message.data));
    const waiter = pending.get(data.id);
    if (!waiter) return;
    pending.delete(data.id);
    if (data.error) waiter.reject(new Error(JSON.stringify(data.error)));
    else waiter.resolve(data.result);
  };

  const send = (method: string, params: any = {}) => {
    const id = nextId++;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise<any>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`nexus_browser_cdp_timeout_${method}`));
      }, 30000);
    });
  };

  try {
    await send("Page.enable");
    await send("Network.enable");
    await send("Runtime.enable");
    return await callback(send);
  } finally {
    try {
      ws.close();
    } catch {
      // ignored
    }
  }
}

async function cdpEval(send: (method: string, params?: any) => Promise<any>, expression: string): Promise<any> {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) throw new Error("nexus_browser_eval_failed");
  return result.result?.value;
}

async function cdpWaitFor(
  send: (method: string, params?: any) => Promise<any>,
  expression: string,
  timeoutMs: number,
  intervalMs = 500
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await cdpEval(send, expression)) return true;
    } catch {
      // Continue polling while Blazor is still attaching.
    }
    await sleep(intervalMs);
  }
  return false;
}

function cdpSetCookieExpression(cookie: string): string {
  const pairs = cookie.split(";")
    .map(part => part.trim())
    .filter(part => /^[^=]+=/.test(part))
    .map(part => {
      const index = part.indexOf("=");
      return { name: part.slice(0, index), value: part.slice(index + 1) };
    });
  return JSON.stringify(pairs);
}

async function fetchSeriesEpisodeResultsWithBrowser(
  media: MediaRequest,
  detailPath: string,
  config: ReturnType<typeof getConfig>
): Promise<NexusSearchResult[]> {
  if (media.type !== "series" || !media.season || !media.episode) return [];
  const executablePath = findChromiumExecutable();
  if (!executablePath) throw new Error("nexus_browser_chromium_missing");

  const port = 9300 + Math.floor(Math.random() * 500);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "deepbridge-nexus-"));
  const args = [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--disable-gpu",
    "--disable-extensions",
    "--no-first-run",
    "--no-default-browser-check",
    "--no-sandbox",
    "--disable-dev-shm-usage"
  ];
  const browser = spawn(executablePath, args, { stdio: "ignore" });
  const deadline = Date.now() + config.browserTimeoutMs;

  try {
    const sessionCookie = await loginCookie(config);
    return await withCdp<NexusSearchResult[]>(port, `${NEXUS_BASE_URL}/`, async send => {
      const remaining = () => Math.max(1000, deadline - Date.now());
      await send("Network.setCookies", {
        cookies: JSON.parse(cdpSetCookieExpression(sessionCookie)).map((cookie: any) => ({
          ...cookie,
          domain: "nexus.miatrix.com",
          path: "/",
          secure: true
        }))
      });

      await send("Page.navigate", { url: `${NEXUS_BASE_URL}${detailPath}` });
      await cdpWaitFor(send, "document.querySelectorAll('.ep-tile').length > 0", Math.min(9000, remaining()));
      const seasonCode = `S${String(media.season).padStart(2, "0")}`;
      const episodeCode = `E${String(media.episode).padStart(2, "0")}`;

      await cdpEval(send, `(() => {
        const button = [...document.querySelectorAll('button')].find(element => element.innerText && element.innerText.includes('Expand'));
        if (button) button.click();
        return true;
      })()`);
      await sleep(Math.min(800, remaining()));
      await cdpEval(send, `(() => {
        const seasonCode = ${JSON.stringify(seasonCode)};
        const element = [...document.querySelectorAll('button,.season-tab,.season-pill,.nav-link,span,div')]
          .find(candidate => candidate.innerText && candidate.innerText.trim() === seasonCode);
        if (element) element.click();
        return Boolean(element);
      })()`);
      await sleep(Math.min(1200, remaining()));
      await cdpEval(send, `(() => {
        const episodeCode = ${JSON.stringify(episodeCode)};
        const tile = [...document.querySelectorAll('.ep-tile')]
          .find(candidate => candidate.innerText && candidate.innerText.includes(episodeCode));
        if (tile) tile.click();
        return Boolean(tile);
      })()`);
      await cdpWaitFor(send, "document.documentElement.outerHTML.includes('/getnzb/')", Math.min(9000, remaining()));

      const html = await cdpEval(send, "document.documentElement.outerHTML");
      return parseNexusSearchResults(String(html || ""));
    });
  } finally {
    try {
      browser.kill();
    } catch {
      // ignored
    }
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // ignored
    }
  }
}

function detailPageMatchesMedia(html: string, media: MediaRequest, metadata: MediaMetadata): boolean {
  if (media.imdbId.startsWith("tt") && new RegExp(`(?:imdb\\.com/title/|\\b)${media.imdbId}\\b`, "i").test(html)) {
    return true;
  }
  const text = normalizeComparableTitle(stripTags(html));
  const expectedTitle = normalizeComparableTitle(metadata.title || "");
  if (!expectedTitle || !text.includes(expectedTitle)) return false;
  if (media.type === "movie" && metadata.year && !text.includes(String(metadata.year))) return false;
  return true;
}

async function fetchTitleDetailResults(
  media: MediaRequest,
  metadata: MediaMetadata,
  config: ReturnType<typeof getConfig>,
  stats: NexusStats
): Promise<NexusSearchResult[]> {
  const queries = buildQueryTitles(metadata, media);
  stats.plannedSearches = queries.length;

  const detailLinks = new Set<string>();
  for (const query of queries) {
    try {
      const searchHtml = await fetchNexusPage(nexusTitleSearchPath(media, query), config);
      stats.fulfilledSearches++;
      for (const link of parseDetailLinks(searchHtml, media)) detailLinks.add(link);
    } catch (error) {
      stats.failedSearches++;
      const category = errorCategory(error);
      stats.errors[category] = (stats.errors[category] || 0) + 1;
    }
  }

  const results: NexusSearchResult[] = [];
  for (const link of [...detailLinks].slice(0, 6)) {
    try {
      stats.detailPages++;
      const detailHtml = await fetchNexusPage(link, config);
      if (!detailPageMatchesMedia(detailHtml, media, metadata)) continue;
      stats.matchedDetailPages++;
      const parsedResults = parseNexusSearchResults(detailHtml);
      results.push(...parsedResults);
      if (parsedResults.length === 0 && media.type === "series") {
        try {
          stats.browserEpisodePages++;
          results.push(...await fetchSeriesEpisodeResultsWithBrowser(media, link, config));
        } catch (error) {
          const category = errorCategory(error);
          stats.errors[`browser_${category}`] = (stats.errors[`browser_${category}`] || 0) + 1;
        }
      }
    } catch (error) {
      const category = errorCategory(error);
      stats.errors[category] = (stats.errors[category] || 0) + 1;
    }
  }

  return results;
}

function nexusRankScore(result: NexusSearchResult, matchScore: number): number {
  let score = matchScore;
  if (looksLikeVideoRelease(result.title)) score += 220;
  if (/\b(?:2160p|4k|uhd)\b/i.test(result.title)) score += 260;
  else if (/\b1080p\b/i.test(result.title)) score += 180;
  else if (/\b720p\b/i.test(result.title)) score += 70;
  if (/\b(?:remux|blu-?ray|web-?dl|webrip)\b/i.test(result.title)) score += 170;
  if (/\b(?:x265|x264|h265|h264|hevc|avc)\b/i.test(result.title)) score += 120;
  if (/\b(?:mkv|mp4)\b/i.test(result.title)) score += 80;
  if (/\b(?:rarbg|yts|yify)\b/i.test(result.title)) score -= 180;
  if (result.sizeBytes) {
    const gb = result.sizeBytes / 1073741824;
    if (gb >= 4 && gb <= 70) score += 160;
    else if (gb >= 1.5 && gb <= 4) score += 80;
    if (gb > 70) score -= 150;
  }
  if (result.grabs) score += Math.min(result.grabs, 100);
  return score;
}

export async function fetchNexusMiatrixNzb(releaseHash: string, userConfig?: any): Promise<string> {
  const config = getConfig(userConfig);
  if (!config.enabled) throw new Error("nexus_miatrix_not_configured");
  if (!/^[A-Za-z0-9_-]+$/.test(releaseHash)) throw new Error("nexus_miatrix_invalid_hash");
  const cookie = await loginCookie(config);

  const res = await request(`${NEXUS_BASE_URL}/getnzb/${encodeURIComponent(releaseHash)}`, {
    signal: AbortSignal.timeout(config.nzbTimeoutMs),
    headers: {
      "accept": "application/x-nzb,application/xml,text/xml,*/*",
      "cookie": cookie,
      "user-agent": config.userAgent,
      "referer": `${NEXUS_BASE_URL}/browse`
    }
  });
  const text = await res.body.text();
  if (res.statusCode === 401 || res.statusCode === 403) throw new Error(`nexus_miatrix_auth_${res.statusCode}`);
  if (res.statusCode >= 400) throw new Error(`nexus_miatrix_nzb_http_${res.statusCode}`);
  if (!/<nzb[\s>]/i.test(text)) throw new Error("nexus_miatrix_invalid_nzb_response");
  lastNexusStats.nzbDownloads++;
  return text;
}

export async function getNexusMiatrixSources(
  media: MediaRequest,
  userConfig: any,
  baseUrl: string,
  token: string
): Promise<SourceCandidate[]> {
  const startedAt = Date.now();
  const config = getConfig(userConfig);
  const stats: NexusStats = {
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: "",
    configured: config.enabled,
    mediaKey: makeMediaKey(media),
    searchMode: media.type === "series" ? "series-title-details" : "movie-title-details",
    plannedSearches: 0,
    fulfilledSearches: 0,
    failedSearches: 0,
    detailPages: 0,
    matchedDetailPages: 0,
    browserEpisodePages: 0,
    rawItems: 0,
    dedupedItems: 0,
    filteredItems: 0,
    selectedItems: 0,
    candidates: 0,
    nzbDownloads: lastNexusStats.nzbDownloads,
    errors: {}
  };

  if (!config.enabled || config.maxResults <= 0) {
    stats.finishedAt = new Date().toISOString();
    lastNexusStats = stats;
    return [];
  }

  const metadata = await fetchMediaMetadata(media);
  const seen = new Set<string>();
  const results: NexusSearchResult[] = [];

  const searchResults = await fetchTitleDetailResults(media, metadata, config, stats);
  for (const result of searchResults) {
    stats.rawItems++;
    const key = result.nzbHash || result.releaseHash;
    if (!seen.has(key)) {
      seen.add(key);
      results.push(result);
    }
  }

  stats.dedupedItems = results.length;
  const filtered = results
    .filter(result => result.title && result.nzbHash)
    .filter(result => !isArchiveRelease(result.title))
    .filter(result => looksLikeVideoRelease(result.title))
    .filter(result => !hasBadReleaseSignal(result.title))
    .filter(result => sizeLooksPlayable(result.sizeBytes));
  stats.filteredItems = filtered.length;

  const sorted = filtered
    .map(result => {
      const parsed = parseRelease(result.title);
      const match = scoreReleaseMatch(result.title, media, parsed, metadata);
      return { result, parsed, match, rankScore: nexusRankScore(result, match.score) };
    })
    .filter(item => item.match.score >= (media.type === "series" ? 650 : 600))
    .sort((a, b) => b.rankScore - a.rankScore || (b.result.sizeBytes || 0) - (a.result.sizeBytes || 0))
    .slice(0, config.maxResults);
  stats.selectedItems = sorted.length;

  const candidates: SourceCandidate[] = [];
  for (const item of sorted) {
    const nzbUrl = `${baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(token)}/nexus/nzb/${encodeURIComponent(item.result.nzbHash)}`;
    candidates.push({
      id: nanoid(),
      mediaType: media.type,
      imdbId: media.imdbId,
      season: media.season,
      episode: media.episode,
      mediaKey: makeMediaKey(media),
      origin: "nexus-miatrix",
      title: item.result.title,
      displayName: "[Nexus/Miatrix]",
      status: "needs_deepbrid_submit",
      nzbUrl,
      originalIndexerUrl: `${NEXUS_BASE_URL}/details/${encodeURIComponent(item.result.releaseHash)}`,
      resolution: item.parsed.resolution,
      quality: item.parsed.quality,
      codec: item.parsed.codec,
      hdr: item.parsed.hdr,
      audio: item.parsed.audio,
      releaseGroup: item.parsed.releaseGroup,
      normalizedTitle: item.parsed.normalizedTitle,
      parsedSeason: item.parsed.season,
      parsedEpisode: item.parsed.episode,
      absoluteEpisode: item.parsed.absoluteEpisode,
      seasonPack: item.parsed.seasonPack,
      sizeBytes: item.result.sizeBytes,
      matchScore: item.match.score,
      matchReason: item.match.reason,
      score: 2400 + item.rankScore + ((item.result.sizeBytes || 0) / 1073741824),
      createdAt: new Date().toISOString()
    });
    stats.candidates++;
  }

  stats.finishedAt = new Date().toISOString();
  stats.nzbDownloads = lastNexusStats.nzbDownloads;
  lastNexusStats = stats;
  return candidates;
}
