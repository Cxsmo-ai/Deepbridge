import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyFormbody from "@fastify/formbody";
import fastifyCors from "@fastify/cors";
import path from "path";
import dotenv from "dotenv";
import { spawn } from "child_process";
import { nanoid } from "nanoid";

import { manifest } from "./stremio/manifest";
import { DeepbridClient, MediaRequest } from "./deepbrid/apiClient";
import { getOfficialDeepbridSources } from "./deepbrid/officialAddon";
import { getDeepbridUsenetFinderSources, getLastDeepbridUsenetFinderStats } from "./deepbrid/usenetFinder";
import { formatStreams } from "./stremio/formatStreams";
import { getIndexerSources, getLastIndexerSearchStats } from "./indexer/search";
import { getEasynewsDirectSources, getLastEasynewsDirectStats } from "./easynews/direct";
import { getLastNewshostingStats, getNewshostingSources } from "./newshosting/direct";
import { fetchNexusMiatrixNzb, getLastNexusMiatrixStats, getNexusMiatrixSources } from "./nexus/miatrix";
import { getLastTorrentStats, getTorrentSources, normalizeTorrent } from "./deepbrid/torrents";
import { getLibraryCatalog, getLibraryDirectStream, getLibraryMeta, isLibraryItemId, LibraryCatalogId, parseLibraryItemId } from "./deepbrid/libraryCatalog";
import { getLastUpstreamAddonStats, getUpstreamAddonSources } from "./stremio/upstreamAddons";
import { TorBoxClient, torBoxDataItems, TorBoxUsenetFile, TorBoxUsenetItem } from "./torbox/apiClient";
import { decodeConfig } from "./core/configDecoder";
import { dedupeCandidates } from "./core/releaseMatch";
import { parseRelease } from "./core/parseRelease";
import { SourceCandidate } from "./core/types";
import { browserBridgeStatus, pairBrowserBridge, pollBrowserBridge, respondBrowserBridge, waitForBrowserBridgeRequest } from "./deepbrid/browserBridge";

dotenv.config();

function redactUrl(url: string): string {
  return url
    .replace(/^\/[^/]{40,}(?=\/)/, "/:token")
    .replace(/\/resolve\/[^/?]+/, "/resolve/:payload")
    .replace(/\/play\/[^/?]+/, "/play/:payload");
}

const app = Fastify({
  logger: {
    serializers: {
      req(request) {
        return {
          method: request.method,
          url: redactUrl(request.url),
          host: request.hostname,
          remoteAddress: request.ip,
          remotePort: request.socket?.remotePort
        };
      }
    }
  },
  trustProxy: true,
  maxParamLength: 10000
});

app.register(fastifyCors, { origin: "*" });
app.register(fastifyFormbody);

// Serve static files from public
app.register(fastifyStatic, {
  root: path.join(__dirname, "../public"),
  prefix: "/static/", 
});

const baseUrl = process.env.BASE_URL || "http://localhost:7000";

function bridgeConfigOrReply(token: string, reply: any) {
  const config = decodeConfig(token);
  if (!config?.deepbridFinderBridgeEnabled || !config.deepbridFinderBridgeId || !config.deepbridFinderBridgeSecret) {
    reply.status(400).send({ error: "browser_bridge_not_configured" });
    return undefined;
  }
  return config;
}

function getRequestBaseUrl(request: any): string {
  return process.env.BASE_URL || `${request.protocol}://${request.hostname}`;
}

type ResolvePayload = {
  nzbUrl: string;
  season?: number;
  episode?: number;
  absoluteEpisode?: number;
  seasonPack?: boolean;
  title?: string;
};

const resolveCache = new Map<string, { url: string; expiresAt: number }>();
const resolveInflight = new Map<string, Promise<string>>();
const newshostingNzbCache = new Map<string, { nzb: string; expiresAt: number }>();
const nexusNzbCache = new Map<string, { nzb: string; expiresAt: number }>();
let lastNewshostingNzbStats = {
  attempted: 0,
  generated: 0,
  failed: 0,
  lastStartedAt: "",
  lastFinishedAt: "",
  lastDurationMs: 0,
  averageDurationMs: 0,
  lastErrorCategory: "",
  errors: {} as Record<string, number>
};
let lastPregrabStats = {
  mode: "direct",
  startedAt: "",
  finishedAt: "",
  totalCandidates: 0,
  attempted: 0,
  ready: 0,
  failed: 0,
  skipped: 0,
  skippedArchives: 0,
  deadlineMs: 0,
  maxAttempts: 0,
  maxReady: 0,
  concurrency: 0,
  bySource: {} as Record<string, { attempted: number; ready: number; failed: number; skipped: number; errors?: Record<string, number> }>
};

type SettledResult<T> = PromiseSettledResult<T> | { status: "timeout" };

function streamBudgetMs(userConfig?: any): number {
  const configured = Number(userConfig?.streamTimeoutMs || process.env.DEEPBRIDGE_STREAM_BUDGET_MS || 21000) || 21000;
  return Math.max(6000, Math.min(configured, 24000));
}

async function allSettledWithin<T>(promises: Array<Promise<T>>, timeoutMs: number): Promise<Array<SettledResult<T>>> {
  const results: Array<SettledResult<T> | undefined> = new Array(promises.length);
  await Promise.race([
    Promise.all(promises.map((promise, index) => promise.then(
      value => {
        results[index] = { status: "fulfilled", value };
      },
      reason => {
        results[index] = { status: "rejected", reason };
      }
    ))),
    new Promise(resolve => setTimeout(resolve, Math.max(1, timeoutMs)))
  ]);
  return results.map(result => result || { status: "timeout" });
}

// Final Deepbrid/myfast playback URLs can be short-lived or single-use.
// Keep only in-flight de-duping, not long-lived cached redirects.
const resolveTtlMs = 0;

function cacheHealth() {
  const now = Date.now();
  for (const [key, value] of newshostingNzbCache.entries()) {
    if (value.expiresAt <= now) newshostingNzbCache.delete(key);
  }
  for (const [key, value] of nexusNzbCache.entries()) {
    if (value.expiresAt <= now) nexusNzbCache.delete(key);
  }
  return {
    resolve: {
      entries: resolveCache.size,
      inflight: resolveInflight.size,
      ttlMs: resolveTtlMs
    },
    newshostingNzb: {
      entries: newshostingNzbCache.size,
      ttlMs: 10 * 60 * 1000,
      generation: lastNewshostingNzbStats
    },
    nexusNzb: {
      entries: nexusNzbCache.size,
      ttlMs: 10 * 60 * 1000
    },
    deepbridAdd: lastPregrabStats,
    indexerSearch: getLastIndexerSearchStats(),
    deepbridUsenetFinder: getLastDeepbridUsenetFinderStats(),
    easynewsDirect: getLastEasynewsDirectStats(),
    newshostingDirect: getLastNewshostingStats(),
    nexusMiatrix: getLastNexusMiatrixStats(),
    torrents: getLastTorrentStats(),
    upstreamAddons: getLastUpstreamAddonStats()
  };
}

function getDeepbridRequestContext(token?: string): { apiKey: string; userConfig: any } {
  const userConfig = token ? decodeConfig(token) : null;
  return {
    userConfig,
    apiKey: userConfig?.deepbridApiKey || process.env.DEEPBRID_API_KEY || ""
  };
}

function libraryCatalogTimeout(userConfig: any): number {
  return Number(userConfig?.deepbridLibraryCatalogTimeout || process.env.DEEPBRID_LIBRARY_CATALOG_TIMEOUT || 12000) || 12000;
}

