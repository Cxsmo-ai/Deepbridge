import { request } from "undici";
import { nanoid } from "nanoid";
import { MediaRequest } from "./apiClient";
import { makeMediaKey } from "../core/mediaKey";
import { parseRelease } from "../core/parseRelease";
import { MediaMetadata, normalizeComparableTitle, scoreReleaseMatch } from "../core/releaseMatch";
import { SourceCandidate } from "../core/types";

type FinderStats = {
  startedAt: string;
  finishedAt: string;
  configured: boolean;
  mediaKey: string;
  plannedSearches: number;
  fulfilledSearches: number;
  failedSearches: number;
  rawItems: number;
  filteredItems: number;
  processedItems: number;
  ready: number;
  failedProcess: number;
  errors: Record<string, number>;
};

type FinderResult = {
  token: string;
  title: string;
  category?: string;
  sizeBytes?: number;
  score: number;
};

type FinderHttpContext = {
  cookie: string;
  userAgent: string;
  userConfig?: any;
  cloudflarePrimed?: boolean;
  browserHeaders: Record<string, string>;
  explicitBrowserIdentity: boolean;
};

type ByparrCookie = {
  name?: string;
  value?: string;
};

type ByparrResponse = {
  status?: string;
  message?: string;
  solution?: {
    status?: number;
    cookies?: ByparrCookie[];
    userAgent?: string;
    response?: string;
  };
};

let lastDeepbridUsenetFinderStats: FinderStats = {
  startedAt: "",
  finishedAt: "",
  configured: false,
  mediaKey: "",
  plannedSearches: 0,
  fulfilledSearches: 0,
  failedSearches: 0,
  rawItems: 0,
  filteredItems: 0,
  processedItems: 0,
  ready: 0,
  failedProcess: 0,
  errors: {}
};

export function getLastDeepbridUsenetFinderStats(): FinderStats {
  return lastDeepbridUsenetFinderStats;
}

function finderCookie(userConfig?: any): string {
  return String(userConfig?.deepbridWebCookie || process.env.DEEPBRID_WEB_COOKIE || "").trim();
}

function finderUserAgent(userConfig?: any): string {
  return String(
    userConfig?.deepbridWebUserAgent
    || process.env.DEEPBRID_WEB_USER_AGENT
    || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
  );
}

const allowedBrowserHeaders = new Set([
  "accept",
  "accept-language",
  "cache-control",
  "dnt",
  "pragma",
  "priority",
  "referer",
  "sec-ch-ua",
  "sec-ch-ua-arch",
  "sec-ch-ua-bitness",
  "sec-ch-ua-full-version",
  "sec-ch-ua-full-version-list",
  "sec-ch-ua-mobile",
  "sec-ch-ua-model",
  "sec-ch-ua-platform",
  "sec-ch-ua-platform-version",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "sec-fetch-user",
  "sec-gpc",
  "upgrade-insecure-requests",
  "user-agent"
]);

function parseBrowserHeaders(raw: unknown): Record<string, string> {
  const source = raw || process.env.DEEPBRID_WEB_HEADERS_JSON || "";
  if (!source) return {};
  let parsed: any = source;
  if (typeof source === "string") {
    try {
      parsed = JSON.parse(source);
    } catch {
      return {};
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed)) {
    const key = name.toLowerCase();
    if (!allowedBrowserHeaders.has(key)) continue;
    const text = Array.isArray(value) ? value.join(", ") : String(value ?? "");
    if (text.trim()) headers[key] = text.trim();
  }
  return headers;
}

function hasExplicitBrowserIdentity(userConfig: any, browserHeaders: Record<string, string>): boolean {
  return Boolean(
    browserHeaders["user-agent"]
    || userConfig?.deepbridWebUserAgent
    || process.env.DEEPBRID_WEB_USER_AGENT
  );
}

function byparrUrl(userConfig?: any): string {
  const raw = String(userConfig?.deepbridByparrUrl || process.env.DEEPBRID_BYPARR_URL || "").trim();
  if (!raw) return "";
  return raw.endsWith("/v1") ? raw : `${raw.replace(/\/+$/, "")}/v1`;
}

function byparrTimeoutMs(userConfig?: any): number {
  return Number(userConfig?.deepbridByparrTimeout || process.env.DEEPBRID_BYPARR_TIMEOUT || 70000) || 70000;
}

function isEnabled(userConfig?: any): boolean {
  if (userConfig?.deepbridUsenetFinderEnabled === false) return false;
  if (process.env.DEEPBRID_USENET_FINDER_ENABLED === "false") return false;
  return Boolean(finderCookie(userConfig));
}

