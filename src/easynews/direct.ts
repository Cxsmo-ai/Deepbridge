import { request } from "undici";
import { nanoid } from "nanoid";

import { MediaRequest } from "../deepbrid/apiClient";
import { makeMediaKey } from "../core/mediaKey";
import { parseRelease } from "../core/parseRelease";
import { MediaMetadata, normalizeComparableTitle, scoreReleaseMatch } from "../core/releaseMatch";
import { SourceCandidate } from "../core/types";

type EasynewsCredentials = {
  username: string;
  password: string;
};

type EasynewsRow = Record<string, any>;

type EasynewsSearchResponse = {
  results?: number;
  returned?: number;
  page?: number;
  perPage?: string;
  numPages?: number;
  dlFarm?: string;
  dlPort?: string | number;
  downURL?: string;
  data?: EasynewsRow[];
};

type EasynewsDirectStats = {
  startedAt: string;
  finishedAt: string;
  configured: boolean;
  mediaKey: string;
  plannedSearches: number;
  fulfilledSearches: number;
  failedSearches: number;
  rawItems: number;
  filteredItems: number;
  attemptedResolve: number;
  ready: number;
  failedResolve: number;
  errors: Record<string, number>;
};

let lastEasynewsDirectStats: EasynewsDirectStats = {
  startedAt: "",
  finishedAt: "",
  configured: false,
  mediaKey: "",
  plannedSearches: 0,
  fulfilledSearches: 0,
  failedSearches: 0,
  rawItems: 0,
  filteredItems: 0,
  attemptedResolve: 0,
  ready: 0,
  failedResolve: 0,
  errors: {}
};

export function getLastEasynewsDirectStats(): EasynewsDirectStats {
  return lastEasynewsDirectStats;
}

function basicAuth({ username, password }: EasynewsCredentials): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

function chickenlicker({ username, password }: EasynewsCredentials): string {
  return `${encodeURIComponent(username)}%3A${encodeURIComponent(password)}`;
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
      if (key && !seen.has(key) && !/^tt\d+$/i.test(key)) {
        seen.add(key);
        out.push(value);
      }
    }
  }
  return out.slice(0, 4);
}

function buildQueries(metadata: MediaMetadata, media: MediaRequest): string[] {
  const titles = queryTitles(metadata, media);
  const suffix = media.type === "series" && media.season && media.episode
    ? `S${String(media.season).padStart(2, "0")}E${String(media.episode).padStart(2, "0")}`
    : metadata.year ? String(metadata.year) : "";
  return [...new Set(titles.map(title => [title, suffix].filter(Boolean).join(" ")))].slice(0, 4);
}

async function searchEasynews(query: string, credentials: EasynewsCredentials): Promise<EasynewsSearchResponse> {
  const url = new URL("https://members.easynews.com/2.0/search/solr-search/advanced");
  url.search = new URLSearchParams({
    st: "adv",
    sb: "1",
    fex: "m4v,3gp,mov,divx,xvid,wmv,avi,mpg,mpeg,mp4,mkv,avc,flv,webm",
    "fty[]": "VIDEO",
    spamf: "1",
    u: "1",
    gx: "1",
    pno: "1",
    sS: "3",
    s1: "relevance",
    s1d: "-",
    s2: "dsize",
    s2d: "-",
    s3: "dtime",
    s3d: "-",
    pby: "50",
    safeO: "0",
    gps: query
  }).toString();

  const res = await request(url, {
    headers: {
      Authorization: basicAuth(credentials),
      Cookie: `chickenlicker=${chickenlicker(credentials)}`,
      "User-Agent": "Deepbridge EasynewsDirect"
    },
    signal: AbortSignal.timeout(22000)
  });
  if (res.statusCode === 401 || res.statusCode === 403) {
    throw new Error("easynews_auth_failed");
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`easynews_search_http_${res.statusCode}`);
  }
  return await res.body.json() as EasynewsSearchResponse;
}

function easynewsFileTitle(row: EasynewsRow): string {
  const title = String(row["10"] || row.name || row.title || "");
  const ext = String(row["11"] || row.ext || "");
  return title.endsWith(ext) ? title : `${title}${ext}`;
}