async function handleLibraryCatalog(token: string | undefined, catalogId: string, query: any) {
  const validCatalogIds: LibraryCatalogId[] = ["deepbridge-library-movies", "deepbridge-library-tv", "deepbridge-library-anime"];
  if (!validCatalogIds.includes(catalogId as LibraryCatalogId)) return { metas: [] };
  const { apiKey, userConfig } = getDeepbridRequestContext(token);
  if (!apiKey || userConfig?.deepbridLibraryCatalogsEnabled === false) return { metas: [] };
  return getLibraryCatalog(new DeepbridClient(apiKey), apiKey, catalogId as LibraryCatalogId, {
    skip: Math.max(0, Number(query?.skip || 0) || 0),
    search: typeof query?.search === "string" ? query.search : "",
    timeoutMs: libraryCatalogTimeout(userConfig)
  });
}

async function handleLibraryMeta(token: string | undefined, id: string) {
  const { apiKey, userConfig } = getDeepbridRequestContext(token);
  if (!apiKey || userConfig?.deepbridLibraryCatalogsEnabled === false) return undefined;
  return getLibraryMeta(new DeepbridClient(apiKey), apiKey, id, libraryCatalogTimeout(userConfig));
}

async function handleLibraryStream(token: string | undefined, id: string, requestBaseUrl?: string) {
  const { apiKey, userConfig } = getDeepbridRequestContext(token);
  if (!apiKey || userConfig?.deepbridLibraryCatalogsEnabled === false) return { streams: [] };
  const direct = await getLibraryDirectStream(new DeepbridClient(apiKey), id, Number(userConfig?.torrentInfoTimeout || 12000) || 12000);
  const parsed = parseLibraryItemId(id);
  if (!token || !requestBaseUrl || !parsed || direct.streams.length === 0) return direct;
  const payload = encodeJsonPayload({ id: parsed.torrentId });
  return {
    streams: direct.streams.map(stream => ({
      ...stream,
      url: `${requestBaseUrl}/${token}/torrent/play/${payload}`
    }))
  };
}

function newshostingNzbErrorCategory(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "unknown");
  if (/too_large|too_many_files|frame_too_large/i.test(message)) return "too_large";
  if (/timeout|read_timeout/i.test(message)) return "timeout";
  if (/connect|ECONN|ENOTFOUND|network|stream_ended/i.test(message)) return "network";
  if (/login|auth|credential/i.test(message)) return "auth";
  if (/group_detail/i.test(message)) return "group_detail";
  if (/file_detail/i.test(message)) return "file_detail";
  return "other";
}

function recordNewshostingNzbResult(startedAt: number, error?: unknown) {
  const duration = Date.now() - startedAt;
  lastNewshostingNzbStats.lastFinishedAt = new Date().toISOString();
  lastNewshostingNzbStats.lastDurationMs = duration;
  const completed = lastNewshostingNzbStats.generated + lastNewshostingNzbStats.failed + 1;
  lastNewshostingNzbStats.averageDurationMs = Math.round(
    ((lastNewshostingNzbStats.averageDurationMs * (completed - 1)) + duration) / completed
  );

  if (error) {
    const category = newshostingNzbErrorCategory(error);
    lastNewshostingNzbStats.failed++;
    lastNewshostingNzbStats.lastErrorCategory = category;
    lastNewshostingNzbStats.errors[category] = (lastNewshostingNzbStats.errors[category] || 0) + 1;
    return;
  }

  lastNewshostingNzbStats.generated++;
  lastNewshostingNzbStats.lastErrorCategory = "";
}

function createNewshostingNzbIsolated(encodedId: string, userConfig: any): Promise<string> {
  const timeoutMs = Math.min(
    Math.max(Number(
      userConfig?.newshostingNzbTimeout
      || userConfig?.newshostingTimeout
      || 45000
    ) || 45000, 1000),
    120000
  );
  const workerPath = path.join(__dirname, "newshosting", "nzbWorker.js");
  const maxOutputBytes = 64 * 1024 * 1024;
  const startedAt = Date.now();
  lastNewshostingNzbStats.attempted++;
  lastNewshostingNzbStats.lastStartedAt = new Date(startedAt).toISOString();

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let settled = false;

    const finish = (error?: Error, value?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) {
        recordNewshostingNzbResult(startedAt, error);
        child.kill("SIGKILL");
        reject(error);
        return;
      }
      recordNewshostingNzbResult(startedAt);
      resolve(value || "");
    };

    const timeout = setTimeout(() => {
      finish(new Error("newshosting_nzb_timeout"));
    }, timeoutMs);

    child.stdout.on("data", chunk => {
      const buffer = Buffer.from(chunk);
      stdoutBytes += buffer.length;
      if (stdoutBytes > maxOutputBytes) {
        finish(new Error("newshosting_nzb_too_large"));
        return;
      }
      stdout.push(buffer);
    });
    child.stderr.on("data", chunk => stderr.push(Buffer.from(chunk)));
    child.on("error", error => finish(error));
    child.on("close", code => {
      if (settled) return;
      if (code === 0) {
        finish(undefined, Buffer.concat(stdout).toString("utf8"));
        return;
      }
      const message = Buffer.concat(stderr).toString("utf8").trim() || "newshosting_nzb_failed";
      finish(new Error(message.split(/\r?\n/).pop() || "newshosting_nzb_failed"));
    });

    child.stdin.end(JSON.stringify({ encodedId, userConfig }));
  });
}

function downloadsCount(data: any): number | undefined {
  if (Array.isArray(data)) return data.length;
  if (Array.isArray(data?.downloads)) return data.downloads.length;
  if (Array.isArray(data?.data)) return data.data.length;
  if (Array.isArray(data?.items)) return data.items.length;
  return undefined;
}

async function deepbridHealth(apiKey: string) {
  if (!apiKey) {
    return {
      configured: false,
      ok: false,
      error: "missing_api_key"
    };
  }

  const startedAt = Date.now();
  try {
    const client = new DeepbridClient(apiKey);
    const data = await client.getApiKeyInfo(4000) as any;
    let cache = {
      ok: false,
      downloads: undefined as number | undefined,
      error: undefined as string | undefined
    };
    try {
      const downloads = await client.getDownloads(4000) as any;
      cache = {
        ok: !downloads?.error,
        downloads: downloadsCount(downloads),
        error: downloads?.error ? "deepbrid_downloads_error" : undefined
      };
    } catch {
      cache = {
        ok: false,
        downloads: undefined,
        error: "deepbrid_downloads_unreachable"
      };
    }
    return {
      configured: true,
      ok: !data?.error,
      latencyMs: Date.now() - startedAt,
      cache,
      error: data?.error ? "deepbrid_api_error" : undefined
    };
  } catch {
    return {
      configured: true,
      ok: false,
      latencyMs: Date.now() - startedAt,
      cache: {
        ok: false,
        downloads: undefined,
        error: "deepbrid_health_unavailable"
      },
      error: "deepbrid_unreachable"
    };
  }
}

function resolveCacheKey(payload: ResolvePayload): string {
  return [
    payload.nzbUrl,
    payload.season || "",
    payload.episode || "",
    payload.absoluteEpisode || "",
    payload.seasonPack ? "pack" : "single"
  ].join("|");
}

function decodeResolvePayload(encoded: string): ResolvePayload {
  let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const decoded = Buffer.from(base64, 'base64').toString('utf8');
  try {
    const parsed = JSON.parse(decoded);
    if (parsed && parsed.nzbUrl) return parsed;
  } catch(e) {
  }
  return { nzbUrl: decoded };
}

function newshostingEncodedIdFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/newshosting\/nzb\/([^/]+)$/);
    return match?.[1] ? decodeURIComponent(match[1]) : undefined;
  } catch {
    return undefined;
  }
}

function nexusHashFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/nexus\/nzb\/([^/]+)$/);
    return match?.[1] ? decodeURIComponent(match[1]) : undefined;
  } catch {
    return undefined;
  }
}