function errorCategory(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "unknown");
  if (/cloudflare|cf_challenge/i.test(message)) return "cloudflare";
  if (/auth|login|cookie|401|403/i.test(message)) return "auth";
  if (/timeout|aborted|AbortError|UND_ERR_ABORTED/i.test(message)) return "timeout";
  if (/http/i.test(message)) return "http";
  if (/json/i.test(message)) return "json";
  return "other";
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
    return {
      title: meta?.name,
      aliases,
      year: Number.isFinite(year) ? year : undefined,
      countries: String(meta?.country || "").split(",").map(country => country.trim()).filter(Boolean)
    };
  } catch {
    return {};
  }
}

function queryTitles(metadata: MediaMetadata, media: MediaRequest): string[] {
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

function buildQueries(metadata: MediaMetadata, media: MediaRequest): string[] {
  const titles = queryTitles(metadata, media);
  if (titles.length === 0) return [];
  if (media.type === "series" && media.season && media.episode) {
    const code = `S${String(media.season).padStart(2, "0")}E${String(media.episode).padStart(2, "0")}`;
    return [...new Set(titles.flatMap(title => [`${title} ${code}`, title]))].slice(0, 4);
  }
  return [...new Set(titles.flatMap(title => metadata.year ? [`${title} ${metadata.year}`, title] : [title]))].slice(0, 4);
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function stripTags(value: string): string {
  return decodeHtml(value.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function parseSizeBytes(value: string): number | undefined {
  const match = value.match(/(\d+(?:\.\d+)?)\s*(tb|tib|gb|gib|mb|mib|kb|kib)\b/i);
  if (!match) return undefined;
  const amount = parseFloat(match[1]);
  if (!Number.isFinite(amount)) return undefined;
  const unit = match[2].toLowerCase();
  const multiplier = unit.startsWith("t") ? 1099511627776 : unit.startsWith("g") ? 1073741824 : unit.startsWith("m") ? 1048576 : 1024;
  return Math.round(amount * multiplier);
}

function matchFirst(html: string, pattern: RegExp): string | undefined {
  return html.match(pattern)?.[1];
}

function parseFinderResults(html: string, media: MediaRequest, metadata: MediaMetadata): FinderResult[] {
  const out: FinderResult[] = [];
  const seen = new Set<string>();
  
  let data;
  try {
    data = JSON.parse(html);
  } catch (err) {
    // Fallback just in case they revert
    return [];
  }
  
  const results = data?.results || [];
  for (const item of results) {
    const token = item.token;
    if (!token || seen.has(token)) continue;
    seen.add(token);
    
    const title = item.title;
    if (!title) continue;
    
    const category = item.cat || "";
    const sizeBytes = Number(item.sizeBytes) || undefined;
    
    const parsed = parseRelease(title);
    const matchScore = scoreReleaseMatch(title, media, parsed, metadata);
    out.push({
      token,
      title,
      category,
      sizeBytes,
      score: matchScore.score + (sizeBytes ? sizeBytes / 1073741824 : 0)
    });
  }
  return out;
}

function hasAuthFailure(html: string): boolean {
  return /href=["'][^"']*\/login["']/i.test(html) && !/data-token=/i.test(html);
}

function hasCloudflareChallenge(html: string, statusCode: number): boolean {
  // Cloudflare can return a generic 403 body from a server-side client, without
  // the usual challenge markers. Finder is the only code path allowed to use
  // Byparr, so treat either challenge status as eligible for that fallback.
  if (statusCode === 403 || statusCode === 503) return true;
  return /Just a moment|cf-browser-verification|challenge-platform|cf-chl|Cloudflare/i.test(html);
}

function mergeCookieStrings(baseCookie: string, cookies: ByparrCookie[] = []): string {
  const merged = new Map<string, string>();
  for (const part of baseCookie.split(/;\s*/)) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name && value) merged.set(name, value);
  }
  for (const cookie of cookies) {
    const name = String(cookie.name || "").trim();
    const value = String(cookie.value || "").trim();
    if (name === "PHPSESSID" || name.startsWith("amember_")) continue;
    if (name && value) merged.set(name, value);
  }
  return Array.from(merged.entries()).map(([name, value]) => `${name}=${value}`).join("; ");
}

async function solveCloudflareWithByparr(targetUrl: string, context: FinderHttpContext, timeoutMs: number): Promise<boolean> {
  const endpoint = byparrUrl(context.userConfig);
  if (!endpoint) return false;

  const maxTimeout = Math.max(15, Math.ceil(timeoutMs / 1000));
  const res = await request(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      cmd: "request.get",
      url: targetUrl,
      max_timeout: maxTimeout
    }),
    signal: AbortSignal.timeout(timeoutMs + 5000)
  });

  const text = await res.body.text();
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`deepbrid_finder_byparr_http_${res.statusCode}`);
  }

  let data: ByparrResponse;
  try {
    data = JSON.parse(text) as ByparrResponse;
  } catch {
    throw new Error("deepbrid_finder_byparr_json_failed");
  }

  const cookies = data.solution?.cookies || [];
  if (cookies.length === 0) return false;
  context.cookie = mergeCookieStrings(context.cookie, cookies);
  if (data.solution?.userAgent) {
    context.userAgent = data.solution.userAgent;
    if (context.browserHeaders["user-agent"]) {
      context.browserHeaders["user-agent"] = data.solution.userAgent;
    }
  }
  return true;
}

