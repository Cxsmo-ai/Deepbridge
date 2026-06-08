import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyFormbody from "@fastify/formbody";
import fastifyCors from "@fastify/cors";
import path from "path";
import dotenv from "dotenv";

import { manifest } from "./stremio/manifest";
import { DeepbridClient, MediaRequest } from "./deepbrid/apiClient";
import { getOfficialDeepbridSources } from "./deepbrid/officialAddon";
import { formatStreams } from "./stremio/formatStreams";
import { getIndexerSources, getLastIndexerSearchStats } from "./indexer/search";
import { decodeConfig } from "./core/configDecoder";
import { dedupeCandidates } from "./core/releaseMatch";
import { parseRelease } from "./core/parseRelease";
import { SourceCandidate } from "./core/types";

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
  bySource: {} as Record<string, { attempted: number; ready: number; failed: number; skipped: number }>
};
// Final Deepbrid/myfast playback URLs can be short-lived or single-use.
// Keep only in-flight de-duping, not long-lived cached redirects.
const resolveTtlMs = 0;

function cacheHealth() {
  return {
    resolve: {
      entries: resolveCache.size,
      inflight: resolveInflight.size,
      ttlMs: resolveTtlMs
    },
    deepbridAdd: lastPregrabStats,
    indexerSearch: getLastIndexerSearchStats()
  };
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

function normalizePlayableUrl(url: string): string {
  return new URL(url, "https://www.deepbrid.com").toString();
}

function fileSize(file: any): number {
  const size = Number(file?.filesize || file?.size || 0);
  return Number.isFinite(size) ? size : 0;
}

function fileTitle(file: any): string {
  return String(file.filename || file.name || file.subject || "");
}

function isVideoFile(file: any): boolean {
  return /\.(mkv|mp4|m4v|mov|avi|ts|m2ts|webm)$/i.test(fileTitle(file));
}

function hasExplicitVideoFilename(file: any): boolean {
  return /\.(mkv|mp4|m4v|mov|avi|ts|m2ts|webm)$/i.test(String(file?.filename || file?.name || ""));
}

function hasVideoMimeType(file: any): boolean {
  return /^video\//i.test(String(file?.type || file?.content_type || file?.mime || ""));
}

function hasStrongVideoEvidence(file: any): boolean {
  return hasExplicitVideoFilename(file) || hasVideoMimeType(file);
}

function isAudioFile(file: any): boolean {
  const title = fileTitle(file);
  const type = String(file?.type || file?.content_type || file?.mime || "");
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

function selectPlayableFile(files: any[], payload: ResolvePayload): any {
  const playableFiles = files
    .filter(file => file?.download_url)
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
  }

  const explicitVideoFiles = playableFiles.filter(hasExplicitVideoFilename);
  if (explicitVideoFiles.length > 0) {
    return explicitVideoFiles.reduce((prev: any, current: any) => fileSize(prev) > fileSize(current) ? prev : current);
  }

  const likelyEpisodeFiles = playableFiles.filter(file => isEpisodeFile(file, payload));
  if (likelyEpisodeFiles.length === 1) return likelyEpisodeFiles[0];

  return undefined;
}

async function resolveNzbToPlayableUrl(client: DeepbridClient, payload: ResolvePayload, addTimeoutMs = 25000): Promise<string> {
  const cacheKey = resolveCacheKey(payload);
  const cached = resolveCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const existing = resolveInflight.get(cacheKey);
  if (existing) return existing;

  const promise = (async () => {
    const addData = await client.addUsenetByUrl(payload.nzbUrl, addTimeoutMs) as any;
    
    if (addData.error || !addData.files || addData.files.length === 0) {
      throw new Error("Failed to add or resolve Usenet link on Deepbrid.");
    }

    const playableFile = selectPlayableFile(addData.files, payload);
    
    if (!playableFile || !playableFile.download_url) {
      throw new Error("No playable video file found in this NZB.");
    }

    const playableUrl = normalizePlayableUrl(String(playableFile.download_url));
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

async function pregrabExternalCandidates(client: DeepbridClient, candidates: SourceCandidate[], mode: "direct" | "prechecked" = "direct"): Promise<SourceCandidate[]> {
  const startedAt = Date.now();
  const directMode = mode === "direct";
  const deadlineMs = directMode ? 22000 : 22000;
  const maxAttempts = directMode ? 14 : 48;
  const maxReady = directMode ? 8 : 24;
  const sortedCandidates = candidates
    .filter(candidate => candidate.origin !== "deepbrid-official")
    .sort((a, b) => b.score - a.score);
  const externalCandidates = directMode
    ? [
        ...sortedCandidates.filter(isEasynewsCandidate).slice(0, 2),
        ...sortedCandidates.filter(candidate => !isEasynewsCandidate(candidate)).slice(0, maxAttempts - 2)
      ]
    : sortedCandidates.slice(0, maxAttempts);
  const readyCandidates: SourceCandidate[] = [];
  const concurrency = directMode ? 3 : 4;
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
    bySource: {} as Record<string, { attempted: number; ready: number; failed: number; skipped: number }>
  };
  let index = 0;

  function sourceStats(candidate: SourceCandidate) {
    const key = sourceKey(candidate);
    stats.bySource[key] ||= { attempted: 0, ready: 0, failed: 0, skipped: 0 };
    return stats.bySource[key];
  }

  function addTimeoutFor(candidate: SourceCandidate): number {
    const source = sourceKey(candidate).toLowerCase();
    if (source.includes("easynews")) return directMode ? 18000 : 16000;
    return directMode ? 4500 : 7000;
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
        const playableUrl = await resolveNzbToPlayableUrl(client, payload, addTimeoutFor(candidate));
        if (isArchiveUrl(playableUrl)) {
          stats.skippedArchives++;
          sourceStats(candidate).skipped++;
          continue;
        }

        readyCandidates.push({
          ...candidate,
          status: "ready",
          playableUrl,
          score: candidate.score + 5000
        });
        stats.ready++;
        sourceStats(candidate).ready++;
      } catch {
        stats.failed++;
        sourceStats(candidate).failed++;
        // Invalid or unresolved indexer results are intentionally hidden.
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, externalCandidates.length) }, worker));
  stats.finishedAt = new Date().toISOString();
  lastPregrabStats = stats;
  return readyCandidates;
}

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

    const [officialResult, indexerResult] = await Promise.allSettled([
      getOfficialDeepbridSources(client, media, userConfig),
      getIndexerSources(client, media, userConfig)
    ]);
    const officialCandidates = officialResult.status === "fulfilled" ? officialResult.value : [];
    const indexerCandidates = indexerResult.status === "fulfilled" ? indexerResult.value : [];
    const externalMode = userConfig?.externalResultMode === "prechecked" ? "prechecked" : "direct";
    const readyIndexerCandidates = await pregrabExternalCandidates(client, indexerCandidates, externalMode);
    const externalCandidates = externalMode === "direct"
      ? [
          ...indexerCandidates.filter(candidate => !isEasynewsCandidate(candidate)),
          ...readyIndexerCandidates
        ]
      : readyIndexerCandidates;
    
    const candidates = dedupeCandidates([...officialCandidates, ...externalCandidates]);
    const streams = formatStreams(candidates, dynamicBaseUrl, token);
    
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
  app.log.info({ event: "stream_request", mediaType: "movie", imdbId });
  const dynamicBaseUrl = getRequestBaseUrl(request);
  return await handleStreamRequest({ type: "movie", imdbId }, dynamicBaseUrl);
});

app.get("/stream/series/:id.json", async (request, reply) => {
  const { id } = request.params as { id: string };
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
  app.log.info({ event: "stream_request", mediaType: "movie", imdbId });
  const dynamicBaseUrl = getRequestBaseUrl(request);
  return await handleStreamRequest({ type: "movie", imdbId }, dynamicBaseUrl, token);
});

app.get("/:token/stream/series/:id.json", async (request, reply) => {
  const { token, id } = request.params as { token: string, id: string };
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
      indexers: Array.isArray(userConfig?.indexers) ? userConfig.indexers.length : 0
    }
  };
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
    const playableUrl = await resolveNzbToPlayableUrl(client, payload);
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