async function prepareNzbUrlForDeepbrid(payload: ResolvePayload, userConfig: any, requestBaseUrl: string): Promise<ResolvePayload> {
  const encodedId = newshostingEncodedIdFromUrl(payload.nzbUrl);
  if (encodedId) {
    const nzb = await createNewshostingNzbIsolated(encodedId, userConfig);
    const cacheId = nanoid();
    newshostingNzbCache.set(cacheId, {
      nzb,
      expiresAt: Date.now() + 10 * 60 * 1000
    });

    return {
      ...payload,
      nzbUrl: `${requestBaseUrl.replace(/\/+$/, "")}/newshosting/cached/${cacheId}.nzb`
    };
  }

  const nexusHash = nexusHashFromUrl(payload.nzbUrl);
  if (nexusHash) {
    const nzb = await fetchNexusMiatrixNzb(nexusHash, userConfig);
    const cacheId = nanoid();
    nexusNzbCache.set(cacheId, {
      nzb,
      expiresAt: Date.now() + 10 * 60 * 1000
    });

    return {
      ...payload,
      nzbUrl: `${requestBaseUrl.replace(/\/+$/, "")}/nexus/cached/${cacheId}.nzb`
    };
  }

  return payload;
}

function decodeJsonPayload(encoded: string): any {
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
}

function encodeJsonPayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function normalizePlayableUrl(url: string): string {
  return new URL(url, "https://www.deepbrid.com").toString();
}

function fileSize(file: any): number {
  const size = Number(file?.filesize || file?.size || 0);
  return Number.isFinite(size) ? size : 0;
}

function fileTitle(file: any): string {
  return String(file.filename || file.name || file.short_name || file.subject || "");
}

function fileDownloadUrl(file: any): string | undefined {
  return file?.download_url || file?.downloadUrl || file?.url || file?.link || file?.download;
}

function isVideoFile(file: any): boolean {
  return /\.(mkv|mp4|m4v|mov|avi|ts|m2ts|webm)$/i.test(fileTitle(file));
}

function hasExplicitVideoFilename(file: any): boolean {
  return /\.(mkv|mp4|m4v|mov|avi|ts|m2ts|webm)$/i.test(String(file?.filename || file?.name || ""));
}

function hasVideoMimeType(file: any): boolean {
  return /^video\//i.test(String(file?.type || file?.content_type || file?.mime || file?.mimetype || ""));
}

function hasStrongVideoEvidence(file: any): boolean {
  return hasExplicitVideoFilename(file) || hasVideoMimeType(file);
}

function isAudioFile(file: any): boolean {
  const title = fileTitle(file);
  const type = String(file?.type || file?.content_type || file?.mime || file?.mimetype || "");
  return /\.(mp3|m4a|flac|aac|ogg|opus|wav|wma|alac)$/i.test(title) || /^audio\//i.test(type);
}

function isEpisodeFile(file: any, payload: ResolvePayload): boolean {
  const parsed = parseRelease(fileTitle(file));
  if (!payload.episode) return true;
  if (parsed.season === payload.season && parsed.episode === payload.episode) return true;
  if (parsed.season === payload.season && parsed.episodeRange && parsed.episodeRange.start <= payload.episode && parsed.episodeRange.end >= payload.episode) return true;
  if (parsed.absoluteEpisode === payload.episode) return true;
  return false;
}

