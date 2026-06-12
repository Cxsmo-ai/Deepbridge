import { nanoid } from "nanoid";
import { MediaRequest } from "../deepbrid/apiClient";
import { makeMediaKey } from "../core/mediaKey";
import { parseRelease } from "../core/parseRelease";
import { MediaMetadata, normalizeComparableTitle, scoreReleaseMatch } from "../core/releaseMatch";
import { SourceCandidate } from "../core/types";
import { NewshostingClient, NewshostingOptions, NewshostingResult } from "./client";
import { request } from "undici";

type NewshostingStats = {
  startedAt: string;
  finishedAt: string;
  configured: boolean;
  mediaKey: string;
  plannedSearches: number;
  fulfilledSearches: number;
  failedSearches: number;
  rawItems: number;
  dedupedItems: number;
  filteredItems: number;
  selectedItems: number;
  candidates: number;
  errors: Record<string, number>;
};

let lastNewshostingStats: NewshostingStats = {
  startedAt: "",
  finishedAt: "",
  configured: false,
  mediaKey: "",
  plannedSearches: 0,
  fulfilledSearches: 0,
  failedSearches: 0,
  rawItems: 0,
  dedupedItems: 0,
  filteredItems: 0,
  selectedItems: 0,
  candidates: 0,
  errors: {}
};

export function getLastNewshostingStats(): NewshostingStats {
  return lastNewshostingStats;
}

function credentials(userConfig?: any) {
  const username = String(userConfig?.newshostingUsername || process.env.NEWSHOSTING_USERNAME || "").trim();
  const password = String(userConfig?.newshostingPassword || process.env.NEWSHOSTING_PASSWORD || "");
  const enabled = Boolean(userConfig?.newshostingEnabled !== false && username && password);
  return {
    enabled,
    username,
    password,
    host: String(userConfig?.newshostingHost || process.env.NEWSHOSTING_SERVER_HOST || "srv.aboutusenet.com"),
    ip: String(userConfig?.newshostingIp || process.env.NEWSHOSTING_SERVER_IP || "81.171.93.8"),
    port: Number(userConfig?.newshostingPort || process.env.NEWSHOSTING_SERVER_PORT || 5598) || 5598,
    maxNzbFiles: Number(userConfig?.newshostingMaxNzbFiles || process.env.NEWSHOSTING_MAX_NZB_FILES || 32) || 32
  };
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

function buildQueries(metadata: MediaMetadata, media: MediaRequest): string[] {
  const titles = buildQueryTitles(metadata, media);
  if (media.type === "series" && media.season && media.episode) {
    const code = `S${String(media.season).padStart(2, "0")}E${String(media.episode).padStart(2, "0")}`;
    return [...new Set(titles.flatMap(title => [`${title} ${code}`, title]))].slice(0, 4);
  }
  return [...new Set(titles.flatMap(title => metadata.year ? [`${title} ${metadata.year}`, title] : [title]))].slice(0, 4);
}

function errorCategory(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "unknown");
  if (/login|auth|credential/i.test(message)) return "auth";
  if (/timeout|aborted/i.test(message)) return "timeout";
  if (/connect|ENOTFOUND|ECONNREFUSED|ECONNRESET/i.test(message)) return "network";
  return "other";
}