function easynewsSize(row: EasynewsRow): number {
  const raw = Number(row.rawSize || row.size || 0);
  if (Number.isFinite(raw) && raw > 0) return raw;
  const text = String(row["4"] || "");
  const match = text.match(/(\d+(?:\.\d+)?)\s*(gb|gib|mb|mib)\b/i);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  return Math.round(value * (match[2].toLowerCase().startsWith("g") ? 1073741824 : 1048576));
}

function isShortDuration(row: EasynewsRow): boolean {
  const duration = String(row["14"] || "");
  const seconds = duration.match(/^(\d+)s/i);
  if (seconds) return parseInt(seconds[1], 10) < 360;
  const minutes = duration.match(/^(\d+)m/i);
  if (minutes) return parseInt(minutes[1], 10) < 6;
  const runtime = Number(row.runtime || 0);
  return Number.isFinite(runtime) && runtime > 0 && runtime < 360;
}

function isValidEasynewsRow(row: EasynewsRow, media: MediaRequest, metadata: MediaMetadata): boolean {
  const fileId = String(row["0"] || "");
  const ext = String(row["11"] || row["2"] || "");
  const title = easynewsFileTitle(row);
  if (!fileId || !title || !/\.(mkv|mp4|m4v|mov|avi|webm)$/i.test(ext)) return false;
  if (String(row.type || "").toUpperCase() !== "VIDEO") return false;
  if (row.passwd || row.virus) return false;
  if (easynewsSize(row) < 20 * 1024 * 1024) return false;
  if (isShortDuration(row)) return false;

  const parsed = parseRelease(title);
  const match = scoreReleaseMatch(title, media, parsed, metadata);
  if (media.type === "series") {
    const seasonOk = parsed.season === media.season || parsed.season === undefined;
    const episodeOk = parsed.episode === media.episode
      || Boolean(parsed.episodeRange && media.episode && parsed.episodeRange.start <= media.episode && parsed.episodeRange.end >= media.episode)
      || parsed.absoluteEpisode === media.episode;
    return Boolean(episodeOk && seasonOk && match.score >= 700);
  }
  return match.score >= 650;
}

function buildMembersUrl(row: EasynewsRow, data: EasynewsSearchResponse): string | undefined {
  const fileId = String(row["0"] || "");
  const ext = String(row["11"] || row["2"] || "");
  const title = String(row["10"] || row.name || row.title || "");
  if (!fileId || !ext || !title) return undefined;

  let downURL = String(data.downURL || "https://members.easynews.com/dl").replace(/\/+$/, "");
  if (downURL.startsWith("//")) downURL = `https:${downURL}`;
  const dlFarm = data.dlFarm || "auto";
  const dlPort = data.dlPort || "443";
  const filename = title.endsWith(ext) ? title : `${title}${ext}`;
  const filePath = `${encodeURIComponent(`${fileId}${ext}`)}/${encodeURIComponent(filename)}`;
  const url = new URL(`${downURL}/${dlFarm}/${dlPort}/${filePath}`);
  if (row.sig) url.searchParams.set("sig", String(row.sig));
  return url.toString();
}

async function resolveMembersUrl(membersUrl: string, credentials: EasynewsCredentials): Promise<string | undefined> {
  const res = await request(membersUrl, {
    headers: {
      Authorization: basicAuth(credentials),
      Cookie: `chickenlicker=${chickenlicker(credentials)}`,
      Range: "bytes=0-0",
      "User-Agent": "Deepbridge EasynewsResolve"
    },
    signal: AbortSignal.timeout(18000)
  });
  const location = res.headers.location;
  await res.body.text();
  if (!location || Array.isArray(location)) {
    return res.statusCode >= 200 && res.statusCode < 300 ? membersUrl : undefined;
  }
  const finalUrl = new URL(location, membersUrl).toString();
  const host = new URL(finalUrl).hostname.toLowerCase();
  return host.endsWith("easynews.com") ? finalUrl : undefined;
}

function errorCategory(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "unknown");
  if (/auth|401|403/i.test(message)) return "auth";
  if (/timeout|aborted|AbortError|UND_ERR_ABORTED/i.test(message)) return "timeout";
  if (/http/i.test(message)) return "http";
  return "other";
}