function isArchiveUrl(url: string): boolean {
  try {
    const pathname = decodeURIComponent(new URL(url).pathname);
    return /\.(?:rar|r\d{2}|7z(?:\.\d{3})?|zip|par2|sfv|nfo)(?:$|[/?#])/i.test(pathname);
  } catch {
    return false;
  }
}

function isArchiveFile(file: any): boolean {
  const title = fileTitle(file);
  const downloadUrl = fileDownloadUrl(file) || "";
  return /(?:^|[.\s_-])(?:rar|r\d{2}|7z(?:\.\d{3})?|zip|par2|sfv|nfo)(?:$|[.\s_-])/i.test(title)
    || isArchiveUrl(downloadUrl);
}

function selectPlayableFile(files: any[], payload: ResolvePayload): any {
  const playableFiles = files
    .filter(file => fileDownloadUrl(file))
    .filter(file => isVideoFile(file))
    .filter(file => hasStrongVideoEvidence(file))
    .filter(file => !isAudioFile(file));
  if (playableFiles.length === 0) return undefined;

  const requestedSeason = payload.season;
  const requestedEpisode = payload.episode;

  if (requestedEpisode) {
    const explicitExact = playableFiles.find((file: any) => {
      if (!hasExplicitVideoFilename(file)) return false;
      const parsed = parseRelease(fileTitle(file));
      return parsed.season === requestedSeason && parsed.episode === requestedEpisode;
    });
    if (explicitExact) return explicitExact;

    const exact = playableFiles.find((file: any) => {
      const parsed = parseRelease(fileTitle(file));
      return parsed.season === requestedSeason && parsed.episode === requestedEpisode;
    });
    if (exact) return exact;

    const range = playableFiles.find((file: any) => {
      const parsed = parseRelease(fileTitle(file));
      return parsed.season === requestedSeason && parsed.episodeRange && parsed.episodeRange.start <= requestedEpisode && parsed.episodeRange.end >= requestedEpisode;
    });
    if (range) return range;

    const absolute = playableFiles.find((file: any) => {
      const parsed = parseRelease(fileTitle(file));
      return parsed.absoluteEpisode === requestedEpisode;
    });
    if (absolute) return absolute;

    return undefined;
  }

  const explicitVideoFiles = playableFiles.filter(hasExplicitVideoFilename);
  if (explicitVideoFiles.length > 0) {
    return explicitVideoFiles.reduce((prev: any, current: any) => fileSize(prev) > fileSize(current) ? prev : current);
  }

  const likelyEpisodeFiles = playableFiles.filter(file => isEpisodeFile(file, payload));
  if (likelyEpisodeFiles.length === 1) return likelyEpisodeFiles[0];

  return undefined;
}

function selectTorBoxPlayableFile(files: TorBoxUsenetFile[], payload: ResolvePayload): TorBoxUsenetFile | undefined {
  const playableFiles = files
    .filter(file => file.id !== undefined && file.id !== null)
    .filter(file => isVideoFile(file))
    .filter(file => hasStrongVideoEvidence(file))
    .filter(file => !isAudioFile(file));
  if (playableFiles.length === 0) return undefined;

  if (payload.episode) {
    const exact = playableFiles.find(file => {
      const parsed = parseRelease(fileTitle(file));
      return parsed.season === payload.season && parsed.episode === payload.episode;
    });
    if (exact) return exact;

    const range = playableFiles.find(file => {
      const parsed = parseRelease(fileTitle(file));
      return parsed.season === payload.season
        && Boolean(parsed.episodeRange)
        && parsed.episodeRange!.start <= payload.episode!
        && parsed.episodeRange!.end >= payload.episode!;
    });
    if (range) return range;

    const absolute = playableFiles.find(file => parseRelease(fileTitle(file)).absoluteEpisode === payload.episode);
    if (absolute) return absolute;

    if (payload.seasonPack) {
      return playableFiles.reduce((prev, current) => fileSize(prev) > fileSize(current) ? prev : current);
    }

    return undefined;
  }

  return playableFiles.reduce((prev, current) => fileSize(prev) > fileSize(current) ? prev : current);
}

function selectTorrentLink(links: string[]): string | undefined {
  return links.find(link => /\.(?:mkv|mp4|m4v|avi|mov|ts|m2ts)(?:$|[/?#&])/i.test(link)) || links[0];
}

function usenetFilesFromAddResponse(addData: any): any[] {
  const candidates = [
    addData?.files,
    addData?.data?.files,
    addData?.result?.files,
    addData?.download?.files,
    addData?.item?.files
  ];
  return candidates.find(Array.isArray) || [];
}

function deepbridAddErrorMessage(addData: any): string {
  return String(
    addData?.message
    || addData?.error_message
    || addData?.msg
    || addData?.error
    || "Failed to add or resolve Usenet link on Deepbrid."
  );
}

function deepbridAddErrorCategory(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "unknown");
  if (/archive/i.test(message)) return "archive_parts";
  if (/timeout|aborted/i.test(message)) return "timeout";
  if (/internal server error|http_5|statusCode\":5/i.test(message)) return "deepbrid_5xx";
  if (/not found|http_404|statusCode\":404/i.test(message)) return "fetch_404";
  if (/no playable/i.test(message)) return "no_playable_file";
  if (/auth|token|credential|401|403/i.test(message)) return "auth";
  return "other";
}

async function resolveNzbToPlayableUrl(client: DeepbridClient, payload: ResolvePayload, addTimeoutMs = 25000): Promise<string> {
  const cacheKey = resolveCacheKey(payload);
  const cached = resolveCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const existing = resolveInflight.get(cacheKey);
  if (existing) return existing;

  const promise = (async () => {
    const addData = await client.addUsenetByUrl(payload.nzbUrl, addTimeoutMs) as any;
    const files = usenetFilesFromAddResponse(addData);
    
    if (addData.error || files.length === 0) {
      throw new Error(deepbridAddErrorMessage(addData));
    }

    if (files.length > 0 && files.every(isArchiveFile)) {
      throw new Error("archive_parts_only");
    }

    const playableFile = selectPlayableFile(files, payload);
    const playableDownloadUrl = playableFile ? fileDownloadUrl(playableFile) : undefined;
    
    if (!playableFile || !playableDownloadUrl) {
      throw new Error("No playable video file found in this NZB.");
    }

    const playableUrl = normalizePlayableUrl(String(playableDownloadUrl));
    if (resolveTtlMs > 0) {
      resolveCache.set(cacheKey, { url: playableUrl, expiresAt: Date.now() + resolveTtlMs });
    }
    return playableUrl;
  })();

  resolveInflight.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    resolveInflight.delete(cacheKey);
  }
}

async function resolvePreparedNzbToPlayableUrl(client: DeepbridClient, payload: ResolvePayload, addTimeoutMs = 25000, userConfig?: any, requestBaseUrl?: string): Promise<string> {
  const preparedPayload = requestBaseUrl
    ? await prepareNzbUrlForDeepbrid(payload, userConfig, requestBaseUrl)
    : payload;
  return resolveNzbToPlayableUrl(client, preparedPayload, addTimeoutMs);
}

function torBoxApiKey(userConfig?: any): string {
  return String(userConfig?.torboxApiKey || process.env.TORBOX_API_KEY || "").trim();
}

function torBoxEnabled(userConfig?: any): boolean {
  return userConfig?.torboxEnabled === true && Boolean(torBoxApiKey(userConfig));
}

function torBoxItemReady(item: TorBoxUsenetItem): boolean {
  const state = String(item.download_state || "").toLowerCase();
  return Boolean(
    item.download_finished
    || item.download_present
    || item.cached
    || state === "completed"
    || state === "cached"
  );
}

function torBoxItemId(item: TorBoxUsenetItem): string | undefined {
  const id = item.id ?? item.usenet_id;
  return id === undefined || id === null ? undefined : String(id);
}

function torBoxAddErrorMessage(addData: any): string {
  return String(
    addData?.detail
    || addData?.error
    || addData?.message
    || "TorBox failed to add or resolve the NZB."
  );
}

function torBoxAddErrorCategory(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "unknown");
  if (/cache|cached|not.*found/i.test(message)) return "not_cached";
  if (/timeout|aborted/i.test(message)) return "timeout";
  if (/auth|token|credential|401|403/i.test(message)) return "auth";
  if (/no playable/i.test(message)) return "no_playable_file";
  return "torbox";
}

function findTorBoxItemByName(items: TorBoxUsenetItem[], title?: string): TorBoxUsenetItem | undefined {
  if (!title) return undefined;
  const wanted = title.toLowerCase();
  return items.find(item => String(item.name || "").toLowerCase() === wanted)
    || items.find(item => String(item.name || "").toLowerCase().includes(wanted.slice(0, 80)));
}

async function waitForTorBoxItem(client: TorBoxClient, itemId: string | undefined, payload: ResolvePayload, userConfig?: any): Promise<TorBoxUsenetItem> {
  const defaultPollTimeout = userConfig?.torboxPrecacheUncached === true ? 45000 : 18000;
  const timeoutMs = Math.max(1000, Number(userConfig?.torboxPollTimeout || process.env.TORBOX_POLL_TIMEOUT || defaultPollTimeout) || defaultPollTimeout);
  const intervalMs = Math.max(750, Number(userConfig?.torboxPollInterval || process.env.TORBOX_POLL_INTERVAL || 2500) || 2500);
  const startedAt = Date.now();
  let lastItem: TorBoxUsenetItem | undefined;

  while (Date.now() - startedAt < timeoutMs) {
    const data = await client.getUsenetList(itemId, Math.min(12000, Math.max(3000, intervalMs + 2500)));
    const items = torBoxDataItems(data);
    lastItem = itemId ? items[0] : findTorBoxItemByName(items, payload.title);
    if (lastItem && torBoxItemReady(lastItem) && Array.isArray(lastItem.files) && lastItem.files.length > 0) {
      return lastItem;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  throw new Error(`torbox_timeout:${lastItem?.download_state || "unknown"}`);
}

async function resolveNzbToTorBoxPlayableUrl(payload: ResolvePayload, userConfig?: any, requestBaseUrl?: string): Promise<string> {
  const apiKey = torBoxApiKey(userConfig);
  if (!apiKey) throw new Error("torbox_missing_api_key");

  const client = new TorBoxClient(apiKey);
  const preparedPayload = requestBaseUrl
    ? await prepareNzbUrlForDeepbrid(payload, userConfig, requestBaseUrl)
    : payload;
  const configuredTimeout = Number(userConfig?.torboxTimeout || process.env.TORBOX_TIMEOUT || 45000) || 45000;
  const addData = await client.createUsenetDownloadFromLink({
    link: preparedPayload.nzbUrl,
    name: preparedPayload.title,
    cacheOnly: false,
    timeoutMs: configuredTimeout
  }) as any;

  if (addData?.success === false) {
    throw new Error(torBoxAddErrorMessage(addData));
  }

  const dataItems = torBoxDataItems(addData);
  const firstItem = dataItems[0];
  const itemId = torBoxItemId(firstItem || {});
  const item = firstItem && torBoxItemReady(firstItem) && Array.isArray(firstItem.files) && firstItem.files.length > 0
    ? firstItem
    : await waitForTorBoxItem(client, itemId, preparedPayload, userConfig);

  const playableFile = selectTorBoxPlayableFile(item.files || [], preparedPayload);
  if (!playableFile?.id) {
    throw new Error("No playable video file found in this TorBox NZB.");
  }
  const usenetId = torBoxItemId(item);
  if (!usenetId) throw new Error("torbox_missing_usenet_id");
  return client.requestDownloadPermalink(usenetId, playableFile.id);
}

function torBoxFastPregrabConfig(userConfig: any, timeoutMs: number): any {
  if (!userConfig) return userConfig;
  const cappedTimeout = Math.max(2500, Math.min(timeoutMs + 1500, 9000));
  const configuredTorboxTimeout = Number(userConfig?.torboxTimeout || process.env.TORBOX_TIMEOUT || 45000) || 45000;
  const configuredPollTimeout = Number(userConfig?.torboxPollTimeout || process.env.TORBOX_POLL_TIMEOUT || 18000) || 18000;
  return {
    ...userConfig,
    torboxPrecacheUncached: false,
    torboxTimeout: Math.min(configuredTorboxTimeout, cappedTimeout),
    torboxPollTimeout: Math.min(configuredPollTimeout, cappedTimeout),
    torboxPollInterval: Math.min(Number(userConfig?.torboxPollInterval || process.env.TORBOX_POLL_INTERVAL || 1000) || 1000, 1000)
  };
}

async function resolvePreparedCandidateToPlayableUrl(client: DeepbridClient, candidate: SourceCandidate, payload: ResolvePayload, addTimeoutMs = 25000, userConfig?: any, requestBaseUrl?: string, fastTorbox = false): Promise<{ url: string; service: "deepbrid" | "torbox" }> {
  const attempts: Array<Promise<{ url: string; service: "deepbrid" | "torbox" }>> = [
    resolvePreparedNzbToPlayableUrl(client, payload, addTimeoutMs, userConfig, requestBaseUrl)
      .then(url => ({ url, service: "deepbrid" as const }))
  ];

  if (torBoxEnabled(userConfig) && candidate.origin !== "deepbrid-usenet-finder") {
    const torboxConfig = fastTorbox ? torBoxFastPregrabConfig(userConfig, addTimeoutMs) : userConfig;
    attempts.push(
      resolveNzbToTorBoxPlayableUrl(payload, torboxConfig, requestBaseUrl)
        .then(url => ({ url, service: "torbox" as const }))
    );
  }

  return Promise.any(attempts);
}

function candidateToResolvePayload(candidate: SourceCandidate): ResolvePayload | null {
  if (!candidate.nzbUrl) return null;
  return {
    nzbUrl: candidate.nzbUrl,
    season: candidate.season,
    episode: candidate.episode,
    absoluteEpisode: candidate.absoluteEpisode,
    seasonPack: candidate.seasonPack,
    title: candidate.title
  };
}

function sourceKey(candidate: SourceCandidate): string {
  const displayMatch = candidate.displayName.match(/^\[([^\]]+)\]/);
  return displayMatch?.[1] || candidate.origin;
}

function isEasynewsCandidate(candidate: SourceCandidate): boolean {
  return sourceKey(candidate).toLowerCase().includes("easynews");
}

function interleaveCandidatesBySource(candidates: SourceCandidate[], limit: number): SourceCandidate[] {
  const grouped = new Map<string, SourceCandidate[]>();
  for (const candidate of candidates) {
    const key = sourceKey(candidate).toLowerCase();
    const group = grouped.get(key) || [];
    group.push(candidate);
    grouped.set(key, group);
  }

  const groups = Array.from(grouped.values());
  const selected: SourceCandidate[] = [];
  let round = 0;
  while (selected.length < limit) {
    let added = false;
    for (const group of groups) {
      const candidate = group[round];
      if (!candidate) continue;
      selected.push(candidate);
      added = true;
      if (selected.length >= limit) break;
    }
    if (!added) break;
    round++;
  }
  return selected;
}

function directModeCandidates(candidates: SourceCandidate[], limit: number): SourceCandidate[] {
  const easynewsCandidates = candidates.filter(isEasynewsCandidate).slice(0, 2);
  const nonEasynews = candidates.filter(candidate => !isEasynewsCandidate(candidate));
  const newshosting = nonEasynews.filter(candidate => candidate.origin === "newshosting-direct");
  const otherCandidates = nonEasynews.filter(candidate => candidate.origin !== "newshosting-direct");
  if (newshosting.length === 0) {
    return [
      ...easynewsCandidates,
      ...interleaveCandidatesBySource(otherCandidates, Math.max(0, limit - easynewsCandidates.length))
    ];
  }

  const selected: SourceCandidate[] = [...easynewsCandidates];
  const otherGroups = new Map<string, SourceCandidate[]>();
  for (const candidate of otherCandidates) {
    const key = sourceKey(candidate).toLowerCase();
    const group = otherGroups.get(key) || [];
    group.push(candidate);
    otherGroups.set(key, group);
  }
  const groups = Array.from(otherGroups.values());

  let round = 0;
  while (selected.length < limit) {
    let added = false;
    for (let offset = 0; offset < 2; offset++) {
      const candidate = newshosting[(round * 2) + offset];
      if (!candidate) continue;
      selected.push(candidate);
      added = true;
      if (selected.length >= limit) break;
    }
    if (selected.length >= limit) break;
    for (const group of groups) {
      const candidate = group[round];
      if (!candidate) continue;
      selected.push(candidate);
      added = true;
      if (selected.length >= limit) break;
    }
    if (!added) break;
    round++;
  }

  return selected;
}

async function pregrabExternalCandidates(client: DeepbridClient, candidates: SourceCandidate[], mode: "direct" | "prechecked" = "direct", userConfig?: any, requestBaseUrl?: string, budgetMs?: number): Promise<SourceCandidate[]> {
  const startedAt = Date.now();
  const directMode = mode === "direct";
  const hasGeneratedNzbCandidates = candidates.some(candidate => candidate.origin === "newshosting-direct" || candidate.origin === "nexus-miatrix");
  const configuredDeadlineMs = directMode
    ? Math.max(8000, Math.min(Number(userConfig?.pregrabDeadlineMs || process.env.DEEPBRIDGE_PREGRAB_DEADLINE_MS || (hasGeneratedNzbCandidates ? 30000 : 18000)) || 30000, 45000))
    : 22000;
  const deadlineMs = Math.max(1000, Math.min(configuredDeadlineMs, Number(budgetMs || configuredDeadlineMs) || configuredDeadlineMs));
  const maxAttempts = directMode
    ? Math.max(4, Math.min(Number(userConfig?.pregrabMaxAttempts || process.env.DEEPBRIDGE_PREGRAB_MAX_ATTEMPTS || (hasGeneratedNzbCandidates ? 14 : 8)) || 14, 24))
    : 48;
  const maxReady = directMode
    ? Math.max(1, Math.min(Number(userConfig?.pregrabMaxReady || process.env.DEEPBRIDGE_PREGRAB_MAX_READY || 3) || 3, 8))
    : 24;
  const sortedCandidates = candidates
    .filter(candidate => candidate.origin !== "deepbrid-official")
    .sort((a, b) => b.score - a.score);
  const externalCandidates = directMode
    ? directModeCandidates(sortedCandidates, maxAttempts)
    : sortedCandidates.slice(0, maxAttempts);
  const readyCandidates: SourceCandidate[] = [];
  const concurrency = directMode
    ? Math.max(2, Math.min(Number(userConfig?.pregrabConcurrency || process.env.DEEPBRIDGE_PREGRAB_CONCURRENCY || 4) || 4, 6))
    : 4;
  const stats = {
    mode,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: "",
    totalCandidates: candidates.length,
    attempted: 0,
    ready: 0,
    failed: 0,
    skipped: 0,
    skippedArchives: 0,
    deadlineMs,
    maxAttempts,
    maxReady,
    concurrency,
    bySource: {} as Record<string, { attempted: number; ready: number; failed: number; skipped: number; errors?: Record<string, number> }>
  };
  let index = 0;

  function sourceStats(candidate: SourceCandidate) {
    const key = sourceKey(candidate);
    stats.bySource[key] ||= { attempted: 0, ready: 0, failed: 0, skipped: 0, errors: {} };
    return stats.bySource[key];
  }

  function addTimeoutFor(candidate: SourceCandidate): number {
    const source = sourceKey(candidate).toLowerCase();
    if (source.includes("easynews")) return directMode ? 18000 : 16000;
    const userResolveTimeout = userConfig?.resolveTimeout;
    if (userResolveTimeout && Number.isFinite(userResolveTimeout) && userResolveTimeout > 0) return userResolveTimeout;
    return directMode ? parseInt(process.env.DEEPBRID_RESOLVE_TIMEOUT || "4500") : parseInt(process.env.DEEPBRID_RESOLVE_TIMEOUT_PRECHECKED || "7000");
  }

  async function worker() {
    while (index < externalCandidates.length && readyCandidates.length < maxReady && Date.now() - startedAt < deadlineMs) {
      const candidate = externalCandidates[index++];
      const payload = candidateToResolvePayload(candidate);
      if (!payload) {
        stats.skipped++;
        sourceStats(candidate).skipped++;
        continue;
      }

      try {
        stats.attempted++;
        sourceStats(candidate).attempted++;
        const remainingMs = deadlineMs - (Date.now() - startedAt) - 250;
        if (remainingMs <= 500) break;
        const resolved = await resolvePreparedCandidateToPlayableUrl(client, candidate, payload, Math.min(addTimeoutFor(candidate), remainingMs), userConfig, requestBaseUrl, directMode);
        const playableUrl = resolved.url;
        if (isArchiveUrl(playableUrl)) {
          stats.skippedArchives++;
          sourceStats(candidate).skipped++;
          continue;
        }

        readyCandidates.push({
          ...candidate,
          status: "ready",
          playableUrl,
          sourceService: resolved.service,
          score: candidate.score + 5000
        });
        stats.ready++;
        sourceStats(candidate).ready++;
      } catch (error) {
        const failureCategory = error instanceof AggregateError
          ? error.errors.map((err: unknown) => {
              const deepbridCategory = deepbridAddErrorCategory(err);
              const torboxCategory = torBoxAddErrorCategory(err);
              return torboxCategory !== "torbox" ? `torbox_${torboxCategory}` : deepbridCategory;
            }).join("+")
          : deepbridAddErrorCategory(error);
        if (failureCategory === "archive_parts") {
          stats.skippedArchives++;
          const source = sourceStats(candidate);
          source.skipped++;
          source.errors ||= {};
          source.errors[failureCategory] = (source.errors[failureCategory] || 0) + 1;
          continue;
        }
        stats.failed++;
        const source = sourceStats(candidate);
        source.failed++;
        source.errors ||= {};
        source.errors[failureCategory] = (source.errors[failureCategory] || 0) + 1;
        // Invalid or unresolved indexer results are intentionally hidden.
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, externalCandidates.length) }, worker));
  stats.finishedAt = new Date().toISOString();
  lastPregrabStats = stats;
  return readyCandidates;
}

app.get("/:token/finder-auth", async (request, reply) => {
  const { token } = request.params as { token: string };
  const config = bridgeConfigOrReply(token, reply);
  if (!config) return;
  reply.type("text/html").send(`<!doctype html><html><head><meta charset="utf-8"><title>Deepbridge Browser Pairing</title></head><body><main><h1>Deepbrid Browser Pairing</h1><p>Open this page with the Deepbridge Finder Bridge extension installed. The extension will pair this browser configuration automatically.</p><p id="status">Waiting for the extension.</p></main><script>setTimeout(() => { document.getElementById('status').textContent = 'If this remains unchanged, install or enable the extension and reload this page.'; }, 2500);</script></body></html>`);
});

app.post("/:token/finder-bridge/pair", async (request, reply) => {
  const config = bridgeConfigOrReply((request.params as any).token, reply);
  if (!config) return;
  if (!pairBrowserBridge(config)) return reply.status(403).send({ error: "browser_bridge_pair_rejected" });
  return { ...browserBridgeStatus(config) };
});

app.get("/:token/finder-bridge/status", async (request, reply) => {
  const config = bridgeConfigOrReply((request.params as any).token, reply);
  if (!config) return;
  return browserBridgeStatus(config);
});

app.get("/:token/finder-bridge/poll", async (request, reply) => {
  const config = bridgeConfigOrReply((request.params as any).token, reply);
  if (!config) return;
  const requestItem = (request.query as any)?.wait === "1" ? await waitForBrowserBridgeRequest(config) : pollBrowserBridge(config);
  return { request: requestItem || null, ...browserBridgeStatus(config) };
});

app.post("/:token/finder-bridge/respond", async (request, reply) => {
  const config = bridgeConfigOrReply((request.params as any).token, reply);
  if (!config) return;
  const body = request.body as any;
  const accepted = respondBrowserBridge(config, String(body?.id || ""), Number(body?.statusCode), String(body?.text || ""));
  return accepted ? { accepted: true } : reply.status(404).send({ error: "browser_bridge_request_not_found" });
});

// Public Stremio routes
app.get("/manifest.json", async (request, reply) => {
  return { 
    ...manifest, 
    logo: `https://www.deepbrid.com/file/get/path/banners.5ea0998723b53/i/236387`,
    background: `https://www.deepbrid.com/file/get/path/banners.5ea0998723b53/i/236387`
  };
});

app.get("/:token/manifest.json", async (request, reply) => {
  // If the token is a valid config, we could dynamically modify the manifest name
  const config = decodeConfig((request.params as any).token);
  const baseManifest = { 
    ...manifest, 
    logo: `https://www.deepbrid.com/file/get/path/banners.5ea0998723b53/i/236387`,
    background: `https://www.deepbrid.com/file/get/path/banners.5ea0998723b53/i/236387`
  };
  
  if (config) {
    return { 
      ...baseManifest, 
      name: "Deepbridge (Custom)",
      behaviorHints: {
        configurable: true,
        configurationRequired: false
      }
    };
  }
  return baseManifest;
});

app.get("/catalog/:type/:id.json", async (request) => {
  const { id } = request.params as { type: string; id: string };
  return handleLibraryCatalog(undefined, id, request.query);
});

app.get("/:token/catalog/:type/:id.json", async (request) => {
  const { token, id } = request.params as { token: string; type: string; id: string };
  return handleLibraryCatalog(token, id, request.query);
});

app.get("/meta/:type/:id.json", async (request, reply) => {
  const { id } = request.params as { type: string; id: string };
  const result = await handleLibraryMeta(undefined, id);
  return result || reply.status(404).send({ meta: null });
});

app.get("/:token/meta/:type/:id.json", async (request, reply) => {
  const { token, id } = request.params as { token: string; type: string; id: string };
  const result = await handleLibraryMeta(token, id);
  return result || reply.status(404).send({ meta: null });
});

async function handleStreamRequest(media: MediaRequest, dynamicBaseUrl: string, token?: string) {
  try {
    let apiKey = "";
    let userConfig: any = null;

    if (token) {
      userConfig = decodeConfig(token);
    }

    if (userConfig && userConfig.deepbridApiKey) {
      apiKey = userConfig.deepbridApiKey;
    } else {
      apiKey = process.env.DEEPBRID_API_KEY || "";
    }
    
    // If no config provided at all (and no fallback), we can't do anything
    if (!apiKey) {
      return { streams: [] };
    }
    const client = new DeepbridClient(apiKey);

    const publicToken = token || "default_token";
    const startedAt = Date.now();
    const totalBudgetMs = streamBudgetMs(userConfig);
    const deadlineAt = startedAt + totalBudgetMs;
    const sourceBudgetMs = Math.max(3500, Math.min(Number(userConfig?.sourceGatherTimeoutMs || process.env.DEEPBRIDGE_SOURCE_GATHER_TIMEOUT_MS || 9500) || 9500, totalBudgetMs - 4500));
    const sourcePromises = [
      getOfficialDeepbridSources(client, media, userConfig),
      getDeepbridUsenetFinderSources(media, userConfig),
      getIndexerSources(client, media, userConfig),
      getEasynewsDirectSources(media, userConfig),
      getNewshostingSources(media, userConfig, dynamicBaseUrl, publicToken),
      getNexusMiatrixSources(media, userConfig, dynamicBaseUrl, publicToken),
      getTorrentSources(client, media, userConfig, dynamicBaseUrl, publicToken),
      getUpstreamAddonSources(media, userConfig, dynamicBaseUrl, publicToken)
    ];
    const [officialResult, finderResult, indexerResult, easynewsResult, newshostingResult, nexusResult, torrentResult, upstreamAddonResult] = await allSettledWithin(sourcePromises, sourceBudgetMs);
    const officialCandidates = officialResult.status === "fulfilled" ? officialResult.value : [];
    const finderCandidates = finderResult.status === "fulfilled" ? finderResult.value : [];
    const indexerCandidates = indexerResult.status === "fulfilled" ? indexerResult.value : [];
    const easynewsDirectCandidates = easynewsResult.status === "fulfilled" ? easynewsResult.value : [];
    const newshostingCandidates = newshostingResult.status === "fulfilled" ? newshostingResult.value : [];
    const nexusCandidates = nexusResult.status === "fulfilled" ? nexusResult.value : [];
    const torrentCandidates = torrentResult.status === "fulfilled" ? torrentResult.value : [];
    const upstreamAddonCandidates = upstreamAddonResult.status === "fulfilled" ? upstreamAddonResult.value : [];
    const externalMode = userConfig?.externalResultMode === "prechecked" ? "prechecked" : "direct";
    const directLinksOnly = userConfig?.directLinksOnly !== false;
    const pregrabCandidates = directLinksOnly || userConfig?.newshostingPrecheck === true
      ? [...indexerCandidates, ...newshostingCandidates, ...nexusCandidates]
      : indexerCandidates;
    const remainingBudgetMs = Math.max(1000, deadlineAt - Date.now() - 750);
    const readyIndexerCandidates = await pregrabExternalCandidates(client, pregrabCandidates, externalMode, userConfig, dynamicBaseUrl, remainingBudgetMs);
    const externalCandidates = directLinksOnly
      ? readyIndexerCandidates
      : externalMode === "direct"
      ? [
          ...indexerCandidates.filter(candidate => !isEasynewsCandidate(candidate)),
          ...newshostingCandidates,
          ...nexusCandidates,
          ...readyIndexerCandidates
        ]
      : [
          ...readyIndexerCandidates,
          ...newshostingCandidates,
          ...nexusCandidates
        ];
    
    const candidateGroups = directLinksOnly
      ? [
          dedupeCandidates(officialCandidates),
          dedupeCandidates(finderCandidates),
          dedupeCandidates(externalCandidates),
          dedupeCandidates(easynewsDirectCandidates),
          dedupeCandidates(torrentCandidates),
          dedupeCandidates(upstreamAddonCandidates)
        ]
      : [
          dedupeCandidates([
            ...officialCandidates,
            ...finderCandidates,
            ...externalCandidates,
            ...easynewsDirectCandidates,
            ...torrentCandidates,
            ...upstreamAddonCandidates
          ])
        ];
    const candidates = candidateGroups.flat()
      .filter(candidate => !directLinksOnly || Boolean(candidate.playableUrl));
    const streams = formatStreams(candidates, dynamicBaseUrl, token);
    app.log.info({
      event: "stream_budget",
      mediaType: media.type,
      id: media.type === "series" ? `${media.imdbId}:${media.season}:${media.episode}` : media.imdbId,
      totalBudgetMs,
      sourceBudgetMs,
      elapsedMs: Date.now() - startedAt,
      sourceTimeouts: [officialResult, finderResult, indexerResult, easynewsResult, newshostingResult, nexusResult, torrentResult, upstreamAddonResult].filter(result => result.status === "timeout").length,
      candidates: candidates.length,
      streams: streams.length
    });
    
    // Fallback if empty
    if (streams.length === 0) {
      return { streams: [] };
    }

    return { streams };
  } catch (error) {
    app.log.error(error);
    return { streams: [] };
  }
}

function parseSeriesRouteId(id: string): { imdbId: string; season: number; episode: number } {
  const parts = id.split(":");
  const episode = parseInt(parts.pop() || "", 10);
  const season = parseInt(parts.pop() || "", 10);
  return {
    imdbId: parts.join(":"),
    season,
    episode
  };
}

app.get("/stream/movie/:imdbId.json", async (request, reply) => {
  const { imdbId } = request.params as { imdbId: string };
  if (isLibraryItemId(imdbId)) return handleLibraryStream(undefined, imdbId, getRequestBaseUrl(request));
  app.log.info({ event: "stream_request", mediaType: "movie", imdbId });
  const dynamicBaseUrl = getRequestBaseUrl(request);
  return await handleStreamRequest({ type: "movie", imdbId }, dynamicBaseUrl);
});

app.get("/stream/series/:id.json", async (request, reply) => {
  const { id } = request.params as { id: string };
  if (isLibraryItemId(id)) return handleLibraryStream(undefined, id, getRequestBaseUrl(request));
  app.log.info({ event: "stream_request", mediaType: "series", id });
  
  const dynamicBaseUrl = getRequestBaseUrl(request);
  const { imdbId, season, episode } = parseSeriesRouteId(id);
  return await handleStreamRequest({ 
    type: "series", 
    imdbId, 
    season, 
    episode 
  }, dynamicBaseUrl);
});

app.get("/:token/stream/movie/:imdbId.json", async (request, reply) => {
  const { token, imdbId } = request.params as { token: string, imdbId: string };
  if (isLibraryItemId(imdbId)) return handleLibraryStream(token, imdbId, getRequestBaseUrl(request));
  app.log.info({ event: "stream_request", mediaType: "movie", imdbId });
  const dynamicBaseUrl = getRequestBaseUrl(request);
  return await handleStreamRequest({ type: "movie", imdbId }, dynamicBaseUrl, token);
});

app.get("/:token/stream/series/:id.json", async (request, reply) => {
  const { token, id } = request.params as { token: string, id: string };
  if (isLibraryItemId(id)) return handleLibraryStream(token, id, getRequestBaseUrl(request));
  app.log.info({ event: "stream_request", mediaType: "series", id });
  
  const dynamicBaseUrl = getRequestBaseUrl(request);
  const { imdbId, season, episode } = parseSeriesRouteId(id);
  return await handleStreamRequest({ 
    type: "series", 
    imdbId, 
    season, 
    episode 
  }, dynamicBaseUrl, token);
});

app.get("/health", async () => {
  return {
    status: "ok",
    cache: cacheHealth(),
    deepbrid: await deepbridHealth(process.env.DEEPBRID_API_KEY || "")
  };
});

app.get("/:token/health", async (request) => {
  const { token } = request.params as { token: string };
  const userConfig = decodeConfig(token);
  const apiKey = userConfig?.deepbridApiKey || process.env.DEEPBRID_API_KEY || "";
  return {
    status: "ok",
    cache: cacheHealth(),
    deepbrid: await deepbridHealth(apiKey),
    config: {
      hasTokenConfig: Boolean(userConfig),
      externalResultMode: userConfig?.externalResultMode || "direct",
      directLinksOnly: userConfig?.directLinksOnly !== false,
      indexers: Array.isArray(userConfig?.indexers) ? userConfig.indexers.length : 0,
      easynewsDirectConfigured: Boolean(userConfig?.easynewsUsername && userConfig?.easynewsPassword),
      easynewsDirectEnabled: Boolean(userConfig?.easynewsEnabled !== false && userConfig?.easynewsUsername && userConfig?.easynewsPassword),
      newshostingDirectConfigured: Boolean(userConfig?.newshostingUsername && userConfig?.newshostingPassword),
      newshostingDirectEnabled: Boolean(userConfig?.newshostingEnabled !== false && userConfig?.newshostingUsername && userConfig?.newshostingPassword),
      nexusMiatrixConfigured: Boolean((userConfig?.nexusMiatrixCookie || process.env.NEXUS_MIATRIX_COOKIE) || ((userConfig?.nexusMiatrixEmail || process.env.NEXUS_MIATRIX_EMAIL) && (userConfig?.nexusMiatrixPassword || process.env.NEXUS_MIATRIX_PASSWORD))),
      nexusMiatrixEnabled: Boolean(userConfig?.nexusMiatrixEnabled !== false && ((userConfig?.nexusMiatrixCookie || process.env.NEXUS_MIATRIX_COOKIE) || ((userConfig?.nexusMiatrixEmail || process.env.NEXUS_MIATRIX_EMAIL) && (userConfig?.nexusMiatrixPassword || process.env.NEXUS_MIATRIX_PASSWORD)))),
      torboxConfigured: Boolean(torBoxApiKey(userConfig)),
      torboxEnabled: torBoxEnabled(userConfig),
      torboxPrecacheUncached: userConfig?.torboxPrecacheUncached === true,
      deepbridUsenetFinderConfigured: Boolean(userConfig?.deepbridWebCookie || process.env.DEEPBRID_WEB_COOKIE),
      deepbridUsenetFinderEnabled: Boolean(userConfig?.deepbridUsenetFinderEnabled !== false && (userConfig?.deepbridWebCookie || process.env.DEEPBRID_WEB_COOKIE)),
      deepbridLibraryEnabled: Boolean(userConfig?.deepbridLibraryEnabled !== false),
      externalTorrents: Array.isArray(userConfig?.externalTorrents) ? userConfig.externalTorrents.length : 0,
      stremioAddons: Array.isArray(userConfig?.stremioAddons) ? userConfig.stremioAddons.length : 0
    }
  };
});

app.get("/:token/torrent/play/:payload", async (request, reply) => {
  const { token, payload } = request.params as { token: string; payload: string };
  try {
    const userConfig = decodeConfig(token);
    const apiKey = userConfig?.deepbridApiKey || process.env.DEEPBRID_API_KEY || "";
    if (!apiKey) return reply.status(400).send("No API key");
    const decoded = decodeJsonPayload(payload);
    const client = new DeepbridClient(apiKey);
    const torrent = normalizeTorrent(await client.getTorrentInfo(String(decoded.id), Number(userConfig?.torrentInfoTimeout || 12000) || 12000));
    const link = selectTorrentLink(torrent.links);
    if (!link) return reply.status(404).send("Torrent links unavailable.");
    return reply.redirect(normalizePlayableUrl(link));
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send("Torrent playback unavailable.");
  }
});

app.get("/:token/torrent/add/:payload", async (request, reply) => {
  const { token, payload } = request.params as { token: string; payload: string };
  try {
    const userConfig = decodeConfig(token);
    const apiKey = userConfig?.deepbridApiKey || process.env.DEEPBRID_API_KEY || "";
    if (!apiKey) return reply.status(400).send("No API key");
    const decoded = decodeJsonPayload(payload);
    if (!decoded.magnet || !/^magnet:\?/i.test(String(decoded.magnet))) return reply.status(400).send("Invalid magnet");
    const client = new DeepbridClient(apiKey);
    const add = await client.addTorrentMagnet(String(decoded.magnet), Number(userConfig?.torrentAddTimeout || 25000) || 25000) as any;
    const id = String(add?.id || "");
    if (!id || Number(add?.error || 0) !== 0) return reply.status(502).send("Torrent add failed.");
    const torrent = normalizeTorrent(await client.getTorrentInfo(id, Number(userConfig?.torrentInfoTimeout || 15000) || 15000));
    const link = selectTorrentLink(torrent.links);
    if (!link) return reply.status(202).send("Torrent added but not ready yet.");
    return reply.redirect(normalizePlayableUrl(link));
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send("Torrent add unavailable.");
  }
});

app.get("/:token/newshosting/nzb/:encodedId", async (request, reply) => {
  const { token, encodedId } = request.params as { token: string, encodedId: string };
  try {
    const userConfig = decodeConfig(token);
    const nzb = await createNewshostingNzbIsolated(encodedId, userConfig);
    reply.header("Content-Type", "application/x-nzb; charset=utf-8");
    reply.header("Content-Disposition", "inline; filename=\"newshosting.nzb\"");
    return reply.send(nzb);
  } catch (err) {
    app.log.error(err);
    return reply.status(404).send("NZB unavailable.");
  }
});

app.get("/newshosting/cached/:cacheId", async (request, reply) => {
  const { cacheId } = request.params as { cacheId: string };
  const normalizedId = cacheId.replace(/\.nzb$/i, "");
  const entry = newshostingNzbCache.get(normalizedId);
  if (!entry || entry.expiresAt <= Date.now()) {
    newshostingNzbCache.delete(normalizedId);
    return reply.status(404).send("NZB expired.");
  }
  reply.header("Content-Type", "application/x-nzb; charset=utf-8");
  reply.header("Content-Disposition", "inline; filename=\"newshosting.nzb\"");
  return reply.send(entry.nzb);
});

app.get("/:token/nexus/nzb/:releaseHash", async (request, reply) => {
  const { token, releaseHash } = request.params as { token: string, releaseHash: string };
  try {
    const userConfig = decodeConfig(token);
    const nzb = await fetchNexusMiatrixNzb(releaseHash, userConfig);
    reply.header("Content-Type", "application/x-nzb; charset=utf-8");
    reply.header("Content-Disposition", "inline; filename=\"nexus-miatrix.nzb\"");
    return reply.send(nzb);
  } catch (err) {
    app.log.error(err);
    return reply.status(404).send("NZB unavailable.");
  }
});

app.get("/nexus/cached/:cacheId", async (request, reply) => {
  const { cacheId } = request.params as { cacheId: string };
  const normalizedId = cacheId.replace(/\.nzb$/i, "");
  const entry = nexusNzbCache.get(normalizedId);
  if (!entry || entry.expiresAt <= Date.now()) {
    nexusNzbCache.delete(normalizedId);
    return reply.status(404).send("NZB expired.");
  }
  reply.header("Content-Type", "application/x-nzb; charset=utf-8");
  reply.header("Content-Disposition", "inline; filename=\"nexus-miatrix.nzb\"");
  return reply.send(entry.nzb);
});

app.get("/:token/resolve/:encodedNzbUrl", async (request, reply) => {
  const { token, encodedNzbUrl } = request.params as { token: string, encodedNzbUrl: string };
  
  try {
    const payload = decodeResolvePayload(encodedNzbUrl);

    const userConfig = decodeConfig(token);
    const apiKey = userConfig?.deepbridApiKey || process.env.DEEPBRID_API_KEY || "";
    
    if (!apiKey) {
      return reply.status(400).send("No API key");
    }

    const client = new DeepbridClient(apiKey);
    const playableUrl = await resolvePreparedNzbToPlayableUrl(
      client,
      payload,
      Number(userConfig?.resolveTimeout || 25000) || 25000,
      userConfig,
      getRequestBaseUrl(request)
    );
    return reply.redirect(playableUrl);
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send("Internal error while resolving stream.");
  }
});

// Basic config page serving static html
app.get("/", async (request, reply) => {
  return reply.sendFile("index.html");
});

const start = async () => {
  try {
    const port = parseInt(process.env.PORT || "7000");
    await app.listen({ port, host: "0.0.0.0" });
    app.log.info(`Server listening on http://localhost:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