function encodeId(result: NewshostingResult): string {
  return Buffer.from(JSON.stringify({
    i: result.index,
    s: result.scope,
    it: result.itemId,
    t: result.name,
    f: result.files
  })).toString("base64url");
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

function sizeLooksPlayable(size: number): boolean {
  if (!size) return true;
  const gb = size / 1073741824;
  return gb >= 0.25 && gb <= 90;
}

function fileCountPenalty(files: number): number {
  if (!files || files <= 1) return 0;
  if (files <= 4) return 80;
  if (files <= 12) return 260;
  if (files <= 24) return 520;
  return 1100;
}

function newshostingRankScore(result: NewshostingResult, matchScore: number): number {
  let score = matchScore;
  if (/\b(?:rifftrax|commentary|extras?|bonus|sample)\b/i.test(result.name)) score -= 900;
  if (looksLikeVideoRelease(result.name)) score += 220;
  if (/\.(?:mkv|mp4|m4v)(?:$|[\s._-])/i.test(result.name)) score += 240;
  if (result.files > 0) score -= fileCountPenalty(result.files);
  if (result.size > 0) {
    const gb = result.size / 1073741824;
    if (gb >= 1.5 && gb <= 35) score += 120;
    if (gb > 55) score -= 180;
  }
  return score;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function decodeNewshostingNzbId(encoded: string): { index: string; scope: string; itemId: string; title?: string; files?: number } {
  const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  if (!parsed?.i || !parsed?.s || !parsed?.it) throw new Error("invalid_newshosting_nzb_id");
  const files = Number(parsed.f);
  return {
    index: String(parsed.i),
    scope: String(parsed.s),
    itemId: String(parsed.it),
    title: parsed.t ? String(parsed.t) : undefined,
    files: Number.isFinite(files) ? files : undefined
  };
}

export async function createNewshostingNzb(encodedId: string, userConfig?: any): Promise<string> {
  const creds = credentials(userConfig);
  if (!creds.enabled) throw new Error("newshosting_not_configured");
  const id = decodeNewshostingNzbId(encodedId);
  if (id.files && id.files > creds.maxNzbFiles) {
    throw new Error("newshosting_nzb_too_many_files");
  }
  const timeoutMs = Number(
    userConfig?.newshostingNzbTimeout
    || userConfig?.newshostingTimeout
    || userConfig?.resolveTimeout
    || userConfig?.indexerTimeout
    || 30000
  ) || 30000;
  const client = new NewshostingClient({
    ...creds,
    timeoutMs
  });
  try {
    return await withTimeout((async () => {
      await client.connect();
      return await client.createNzb(id.index, id.scope, id.itemId);
    })(), timeoutMs, "newshosting_nzb_timeout");
  } finally {
    client.close();
  }
}

export async function getNewshostingSources(
  media: MediaRequest,
  userConfig: any,
  baseUrl: string,
  token: string
): Promise<SourceCandidate[]> {
  const startedAt = Date.now();
  const creds = credentials(userConfig);
  const stats: NewshostingStats = {
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: "",
    configured: creds.enabled,
    mediaKey: makeMediaKey(media),
    plannedSearches: 0,
    fulfilledSearches: 0,
    failedSearches: 0,
    rawItems: 0,
    dedupedItems: 0,
    filteredItems: 0,
    selectedItems: 0,
    candidates: 0,
    errors: {}
  };

  if (!creds.enabled) {
    stats.finishedAt = new Date().toISOString();
    lastNewshostingStats = stats;
    return [];
  }

  const metadata = await fetchMediaMetadata(media);
  const queries = buildQueries(metadata, media);
  stats.plannedSearches = queries.length;
  const seen = new Set<string>();
  const results: NewshostingResult[] = [];
  const options: NewshostingOptions = {
    ...creds,
    timeoutMs: Number(userConfig?.newshostingSearchTimeout || userConfig?.indexerTimeout || 8000) || 8000
  };

  const client = new NewshostingClient(options);
  try {
    await client.connect();
    for (const query of queries) {
      try {
        const response = await client.search(query, 1, 50);
      stats.fulfilledSearches++;
      for (const result of response.results) {
        stats.rawItems++;
        const key = `${result.index}_${result.scope}_${result.itemId}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push(result);
        }
      }
      } catch (error) {
        stats.failedSearches++;
        const category = errorCategory(error);
        stats.errors[category] = (stats.errors[category] || 0) + 1;
      }
    }
  } catch (error) {
    stats.failedSearches += Math.max(queries.length, 1);
    const category = errorCategory(error);
    stats.errors[category] = (stats.errors[category] || 0) + 1;
  } finally {
    client.close();
  }

  stats.dedupedItems = results.length;
  const candidates: SourceCandidate[] = [];
  const requestedMaxResults = Number(userConfig?.newshostingMaxResults || 12) || 12;
  const maxResults = Math.max(0, Math.min(userConfig?.directLinksOnly !== false ? Math.max(requestedMaxResults, 24) : requestedMaxResults, 40));
  const filtered = results
    .filter(result => result.name && result.index && result.scope && result.itemId && !isArchiveRelease(result.name))
    .filter(result => !result.files || result.files <= creds.maxNzbFiles)
    .filter(result => looksLikeVideoRelease(result.name))
    .filter(result => !hasBadReleaseSignal(result.name))
    .filter(result => sizeLooksPlayable(result.size));
  stats.filteredItems = filtered.length;

  const sorted = filtered
    .map(result => {
      const parsed = parseRelease(result.name);
      const match = scoreReleaseMatch(result.name, media, parsed, metadata);
      const rankScore = newshostingRankScore(result, match.score);
      return { result, parsed, match, rankScore };
    })
    .filter(item => item.match.score >= (media.type === "series" ? 650 : 600))
    .sort((a, b) => b.rankScore - a.rankScore || a.result.files - b.result.files || b.result.size - a.result.size)
    .slice(0, maxResults);

  stats.selectedItems = sorted.length;

  for (const item of sorted) {
    const nzbUrl = `${baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(token)}/newshosting/nzb/${encodeId(item.result)}`;
    candidates.push({
      id: nanoid(),
      mediaType: media.type,
      imdbId: media.imdbId,
      season: media.season,
      episode: media.episode,
      mediaKey: makeMediaKey(media),
      origin: "newshosting-direct",
      title: item.result.name,
      displayName: "[Newshosting]",
      status: "needs_deepbrid_submit",
      nzbUrl,
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
      sizeBytes: item.result.size,
      matchScore: item.match.score,
      matchReason: item.match.reason,
      score: 2500 + item.rankScore + (item.result.size / 1073741824),
      createdAt: new Date().toISOString()
    });
    stats.candidates++;
  }

  stats.finishedAt = new Date().toISOString();
  lastNewshostingStats = stats;
  return candidates;
}