export async function getEasynewsDirectSources(media: MediaRequest, userConfig?: any): Promise<SourceCandidate[]> {
  const username = String(userConfig?.easynewsUsername || "").trim();
  const password = String(userConfig?.easynewsPassword || "");
  const enabled = Boolean(userConfig?.easynewsEnabled !== false && username && password);
  const startedAt = Date.now();
  const stats: EasynewsDirectStats = {
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: "",
    configured: enabled,
    mediaKey: makeMediaKey(media),
    plannedSearches: 0,
    fulfilledSearches: 0,
    failedSearches: 0,
    rawItems: 0,
    filteredItems: 0,
    attemptedResolve: 0,
    ready: 0,
    failedResolve: 0,
    errors: {}
  };

  if (!enabled) {
    stats.finishedAt = new Date().toISOString();
    lastEasynewsDirectStats = stats;
    return [];
  }

  const credentials = { username, password };
  const metadata = await fetchMediaMetadata(media);
  const queries = buildQueries(metadata, media);
  stats.plannedSearches = queries.length;
  const seen = new Set<string>();
  const rows: Array<{ row: EasynewsRow; data: EasynewsSearchResponse }> = [];

  for (const query of queries) {
    try {
      const data = await searchEasynews(query, credentials);
      stats.fulfilledSearches++;
      for (const row of data.data || []) {
        stats.rawItems++;
        const id = String(row["0"] || "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        if (isValidEasynewsRow(row, media, metadata)) {
          rows.push({ row, data });
        }
      }
    } catch (error) {
      stats.failedSearches++;
      const category = errorCategory(error);
      stats.errors[category] = (stats.errors[category] || 0) + 1;
    }
  }

  rows.sort((a, b) => easynewsSize(b.row) - easynewsSize(a.row));
  stats.filteredItems = rows.length;
  const maxResults = Math.max(0, Math.min(Number(userConfig?.easynewsMaxResults || 4) || 4, 8));
  const candidates: SourceCandidate[] = [];

  for (const { row, data } of rows.slice(0, maxResults)) {
    const membersUrl = buildMembersUrl(row, data);
    if (!membersUrl) continue;
    stats.attemptedResolve++;
    try {
      const playableUrl = await resolveMembersUrl(membersUrl, credentials);
      if (!playableUrl) {
        stats.failedResolve++;
        continue;
      }
      const title = easynewsFileTitle(row);
      const parsed = parseRelease(title);
      const match = scoreReleaseMatch(title, media, parsed, metadata);
      const sizeBytes = easynewsSize(row);
      candidates.push({
        id: nanoid(),
        mediaType: media.type,
        imdbId: media.imdbId,
        season: media.season,
        episode: media.episode,
        mediaKey: makeMediaKey(media),
        origin: "easynews-direct",
        title,
        displayName: "[Easynews Direct]",
        status: "ready",
        playableUrl,
        sourceService: "easynews",
        resolution: parsed.resolution,
        quality: parsed.quality,
        codec: parsed.codec,
        hdr: parsed.hdr,
        audio: Array.isArray(row.alangs) ? row.alangs.join(",") : parsed.audio,
        releaseGroup: parsed.releaseGroup,
        normalizedTitle: parsed.normalizedTitle,
        parsedSeason: parsed.season,
        parsedEpisode: parsed.episode,
        absoluteEpisode: parsed.absoluteEpisode,
        seasonPack: parsed.seasonPack,
        sizeBytes,
        language: Array.isArray(row.alangs) ? row.alangs.join(",") : undefined,
        matchScore: match.score,
        matchReason: match.reason,
        score: 4500 + match.score + (sizeBytes / 1073741824),
        createdAt: new Date().toISOString()
      });
      stats.ready++;
    } catch (error) {
      stats.failedResolve++;
      const category = errorCategory(error);
      stats.errors[category] = (stats.errors[category] || 0) + 1;
    }
  }

  stats.finishedAt = new Date().toISOString();
  lastEasynewsDirectStats = stats;
  return candidates;
}