async function primeCloudflareWithByparr(url: URL, context: FinderHttpContext): Promise<void> {
  if (context.cloudflarePrimed || !byparrUrl()) return;
  context.cloudflarePrimed = true;
  const solved = await solveCloudflareWithByparr(url.toString(), context, byparrTimeoutMs(context.userConfig));
  if (!solved) throw new Error("deepbrid_finder_cloudflare_challenge");
}

function makeFinderHeaders(context: FinderHttpContext, accept: string, ajax: boolean): Record<string, string> {
  const browserHeaders = { ...context.browserHeaders };
  delete browserHeaders["user-agent"];
  delete browserHeaders.accept;
  delete browserHeaders.cookie;
  delete browserHeaders.host;

  const headers: Record<string, string> = {
    ...browserHeaders,
    Cookie: context.cookie,
    "User-Agent": context.browserHeaders["user-agent"] || context.userAgent,
    Accept: context.browserHeaders.accept || accept
  };
  if (ajax) {
    headers["X-Requested-With"] = "XMLHttpRequest";
    headers.Accept = accept;
    delete headers["upgrade-insecure-requests"];
    delete headers["sec-fetch-user"];
  }
  return headers;
}

async function requestFinderText(url: URL, context: FinderHttpContext, timeoutMs: number, accept: string, ajax = false): Promise<{ statusCode: number; text: string }> {
  // A user-supplied browser session should be attempted as-is. Byparr is a
  // Finder-only challenge fallback, not a mandatory proxy for authenticated requests.
  if (!context.explicitBrowserIdentity) {
    await primeCloudflareWithByparr(url, context);
  }

  let res;
  try {
    res = await request(url, {
      headers: makeFinderHeaders(context, accept, ajax),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    if (!context.cloudflarePrimed && byparrUrl()) {
      context.cloudflarePrimed = true;
      const solved = await solveCloudflareWithByparr(url.toString(), context, byparrTimeoutMs(context.userConfig));
      if (solved) {
        res = await request(url, {
          headers: makeFinderHeaders(context, accept, ajax),
          signal: AbortSignal.timeout(timeoutMs)
        });
      } else {
        throw new Error("deepbrid_finder_cloudflare_challenge");
      }
    } else {
      throw error;
    }
  }
  const text = await res.body.text();
  if (!hasCloudflareChallenge(text, res.statusCode)) {
    return { statusCode: res.statusCode, text };
  }

  const solved = await solveCloudflareWithByparr(url.toString(), context, byparrTimeoutMs(context.userConfig));
  if (!solved) throw new Error("deepbrid_finder_cloudflare_challenge");

  const retry = await request(url, {
    headers: makeFinderHeaders(context, accept, ajax),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const retryText = await retry.body.text();
  if (hasCloudflareChallenge(retryText, retry.statusCode)) {
    throw new Error("deepbrid_finder_cloudflare_challenge");
  }
  return { statusCode: retry.statusCode, text: retryText };
}

async function searchFinder(query: string, context: FinderHttpContext, timeoutMs: number, media: MediaRequest, metadata: MediaMetadata): Promise<FinderResult[]> {
  const url = new URL("https://www.deepbrid.com/usenet-finder");
  url.searchParams.set("ajax", "1");
  url.searchParams.set("do", "search");
  url.searchParams.set("q", query);
  url.searchParams.set("cat", "");
  url.searchParams.set("offset", "0");
  url.searchParams.set("limit", "15");
  const { statusCode, text: html } = await requestFinderText(url, context, timeoutMs, "application/json,text/javascript,*/*", true);
  if (statusCode === 401 || statusCode === 403 || hasAuthFailure(html)) {
    throw new Error("deepbrid_finder_auth_failed");
  }
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`deepbrid_finder_http_${statusCode}`);
  }
  return parseFinderResults(html, media, metadata);
}

function deepFindFiles(value: any, found: any[] = []): any[] {
  if (!value || found.length > 80) return found;
  if (Array.isArray(value)) {
    for (const item of value) deepFindFiles(item, found);
    return found;
  }
  if (typeof value !== "object") return found;
  const url = value.url || value.download_url || value.downloadUrl || value.link || value.download || value.href;
  const name = value.name || value.filename || value.title || value.path;
  if (url && name) found.push(value);
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") deepFindFiles(child, found);
  }
  return found;
}

function fileName(file: any): string {
  return String(file.filename || file.name || file.title || file.path || "");
}

function fileUrl(file: any): string | undefined {
  const raw = file.url || file.download_url || file.downloadUrl || file.link || file.download || file.href;
  return raw ? new URL(String(raw), "https://www.deepbrid.com").toString() : undefined;
}

function fileSize(file: any): number | undefined {
  const value = Number(file.filesize || file.size || file.bytes || 0);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function isVideoFile(file: any): boolean {
  return /\.(mkv|mp4|m4v|mov|avi|ts|m2ts|webm)$/i.test(fileName(file)) || /^video\//i.test(String(file.type || file.content_type || file.mime || ""));
}

function isArchiveFile(file: any): boolean {
  const title = fileName(file);
  const url = fileUrl(file) || "";
  return /\.(?:rar|r\d{2}|7z(?:\.\d{3})?|zip|par2|sfv|nfo)$/i.test(title) || /\.(?:rar|r\d{2}|7z(?:\.\d{3})?|zip|par2|sfv|nfo)(?:$|[?#])/i.test(url);
}

function selectBestVideo(files: any[], media: MediaRequest): any | undefined {
  const videos = files.filter(file => fileUrl(file)).filter(isVideoFile).filter(file => !isArchiveFile(file));
  if (videos.length === 0) return undefined;
  if (media.type === "series" && media.episode) {
    const exact = videos.find(file => {
      const parsed = parseRelease(fileName(file));
      return parsed.season === media.season && parsed.episode === media.episode;
    });
    if (exact) return exact;
    const range = videos.find(file => {
      const parsed = parseRelease(fileName(file));
      return parsed.season === media.season && parsed.episodeRange && parsed.episodeRange.start <= media.episode! && parsed.episodeRange.end >= media.episode!;
    });
    if (range) return range;
  }
  return videos.reduce((prev, current) => (fileSize(prev) || 0) > (fileSize(current) || 0) ? prev : current);
}

async function processFinderToken(token: string, context: FinderHttpContext, timeoutMs: number): Promise<any[]> {
  const url = new URL("https://www.deepbrid.com/usenet-finder");
  url.searchParams.set("ajax", "1");
  url.searchParams.set("do", "process");
  url.searchParams.set("token", token);
  const { statusCode, text } = await requestFinderText(url, context, timeoutMs, "application/json,text/plain,*/*", true);
  if (statusCode === 401 || statusCode === 403 || /\/login\b/i.test(text)) {
    throw new Error("deepbrid_finder_auth_failed");
  }
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`deepbrid_finder_process_http_${statusCode}`);
  }
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("deepbrid_finder_json_failed");
  }
  if (data?.error) throw new Error(String(data.error));
  return deepFindFiles(data);
}

export async function getDeepbridUsenetFinderSources(media: MediaRequest, userConfig?: any): Promise<SourceCandidate[]> {
  const startedAt = Date.now();
  const cookie = finderCookie(userConfig);
  const browserHeaders = parseBrowserHeaders(userConfig?.deepbridWebHeaders);
  const userAgent = browserHeaders["user-agent"] || finderUserAgent(userConfig);
  const httpContext: FinderHttpContext = {
    cookie,
    userAgent,
    userConfig,
    browserHeaders,
    explicitBrowserIdentity: hasExplicitBrowserIdentity(userConfig, browserHeaders)
  };
  const stats: FinderStats = {
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: "",
    configured: isEnabled(userConfig),
    mediaKey: makeMediaKey(media),
    plannedSearches: 0,
    fulfilledSearches: 0,
    failedSearches: 0,
    rawItems: 0,
    filteredItems: 0,
    processedItems: 0,
    ready: 0,
    failedProcess: 0,
    errors: {}
  };

  if (!stats.configured) {
    stats.finishedAt = new Date().toISOString();
    lastDeepbridUsenetFinderStats = stats;
    return [];
  }

  const metadata = await fetchMediaMetadata(media);
  const queries = buildQueries(metadata, media);
  stats.plannedSearches = queries.length;
  const searchTimeoutMs = Number(userConfig?.deepbridUsenetFinderSearchTimeout || process.env.DEEPBRID_USENET_FINDER_SEARCH_TIMEOUT || 9000) || 9000;
  const processTimeoutMs = Number(userConfig?.deepbridUsenetFinderProcessTimeout || process.env.DEEPBRID_USENET_FINDER_PROCESS_TIMEOUT || 20000) || 20000;
  const maxProcess = Math.max(1, Math.min(Number(userConfig?.deepbridUsenetFinderMaxProcess || process.env.DEEPBRID_USENET_FINDER_MAX_PROCESS || 5) || 5, 12));
  const maxResults = Math.max(1, Math.min(Number(userConfig?.deepbridUsenetFinderMaxResults || process.env.DEEPBRID_USENET_FINDER_MAX_RESULTS || 4) || 4, 10));
  const seen = new Set<string>();
  const rawResults: FinderResult[] = [];

  for (const query of queries) {
    try {
      const found = await searchFinder(query, httpContext, searchTimeoutMs, media, metadata);
      stats.fulfilledSearches++;
      for (const result of found) {
        stats.rawItems++;
        if (!seen.has(result.token)) {
          seen.add(result.token);
          const parsed = parseRelease(result.title);
          const match = scoreReleaseMatch(result.title, media, parsed, metadata);
          rawResults.push({ ...result, score: match.score + (result.sizeBytes ? result.sizeBytes / 1073741824 : 0) });
        }
      }
    } catch (error) {
      stats.failedSearches++;
      const category = errorCategory(error);
      stats.errors[category] = (stats.errors[category] || 0) + 1;
    }
  }

  const selected = rawResults
    .map(result => {
      const parsed = parseRelease(result.title);
      const match = scoreReleaseMatch(result.title, media, parsed, metadata);
      return { result, parsed, match };
    })
    .filter(item => {
      const passed = item.match.score >= (media.type === "series" ? 650 : 600);
      return passed;
    })
    .sort((a, b) => b.result.score - a.result.score)
    .slice(0, maxProcess);
  stats.filteredItems = selected.length;

  const candidates: SourceCandidate[] = [];
  for (const item of selected) {
    try {
      stats.processedItems++;
      const files = await processFinderToken(item.result.token, httpContext, processTimeoutMs);
      const video = selectBestVideo(files, media);
      const playableUrl = video ? fileUrl(video) : undefined;
      if (!video || !playableUrl) {
        stats.failedProcess++;
        stats.errors.no_video = (stats.errors.no_video || 0) + 1;
        continue;
      }
      const title = fileName(video) || item.result.title;
      const parsed = parseRelease(title);
      const match = scoreReleaseMatch(title, media, parsed, metadata);
      candidates.push({
        id: nanoid(),
        mediaType: media.type,
        imdbId: media.imdbId,
        season: media.season,
        episode: media.episode,
        mediaKey: makeMediaKey(media),
        origin: "deepbrid-usenet-finder",
        title,
        displayName: "[Deepbrid Usenet]",
        status: "ready",
        playableUrl,
        sourceService: "deepbrid",
        resolution: parsed.resolution,
        quality: parsed.quality,
        codec: parsed.codec,
        hdr: parsed.hdr,
        audio: parsed.audio,
        releaseGroup: parsed.releaseGroup,
        normalizedTitle: parsed.normalizedTitle,
        parsedSeason: parsed.season,
        parsedEpisode: parsed.episode,
        absoluteEpisode: parsed.absoluteEpisode,
        seasonPack: parsed.seasonPack,
        sizeBytes: fileSize(video) || item.result.sizeBytes || parsed.sizeBytes,
        matchScore: match.score,
        matchReason: match.reason,
        score: 9200 + match.score + ((fileSize(video) || item.result.sizeBytes || 0) / 1073741824),
        createdAt: new Date().toISOString()
      });
      stats.ready++;
      if (candidates.length >= maxResults) break;
    } catch (error) {
      stats.failedProcess++;
      const category = errorCategory(error);
      stats.errors[category] = (stats.errors[category] || 0) + 1;
    }
  }

  stats.finishedAt = new Date().toISOString();
  lastDeepbridUsenetFinderStats = stats;
  return candidates;
}

export const __deepbridUsenetFinderTest = {
  parseFinderResults,
  deepFindFiles,
  selectBestVideo,
  mergeCookieStrings,
  hasCloudflareChallenge,
  parseBrowserHeaders
};
